import { compareDecimal, normalizeDecimal } from "./decimal.js"
import { SchemaError, TabulaError } from "./errors.js"
import type { RowInit } from "./rows.js"
import {
	ModuleSchema,
	type FieldInput,
	type FieldSchema,
	type FieldType,
	type ModuleSchemaInput,
	type RuleInput
} from "./schema.js"
import type { CellValue } from "./value.js"
import { readViewState, type ViewState } from "./views.js"

/**
 * A template: the sheet as an authorized user prepares it for a task, layered on the module schema
 * the developer wrote and under each user's own views. "Aralık zam listesi" on the price update.
 *
 * It may change a column's header, require a field the schema leaves optional, keep a column from
 * being typed into, narrow a field's limits, give new rows a value, add columns of its own, and say
 * how the sheet opens. It may never loosen what the schema asks: a field the schema requires stays
 * required, a limit can only get narrower, and a column the schema keeps read-only stays so. Its own
 * columns are never sent for processing: they are a helper the user works with, kept in the draft,
 * or worked out from the row by a formula.
 *
 * Only a module whose schema says `customization: "controlled"` (or `"free"`) takes a template. A
 * template the schema does not allow is refused whole, not half applied: a rule it would have
 * tightened and quietly did not is a rule nobody checks.
 */

export const TEMPLATE_FORMAT = "tabula-grid.template"
export const TEMPLATE_VERSION = 1

/** What a template changes about one of the schema's fields. */
export interface TemplateFieldChange {
	/** The column's header. The key, and everything the backend sees, stays the same. */
	readonly label?: string
	/** Only `true`: a field the schema requires cannot be made optional. */
	readonly required?: boolean
	/** Only `false`: a column the schema keeps read-only cannot be opened. */
	readonly editable?: boolean
	/** Limits added or narrowed: a `min` above the schema's, a `max` below it, `unique`. */
	readonly rules?: readonly RuleInput[]
	/** A new row's value, as the schema's `default`. */
	readonly default?: FieldInput["default"]
}

export interface GridTemplate {
	readonly format: typeof TEMPLATE_FORMAT
	/** The version of this format. */
	readonly version: typeof TEMPLATE_VERSION
	readonly module: string
	readonly id: string
	readonly name: string
	/** Changes to the schema's fields, by key. */
	readonly fields: Readonly<Record<string, TemplateFieldChange>>
	/** Columns of the template's own, after the schema's: written as a schema's fields are, never sent. */
	readonly columns: readonly FieldInput[]
	/** How the sheet opens: the columns, widths, filters and sort, under each user's own views. */
	readonly view: ViewState | null
}

/** One thing wrong with a template, and where: `fields.newPrice.rules[0]`, `columns[1].key`. */
export interface TemplateProblem {
	readonly path: string
	readonly message: string
}

const CHANGES = ["label", "required", "editable", "rules", "default"] as const
const NUMERIC: ReadonlySet<FieldType> = new Set(["integer", "decimal", "money", "quantity", "percent"])

/**
 * Checks what was read back from storage, or sent by the backend, against the template format:
 * its shape, every problem at once. Whether the template fits the schema is `templateProblems`.
 *
 * @throws TabulaError `invalid_template`, also for a template of another module
 */
export function readTemplate(input: unknown, module: string): GridTemplate {
	const problems: TemplateProblem[] = []
	const problem = (path: string, message: string): void => {
		problems.push({ path, message })
	}
	const root = plain(input)

	if (!root) {
		throw new TabulaError("invalid_template", "A template must be an object.")
	}

	if (root.format !== TEMPLATE_FORMAT) {
		problem("format", `must be "${TEMPLATE_FORMAT}".`)
	}

	if (root.version !== TEMPLATE_VERSION) {
		problem("version", `must be ${TEMPLATE_VERSION}; a template of another version of this format cannot be read.`)
	}

	if (root.module !== module) {
		problem("module", `must be "${module}", the module the template is read for.`)
	}

	const text = (name: "id" | "name"): string => {
		const value = root[name]

		if (typeof value !== "string" || value.trim() === "") {
			problem(name, "must be a non-empty string.")

			return ""
		}

		return name === "name" ? value.trim() : value
	}

	const id = text("id")
	const name = text("name")
	const fields: Record<string, TemplateFieldChange> = {}
	const fieldsRoot = root.fields === undefined ? {} : plain(root.fields)

	if (!fieldsRoot) {
		problem("fields", "must be an object of changes by field key.")
	} else {
		for (const [key, change] of Object.entries(fieldsRoot)) {
			if (plain(change)) {
				fields[key] = change as TemplateFieldChange
			} else {
				problem(`fields.${key}`, "must be an object of changes.")
			}
		}
	}

	const columns: FieldInput[] = []

	if (root.columns !== undefined && !Array.isArray(root.columns)) {
		problem("columns", "must be a list of columns.")
	} else {
		;((root.columns as unknown[] | undefined) ?? []).forEach((column, index) => {
			if (plain(column)) {
				columns.push(column as unknown as FieldInput)
			} else {
				problem(`columns[${index}]`, "must be an object, written as a schema's field.")
			}
		})
	}

	const view = root.view === undefined || root.view === null ? null : readViewState(root.view, "view", problem)

	if (problems.length > 0) {
		throw new TabulaError("invalid_template", describeProblems("The template cannot be read", problems))
	}

	return Object.freeze({
		format: TEMPLATE_FORMAT,
		version: TEMPLATE_VERSION,
		module,
		id,
		name,
		fields: Object.freeze(fields),
		columns: Object.freeze(columns),
		view
	})
}

