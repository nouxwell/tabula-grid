import { compareDecimal, normalizeDecimal } from "./decimal.js"
import type { RowId, RowStore } from "./rows.js"
import type { FieldSchema, FieldType, ModuleSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import { decimalText } from "./values/number.js"
import { canonicalValue, isFieldValue, isLookupValue, valueProblem } from "./values/read.js"
import type { ValueSettings } from "./values/settings.js"

/**
 * Row checks: rules about a row rather than one cell, as a module schema or a template writes them.
 * "Not is required when Aktif is no", "Yeni fiyat cannot be below Mevcut fiyat", "Geçerlilik cannot
 * be before 2026-12-01 when Para birimi is USD".
 *
 * A check says what must hold for one field of the row (`assert`), and when (`when`: every condition
 * holding, or always when there is none). What it asserts is a condition too: the field filled,
 * empty, or compared with a value or with another field of the row. Its issue lands on that field's
 * cell, as an error that keeps the row from being processed or as a warning that does not.
 */

export const COMPARISONS = Object.freeze(["=", "!=", "<", "<=", ">", ">="] as const)
export type Comparison = (typeof COMPARISONS)[number]

export const CONDITION_OPS = Object.freeze([...COMPARISONS, "filled", "empty"] as const)
export type ConditionOp = (typeof CONDITION_OPS)[number]

/** One thing about one field of a row. */
export interface RowCondition {
	readonly field: string
	readonly op: ConditionOp
	/** What a comparison compares with: a value in the form a cell holds it, or null… */
	readonly value: CellValue
	/** …or another field of the row, by key. */
	readonly other: string | null
}

export type CheckSeverity = "error" | "warning"

export interface RowCheck {
	/** Names the check: its issues' ids, and an editor's list. Unique in the schema with its template. */
	readonly id: string
	/** What must hold for the row. The issue lands on this field's cell. */
	readonly assert: RowCondition
	/** When the check applies: every condition holding. Empty: always. */
	readonly when: readonly RowCondition[]
	readonly severity: CheckSeverity
	/** The words to say, by language, such as `{ "tr": "…", "en": "…" }`; null leaves them to the grid. */
	readonly message: Readonly<Record<string, string>> | null
}

/** A condition as it is written in the JSON. */
export interface ConditionInput {
	field: string
	op: ConditionOp
	value?: string | number | boolean | readonly (string | number)[]
	other?: string
}

/** A check as it is written in the JSON. */
export interface CheckInput {
	id: string
	assert: ConditionInput
	when?: ConditionInput[]
	severity?: CheckSeverity
	message?: Record<string, string>
}

const NUMERIC: ReadonlySet<FieldType> = new Set(["integer", "decimal", "money", "quantity", "percent"])
const ORDERED: ReadonlySet<FieldType> = new Set([...NUMERIC, "date", "datetime"])
const CHECK_PROPERTIES = ["id", "assert", "when", "severity", "message"]
const CONDITION_PROPERTIES = ["field", "op", "value", "other"]

type Add = (path: string, message: string) => void
type Json = Record<string, unknown>

/** Reads a schema's checks against its fields, reporting every problem with where it is. */
export function readChecks(value: unknown, fields: readonly FieldSchema[], add: Add): RowCheck[] {
	if (value === undefined || value === null) {
		return []
	}

	if (!Array.isArray(value)) {
		add("checks", "must be an array of checks")

		return []
	}

	const byKey = new Map(fields.map(field => [field.key, field]))
	const ids = new Map<string, number>()
	const checks: RowCheck[] = []

	;(value as unknown[]).forEach((raw, index) => {
		const path = `checks[${index}]`
		const check = readCheck(raw, path, byKey, add)

		if (!check) {
			return
		}

		const first = ids.get(check.id)

		if (first !== undefined) {
			add(`${path}.id`, `"${check.id}" is already the id of checks[${first}]; an id names one check only`)

			return
		}

		ids.set(check.id, index)
		checks.push(check)
	})

	return checks
}

/** A check written out again as JSON. */
export function checkToJson(check: RowCheck): CheckInput {
	const json: CheckInput = { id: check.id, assert: conditionToJson(check.assert) }

	if (check.when.length > 0) {
		json.when = check.when.map(conditionToJson)
	}

	json.severity = check.severity

	if (check.message !== null) {
		json.message = { ...check.message }
	}

	return json
}

/** The fields a check reads: what it asserts, what it compares with, and its conditions. */
export function checkFields(check: RowCheck): string[] {
	const keys = new Set<string>()

	for (const condition of [check.assert, ...check.when]) {
		keys.add(condition.field)

		if (condition.other !== null) {
			keys.add(condition.other)
		}
	}

	return [...keys]
}

/**
 * Whether a row breaks the check: every condition of `when` holds, and what it asserts does not. A
 * comparison with nothing on one side asserts nothing: a field's being filled is a check of its own.
 * A value that cannot be read as its field's is nothing to compare either; its cell says why.
 */
export function breaksCheck(
	check: RowCheck,
	field: (key: string) => FieldSchema,
	get: (key: string) => CellValue,
	settings: ValueSettings
): boolean {
	for (const condition of check.when) {
		if (holds(condition, field, get, settings) !== true) {
			return false
		}
	}

	return holds(check.assert, field, get, settings) === false
}

/**
 * The rows that break a check, in the order they stand in the sheet: what a rule editor counts and
 * shows while the rule is still being written, before it is saved anywhere. `schema` is one that has
 * the check, such as the template applied with it.
 */
export function rowsBreaking(schema: ModuleSchema, store: RowStore, check: RowCheck, settings: ValueSettings): RowId[] {
	const field = (key: string): FieldSchema => schema.field(key)

	return store.rowIds().filter(rowId => breaksCheck(check, field, key => store.get(rowId, key), settings))
}

// ---------------------------------------------------------------- inside

/** True or false, or null when a comparison has nothing to compare on one side. */
function holds(
	condition: RowCondition,
	field: (key: string) => FieldSchema,
	get: (key: string) => CellValue,
	settings: ValueSettings
): boolean | null {
	const own = field(condition.field)
	const raw = get(condition.field)

	if (condition.op === "filled") {
		return raw !== null
	}

	if (condition.op === "empty") {
		return raw === null
	}

	const left = readable(own, raw, settings)
	const right =
		condition.other === null ? condition.value : readable(field(condition.other), get(condition.other), settings)

	if (left === null || right === null) {
		return null
	}

	const order = compare(own, left, right)

	switch (condition.op) {
		case "=":
			return order === 0
		case "!=":
			return order !== 0
		case "<":
			return order < 0
		case "<=":
			return order <= 0
		case ">":
			return order > 0
		case ">=":
			return order >= 0
	}
}

/** The value as the backend is sent it; null for an empty cell or one that cannot be read. */
function readable(field: FieldSchema, value: CellValue, settings: ValueSettings): CellValue {
	if (value === null || valueProblem(field, value, settings) !== null) {
		return null
	}

	return canonicalValue(field, value, settings)
}

/** Below zero, zero or above, as the values stand; for kinds with no order, zero or not. */
function compare(field: FieldSchema, a: CellValue, b: CellValue): number {
	if (NUMERIC.has(field.type)) {
		const left = normalizeDecimal(decimalText(a) ?? "")
		const right = normalizeDecimal(decimalText(b) ?? "")

		return left === null || right === null ? 1 : compareDecimal(left, right)
	}

	if (field.type === "date" || field.type === "datetime") {
		return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
	}

	return sameValue(a, b) ? 0 : 1
}

function sameValue(a: CellValue, b: CellValue): boolean {
	if (isLookupValue(a) && isLookupValue(b)) {
		return String(a.id) === String(b.id)
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		return JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort())
	}

	return a === b || (typeof a !== "object" && typeof b !== "object" && String(a) === String(b))
}

