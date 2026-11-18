import { conditionHolds, conditionToJson, readCondition, type ConditionInput, type RowCondition } from "./checks.js"
import { MARK_COLORS, type MarkColor } from "./marks.js"
import type { RowId, RowStore } from "./rows.js"
import type { FieldSchema, ModuleSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import type { ValueSettings } from "./values/settings.js"

/**
 * Colour rules: cells coloured by what the row holds, as a module schema or a template writes them.
 * "Yeni fiyat below 100: orange", "Para birimi not TRY: blue text", "Aktif is no: the whole row
 * grey". A rule's conditions are a check's: a field compared with a value or another field, filled
 * or empty, every one holding. When they hold, the rule's cell, or the whole row, takes its colours.
 *
 * Only how the sheet is drawn: a rule changes no value, and nothing of it is sent to the backend.
 * Everyone who opens the template sees the same colours, and they follow the values as they change.
 */

export interface StyleRule {
	/** Names the rule: an editor's list. Unique in the schema with its template. */
	readonly id: string
	/** When the rule colours: every condition holding. Never empty. */
	readonly when: readonly RowCondition[]
	/** The cell coloured, by field key; null colours the whole row. */
	readonly field: string | null
	readonly fill: MarkColor | null
	readonly color: MarkColor | null
	readonly bold: boolean
}

/** A colour rule as it is written in the JSON. */
export interface StyleRuleInput {
	id: string
	when: ConditionInput[]
	/** Left out, the whole row. */
	field?: string
	fill?: MarkColor
	color?: MarkColor
	bold?: boolean
}

/** What rules put on one cell: the last rule to say a thing wins, as later rules are written over earlier ones. */
export interface CellStyle {
	readonly fill: MarkColor | null
	readonly color: MarkColor | null
	readonly bold: boolean
}

const RULE_PROPERTIES = ["id", "when", "field", "fill", "color", "bold"]

type Add = (path: string, message: string) => void

/** Reads a schema's colour rules against its fields, reporting every problem with where it is. */
export function readStyleRules(value: unknown, fields: readonly FieldSchema[], add: Add): StyleRule[] {
	if (value === undefined || value === null) {
		return []
	}

	if (!Array.isArray(value)) {
		add("styles", "must be an array of colour rules")

		return []
	}

	const byKey = new Map(fields.map(field => [field.key, field]))
	const ids = new Map<string, number>()
	const rules: StyleRule[] = []

	value.forEach((raw: unknown, index) => {
		const path = `styles[${index}]`
		const rule = readRule(raw, path, byKey, add)

		if (rule === null) {
			return
		}

		const seen = ids.get(rule.id)

		if (seen !== undefined) {
			add(`${path}.id`, `"${rule.id}" is the id of styles[${seen}] too`)

			return
		}

		ids.set(rule.id, index)
		rules.push(rule)
	})

	return rules
}

/** A colour rule written out again as JSON. */
export function styleRuleToJson(rule: StyleRule): StyleRuleInput {
	return {
		id: rule.id,
		when: rule.when.map(conditionToJson),
		...(rule.field === null ? {} : { field: rule.field }),
		...(rule.fill === null ? {} : { fill: rule.fill }),
		...(rule.color === null ? {} : { color: rule.color }),
		...(rule.bold ? { bold: true } : {})
	}
}

/** Whether the rule colours the row: every one of its conditions holds. */
export function styleApplies(
	rule: StyleRule,
	field: (key: string) => FieldSchema,
	get: (key: string) => CellValue,
	settings: ValueSettings
): boolean {
	return rule.when.every(condition => conditionHolds(condition, field, get, settings))
}

/**
 * What the rules put on each cell of a row, by field key, and on the row itself under `null`. Empty
 * when no rule colours the row.
 */
export function rowStyles(
	rules: readonly StyleRule[],
	field: (key: string) => FieldSchema,
	get: (key: string) => CellValue,
	settings: ValueSettings
): Map<string | null, CellStyle> {
	const styles = new Map<string | null, CellStyle>()

	for (const rule of rules) {
		if (!styleApplies(rule, field, get, settings)) {
			continue
		}

		const before = styles.get(rule.field)

		styles.set(rule.field, {
			fill: rule.fill ?? before?.fill ?? null,
			color: rule.color ?? before?.color ?? null,
			bold: rule.bold || (before?.bold ?? false)
		})
	}

	return styles
}

/**
 * The rows a rule colours, in the order they stand in the sheet: what a rule editor counts while the
 * rule is being written. `schema` is one that has the rule's fields.
 */
export function rowsStyled(schema: ModuleSchema, store: RowStore, rule: StyleRule, settings: ValueSettings): RowId[] {
	const field = (key: string): FieldSchema => schema.field(key)

	return store.rowIds().filter(rowId => styleApplies(rule, field, key => store.get(rowId, key), settings))
}

function readRule(raw: unknown, path: string, fields: ReadonlyMap<string, FieldSchema>, add: Add): StyleRule | null {
	if (!isObject(raw)) {
		add(
			path,
			'must be an object such as { "id": "…", "when": [{ "field": "…", "op": "<", "value": 100 }], "fill": "orange" }'
		)

		return null
	}

	let failed = false
	const fail: Add = (at, message) => {
		failed = true
		add(at, message)
	}

	for (const name of Object.keys(raw)) {
		if (!RULE_PROPERTIES.includes(name)) {
			fail(`${path}.${name}`, `is not a colour rule property; a rule takes ${RULE_PROPERTIES.join(", ")}`)
		}
	}

	const id = typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : null

	if (id === null) {
		fail(`${path}.id`, "must be a non-empty string")
	}

	const when: RowCondition[] = []

	if (!Array.isArray(raw.when) || raw.when.length === 0) {
		fail(`${path}.when`, "must be an array of one condition or more, every one of which must hold")
	} else {
		;(raw.when as unknown[]).forEach((item, index) => {
			const condition = readCondition(item, `${path}.when[${index}]`, fields, fail)

			if (condition) {
				when.push(condition)
			}
		})
	}

	let field: string | null = null

	if (raw.field !== undefined && raw.field !== null) {
		if (typeof raw.field === "string" && fields.has(raw.field)) {
			field = raw.field
		} else {
			fail(`${path}.field`, `${JSON.stringify(raw.field)} is not a field of this schema`)
		}
	}

	const color = (name: "fill" | "color"): MarkColor | null => {
		const value = raw[name]

		if (value === undefined || value === null) {
			return null
		}

		if ((MARK_COLORS as readonly unknown[]).includes(value)) {
			return value as MarkColor
		}

		fail(`${path}.${name}`, `must be one of ${MARK_COLORS.join(", ")}`)

		return null
	}

	const fill = color("fill")
	const text = color("color")

	if (raw.bold !== undefined && typeof raw.bold !== "boolean") {
		fail(`${path}.bold`, "must be true or false")
	}

	const bold = raw.bold === true

	if (fill === null && text === null && !bold && !failed) {
		fail(path, "colours nothing: give a fill, a colour or bold")
	}

	if (failed || id === null) {
		return null
	}

	return Object.freeze({ id, when: Object.freeze(when), field, fill, color: text, bold })
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