/**
 * Everything that keeps a template from applying to the schema, each with where it is: a change
 * that loosens the schema, a field the module does not have, a column with a field's key, a limit
 * that leaves no value possible. Empty when it applies.
 */
export function templateProblems(schema: ModuleSchema, template: GridTemplate): TemplateProblem[] {
	return merge(schema, template).problems
}

/**
 * The module schema with the template on it: the schema the sheet works with, its checks and its
 * formulas. The template's columns come after the schema's fields, never sent.
 *
 * @throws TabulaError `invalid_template` with every problem `templateProblems` finds
 */
export function applyTemplate(schema: ModuleSchema, template: GridTemplate): ModuleSchema {
	const { problems, applied } = merge(schema, template)

	if (problems.length > 0 || applied === null) {
		throw new TabulaError(
			"invalid_template",
			describeProblems(`Template "${template.name}" cannot be applied to module "${schema.module}"`, problems)
		)
	}

	return applied
}

/**
 * New rows with the schema's defaults where they give no value: the rows a paste or an import adds.
 * A value given, even an empty one, is kept; only a field the row leaves out takes its default.
 */
export function withDefaults(schema: ModuleSchema, rows: number | readonly RowInit[]): RowInit[] {
	const list: readonly RowInit[] = typeof rows === "number" ? Array.from({ length: rows }, () => ({})) : rows
	const defaults = schema.fields.filter(field => field.default !== null)

	if (defaults.length === 0) {
		return [...list]
	}

	return list.map(row => {
		const values: Record<string, CellValue> = {}

		for (const field of defaults) {
			values[field.key] = field.default
		}

		for (const [key, value] of Object.entries(row.values ?? {})) {
			if (value !== undefined) {
				values[key] = value
			}
		}

		return { ...row, values }
	})
}

// ---------------------------------------------------------------- inside

type Plain = Record<string, unknown>
type Problem = (path: string, message: string) => void

function merge(
	schema: ModuleSchema,
	template: GridTemplate
): { problems: TemplateProblem[]; applied: ModuleSchema | null } {
	const problems: TemplateProblem[] = []
	const problem: Problem = (path, message) => {
		problems.push({ path, message })
	}

	if (schema.customization === "fixed") {
		problem("(root)", `module "${schema.module}" is fixed: its schema says no template may change it.`)
	}

	if (template.module !== schema.module) {
		problem("module", `is "${template.module}"; the schema is module "${schema.module}".`)
	}

	for (const key of Object.keys(template.fields)) {
		if (!schema.has(key)) {
			problem(`fields.${key}`, `is not a field of module "${schema.module}".`)
		}
	}

	const json = schema.toJSON()
	const fields: FieldInput[] = json.fields.map(field => {
		const change = template.fields[field.key]

		return change ? changed(field, schema.field(field.key), change, `fields.${field.key}`, problem) : field
	})

	const columns = template.columns.map((column, index) => {
		const path = `columns[${index}]`

		if (typeof column.key === "string" && schema.has(column.key)) {
			problem(
				`${path}.key`,
				`"${column.key}" is a field of the module; a template's column needs a key of its own.`
			)
		}

		if (column.type === "lookup") {
			problem(
				`${path}.type`,
				"cannot be lookup: a record is something the backend gives, and a template's column is never sent."
			)
		}

		if ((column as { submit?: unknown }).submit === true) {
			problem(`${path}.submit`, "cannot be true: a template's column is never sent for processing.")
		}

		return { ...column, submit: false }
	})

	if (problems.length > 0) {
		return { problems, applied: null }
	}

	const merged: ModuleSchemaInput = { ...json, fields: [...fields, ...columns] }

	try {
		return { problems, applied: ModuleSchema.from(merged) }
	} catch (error) {
		if (!(error instanceof SchemaError)) {
			throw error
		}

		// The schema's own reading found it: its paths name the merged fields, so they are put back
		// as the template's, a field by its key and a column by its place.
		for (const item of error.problems) {
			const match = /^fields\[(\d+)\](.*)$/.exec(item.path)
			const index = match ? Number(match[1]) : -1
			const rest = match?.[2] ?? ""
			const path =
				index < 0
					? item.path
					: index < json.fields.length
						? `fields.${json.fields[index]?.key ?? index}${rest}`
						: `columns[${index - json.fields.length}]${rest}`

			problem(path, item.message)
		}

		return { problems, applied: null }
	}
}