function readCheck(raw: unknown, path: string, fields: ReadonlyMap<string, FieldSchema>, add: Add): RowCheck | null {
	if (!isObject(raw)) {
		add(path, 'must be an object such as { "id": "…", "assert": { "field": "…", "op": "filled" } }')

		return null
	}

	let failed = false
	const fail: Add = (at, message) => {
		failed = true
		add(at, message)
	}

	for (const name of Object.keys(raw)) {
		if (!CHECK_PROPERTIES.includes(name)) {
			fail(`${path}.${name}`, `is not a check property; a check takes ${CHECK_PROPERTIES.join(", ")}`)
		}
	}

	const id = typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : null

	if (id === null) {
		fail(`${path}.id`, "must be a non-empty string")
	}

	const assert = readCondition(raw.assert, `${path}.assert`, fields, fail)
	const when: RowCondition[] = []

	if (raw.when !== undefined && raw.when !== null) {
		if (!Array.isArray(raw.when)) {
			fail(`${path}.when`, "must be an array of conditions, every one of which must hold")
		} else {
			;(raw.when as unknown[]).forEach((item, index) => {
				const condition = readCondition(item, `${path}.when[${index}]`, fields, fail)

				if (condition) {
					when.push(condition)
				}
			})
		}
	}

	const severity = raw.severity === undefined || raw.severity === null ? "error" : raw.severity

	if (severity !== "error" && severity !== "warning") {
		fail(`${path}.severity`, `must be "error" or "warning"; got ${JSON.stringify(severity)}`)
	}

	const message = readMessage(raw.message, `${path}.message`, fail)

	if (failed || id === null || assert === null) {
		return null
	}

	return Object.freeze({
		id,
		assert,
		when: Object.freeze(when),
		severity: severity as CheckSeverity,
		message
	})
}