/** One of the schema's fields, as the template changes it, as long as it only narrows. */
function changed(
	json: FieldInput,
	field: FieldSchema,
	change: TemplateFieldChange,
	path: string,
	problem: Problem
): FieldInput {
	const next: FieldInput = { ...json }

	for (const name of Object.keys(change)) {
		if (!(CHANGES as readonly string[]).includes(name)) {
			problem(`${path}.${name}`, `is not something a template changes; it changes ${CHANGES.join(", ")}.`)
		}
	}

	if (change.label !== undefined) {
		next.label = change.label
	}

	if (change.required !== undefined) {
		if (typeof change.required !== "boolean") {
			problem(`${path}.required`, "must be true or false.")
		} else if (!change.required && field.required) {
			problem(
				`${path}.required`,
				"would make the field optional; the schema requires it, and a template only narrows."
			)
		} else if (change.required) {
			next.required = true
		}
	}

	if (change.editable !== undefined) {
		if (typeof change.editable !== "boolean") {
			problem(`${path}.editable`, "must be true or false.")
		} else if (change.editable && !field.editable) {
			problem(
				`${path}.editable`,
				"would open the column for typing; the schema keeps it read-only, and a template only narrows."
			)
		} else if (!change.editable) {
			next.editable = false
		}
	}

	if (change.rules !== undefined) {
		next.rules = narrowed(field, change.rules, `${path}.rules`, problem)
	}

	if (change.default !== undefined) {
		next.default = change.default
	}

	return next
}

/**
 * The field's rules with the template's: each the narrower of the two. A rule the schema does not
 * have is added; one that would let through what the schema refuses is a problem.
 */
function narrowed(field: FieldSchema, rules: unknown, path: string, problem: Problem): RuleInput[] {
	const result = new Map<string, RuleInput>(field.rules.map(rule => [rule.rule, { ...rule } as RuleInput]))

	if (!Array.isArray(rules)) {
		problem(path, "must be a list of rules.")

		return [...result.values()]
	}

	rules.forEach((raw: unknown, index) => {
		const at = `${path}[${index}]`
		const rule = plain(raw)
		const kind = rule?.rule
		const own = field.rules.find(item => item.rule === kind)

		if (!rule || typeof kind !== "string") {
			problem(at, 'must be a rule such as { "rule": "min", "value": "1" }.')

			return
		}

		switch (kind) {
			case "min":
			case "max": {
				const value =
					typeof rule.value === "string" || typeof rule.value === "number"
						? normalizeDecimal(rule.value)
						: null

				if (!NUMERIC.has(field.type)) {
					problem(at, `${kind} does not apply to a ${field.type} field.`)
				} else if (value === null) {
					problem(`${at}.value`, 'must be a decimal number such as "1" or "12.5".')
				} else if (
					own &&
					"value" in own &&
					compareDecimal(value, String(own.value)) * (kind === "min" ? 1 : -1) < 0
				) {
					problem(
						at,
						`${kind} ${value} would let through what the schema's ${kind} ${own.value} refuses; a template only narrows.`
					)
				} else {
					result.set(kind, { rule: kind, value })
				}

				return
			}
			case "minLength":
			case "maxLength": {
				const value = rule.value

				if (field.type !== "string") {
					problem(at, `${kind} does not apply to a ${field.type} field.`)
				} else if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
					problem(`${at}.value`, "must be a whole number of characters, 0 or more.")
				} else if (own && "value" in own && (value - Number(own.value)) * (kind === "minLength" ? 1 : -1) < 0) {
					problem(
						at,
						`${kind} ${value} would let through what the schema's ${kind} ${own.value} refuses; a template only narrows.`
					)
				} else {
					result.set(kind, { rule: kind, value })
				}

				return
			}
			case "unique":
				result.set(kind, { rule: kind })

				return
			default:
				problem(
					`${at}.rule`,
					`${JSON.stringify(kind)} is not a rule; expected one of min, max, minLength, maxLength, unique.`
				)
		}
	})

	return [...result.values()]
}

function describeProblems(heading: string, problems: readonly TemplateProblem[]): string {
	return `${heading}:\n${problems.map(item => `  ${item.path}: ${item.message}`).join("\n")}`
}

function plain(value: unknown): Plain | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Plain) : null
}