function readCondition(
	raw: unknown,
	path: string,
	fields: ReadonlyMap<string, FieldSchema>,
	add: Add
): RowCondition | null {
	if (!isObject(raw)) {
		add(path, 'must be an object such as { "field": "active", "op": "=", "value": false }')

		return null
	}

	const before = { failed: false }
	const fail: Add = (at, message) => {
		before.failed = true
		add(at, message)
	}

	for (const name of Object.keys(raw)) {
		if (!CONDITION_PROPERTIES.includes(name)) {
			fail(`${path}.${name}`, `is not a condition property; a condition takes ${CONDITION_PROPERTIES.join(", ")}`)
		}
	}

	const field = typeof raw.field === "string" ? fields.get(raw.field) : undefined

	if (!field) {
		fail(`${path}.field`, `${JSON.stringify(raw.field)} is not a field of this schema`)
	}

	const op = raw.op as ConditionOp

	if (!(CONDITION_OPS as readonly unknown[]).includes(op)) {
		fail(`${path}.op`, `${JSON.stringify(raw.op)} is not a condition; expected one of ${CONDITION_OPS.join(", ")}`)

		return null
	}

	const hasValue = raw.value !== undefined && raw.value !== null
	const hasOther = raw.other !== undefined && raw.other !== null

	if (op === "filled" || op === "empty") {
		if (hasValue || hasOther) {
			fail(path, `${op} takes no value and no other field`)
		}

		return before.failed || !field ? null : Object.freeze({ field: field.key, op, value: null, other: null })
	}

	if (hasValue === hasOther) {
		fail(path, `${op} compares with a value or with another field: give one of value and other`)

		return null
	}

	if (field && (op === "<" || op === "<=" || op === ">" || op === ">=") && !ORDERED.has(field.type)) {
		fail(`${path}.op`, `${op} needs an order; a ${field.type} field only takes = and !=`)
	}

	let other: string | null = null
	let value: CellValue = null

	if (hasOther) {
		const otherField = typeof raw.other === "string" ? fields.get(raw.other) : undefined

		if (!otherField) {
			fail(`${path}.other`, `${JSON.stringify(raw.other)} is not a field of this schema`)
		} else if (field && !comparable(field.type, otherField.type)) {
			fail(`${path}.other`, `a ${field.type} field cannot be compared with a ${otherField.type} field`)
		} else if (field && otherField.key === field.key) {
			fail(`${path}.other`, "is the field itself")
		} else {
			other = otherField.key
		}
	} else if (field) {
		// A number is kept as decimal text, as every cell of a numeric field holds one.
		const given = (NUMERIC.has(field.type) ? (decimalText(raw.value) ?? raw.value) : raw.value) as CellValue

		if (field.type === "lookup" || !isFieldValue(field, given)) {
			fail(
				`${path}.value`,
				`${JSON.stringify(raw.value)} is not a value of the ${field.type} field "${field.key}"`
			)
		} else {
			value = Array.isArray(given) ? (Object.freeze([...(given as unknown[])]) as CellValue) : given
		}
	}

	return before.failed || !field ? null : Object.freeze({ field: field.key, op, value, other })
}

function comparable(a: FieldType, b: FieldType): boolean {
	return (NUMERIC.has(a) && NUMERIC.has(b)) || a === b
}

function readMessage(raw: unknown, path: string, add: Add): Readonly<Record<string, string>> | null {
	if (raw === undefined || raw === null) {
		return null
	}

	if (!isObject(raw) || Object.keys(raw).length === 0) {
		add(path, 'must be an object of words by language, such as { "tr": "…", "en": "…" }')

		return null
	}

	for (const [language, text] of Object.entries(raw)) {
		if (typeof text !== "string" || text.trim() === "") {
			add(`${path}.${language}`, "must be a non-empty string")
		}
	}

	return Object.freeze({ ...(raw as Record<string, string>) })
}

function conditionToJson(condition: RowCondition): ConditionInput {
	const json: ConditionInput = { field: condition.field, op: condition.op }

	if (condition.other !== null) {
		json.other = condition.other
	} else if (condition.value !== null) {
		json.value = condition.value as NonNullable<ConditionInput["value"]>
	}

	return json
}

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
