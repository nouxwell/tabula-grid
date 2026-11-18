import { compareDecimal, normalizeDecimal } from "./decimal.js"
import { isFormulaError } from "./formula/error.js"
import type { RowId, RowStore } from "./rows.js"
import type { FieldSchema, ModuleSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import { editText, formatCell } from "./values/format.js"
import { decimalText } from "./values/number.js"
import { isLookupValue } from "./values/read.js"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings.js"
import type { RowFilter, RowOrder } from "./view.js"

/**
 * Column filters and sorting, as a spreadsheet's header offers them: which values of a column to
 * show, or a range of its numbers or dates, and the order of the rows by one column.
 *
 * Values are told apart by what they are, not by how they are written: 12.5 and "12.50" are one
 * number, a record is its id, an option its value. How a value is shown is the grid's business.
 */

/**
 * What a column keeps. `values`: the rows whose value has one of these keys (`filterKey()`; "" for
 * an empty cell). `range`: the rows whose number or date lies between `from` and `to`, both kept,
 * either open; written as the cell holds them, decimal text or ISO dates.
 */
export type ColumnCondition =
	| { readonly kind: "values"; readonly keys: readonly string[] }
	| { readonly kind: "range"; readonly from: string | null; readonly to: string | null }

/** Conditions by field key; a row is shown when it meets every one. */
export type ColumnFilters = Readonly<Record<string, ColumnCondition>>

export interface ColumnSort {
	readonly key: string
	readonly direction: "asc" | "desc"
}

/** One value a column holds, for a filter's list: its key, the value itself, and how many rows hold it. */
export interface DistinctValue {
	readonly key: string
	/** The value as the cell holds it, for the grid to write the sheet's way. Null for empty cells. */
	readonly value: CellValue
	readonly count: number
}

const NUMERIC: ReadonlySet<FieldSchema["type"]> = new Set(["integer", "decimal", "money", "quantity", "percent"])
const DATES: ReadonlySet<FieldSchema["type"]> = new Set(["date", "datetime"])

/** Whether a field's filter can be a range: numbers and dates. */
export function hasRange(field: FieldSchema): boolean {
	return NUMERIC.has(field.type) || DATES.has(field.type)
}

/**
 * What a value is filtered and listed by. Two values with one key are the same to a filter: 12.5
 * and "12.50", a record by its id. "" is an empty cell.
 */
export function filterKey(field: FieldSchema, value: CellValue): string {
	if (value === null) {
		return ""
	}

	if (isFormulaError(value)) {
		return `error:${value.formulaError}`
	}

	if (field.type === "lookup") {
		return isLookupValue(value) ? `id:${typeof value.id}:${value.id}` : `text:${String(value)}`
	}

	if (NUMERIC.has(field.type)) {
		const number = decimalText(value)
		const normal = number === null ? null : normalizeDecimal(number)

		if (normal !== null) {
			return `number:${normal}`
		}
	}

	if (typeof value === "boolean") {
		return value ? "true" : "false"
	}

	return typeof value === "string" ? `text:${value}` : `json:${JSON.stringify(value)}`
}

/**
 * The keys a cell is filtered by: its value's, or for a cell of several options one per option, so
 * a filter keeping "Web" keeps every row that holds it, whatever else it holds. "" for an empty cell.
 */
export function filterKeys(field: FieldSchema, value: CellValue): string[] {
	return eachValue(field, value).map(([key]) => key)
}

/** A cell's values with their keys: one, or one per option of a multi-select cell. */
function eachValue(field: FieldSchema, value: CellValue): (readonly [string, CellValue])[] {
	if (field.type === "options" && field.multiple && Array.isArray(value)) {
		const items = [...new Set(value as readonly CellValue[])]

		return items.length === 0 ? [["", null]] : items.map(item => [filterKey(field, item), item] as const)
	}

	return [[filterKey(field, value), value]]
}

/** Shows the rows that meet every column's condition; a key the schema no longer has is passed over. */
export function rowsMatching(store: RowStore, schema: ModuleSchema, filters: ColumnFilters): RowFilter {
	const tests: ((rowId: RowId) => boolean)[] = []

	for (const [key, condition] of Object.entries(filters)) {
		if (!schema.has(key)) {
			continue
		}

		const field = schema.field(key)

		if (condition.kind === "values") {
			const keys = new Set(condition.keys)

			tests.push(rowId => filterKeys(field, store.get(rowId, key)).some(each => keys.has(each)))
		} else {
			tests.push(rowId => inRange(field, store.get(rowId, key), condition.from, condition.to))
		}
	}

	return rowId => tests.every(test => test(rowId))
}

export interface SearchOptions {
	/** How values are written, to find them as the cells show them. Turkish by default. */
	readonly settings?: ValueSettings
	/** Whose rules lower the case, such as "tr", where "I" lowers to "ı". "tr" by default. */
	readonly locale?: string
	/** The fields searched; every field of the schema by default. */
	readonly fields?: readonly string[]
}

/**
 * The rows where a cell holds `text`, as the cell shows it ("1.533,80", "Mağaza, Web", the record's
 * name), case aside. A number is found as it is typed too, "1533,8". Empty text keeps every row.
 */
export function rowsContaining(
	store: RowStore,
	schema: ModuleSchema,
	text: string,
	options: SearchOptions = {}
): RowFilter {
	const locale = options.locale ?? "tr"
	const settings = options.settings ?? VALUE_SETTINGS.tr
	const needle = text.trim().toLocaleLowerCase(locale)
	const fields = (options.fields ?? schema.fields.map(field => field.key))
		.filter(key => schema.has(key))
		.map(key => schema.field(key))

	if (needle === "") {
		return () => true
	}

	const holds = (written: string): boolean => written.toLocaleLowerCase(locale).includes(needle)

	return rowId =>
		fields.some(field => {
			const value = store.get(rowId, field.key)

			return (
				value !== null &&
				(holds(formatCell(field, value, settings)) ||
					(NUMERIC.has(field.type) && holds(editText(field, value, settings))))
			)
		})
}

function inRange(field: FieldSchema, value: CellValue, from: string | null, to: string | null): boolean {
	const point = comparable(field, value)

	if (point === null) {
		return false
	}

	const compare = NUMERIC.has(field.type) ? compareNumbers : compareTexts

	return (from === null || compare(point, from) >= 0) && (to === null || compare(point, to) <= 0)
}

/** A number as normalized decimal text, a date as ISO text; null for empty cells and what is neither. */
function comparable(field: FieldSchema, value: CellValue): string | null {
	if (value === null || isFormulaError(value)) {
		return null
	}

	if (NUMERIC.has(field.type)) {
		const number = decimalText(value)

		return number === null ? null : normalizeDecimal(number)
	}

	if (DATES.has(field.type)) {
		return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null
	}

	return null
}

function compareNumbers(a: string, b: string): number {
	const left = normalizeDecimal(a)
	const right = normalizeDecimal(b)

	return left === null || right === null ? 0 : compareDecimal(left, right)
}

function compareTexts(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/** How a cell ranks before it is compared: values of the field's type, then anything else, then empty. */
function rank(field: FieldSchema, value: CellValue): 0 | 1 | 2 {
	if (value === null) {
		return 2
	}

	if (isFormulaError(value)) {
		return 1
	}

	switch (field.type) {
		case "integer":
		case "decimal":
		case "money":
		case "quantity":
		case "percent":
		case "date":
		case "datetime":
			return comparable(field, value) === null ? 1 : 0
		case "bool":
			return typeof value === "boolean" ? 0 : 1
		case "lookup":
			return isLookupValue(value) ? 0 : 1
		default:
			return 0
	}
}

/** The text a value is ordered by among text: an option's label, a record's name, the text itself. */
function sortText(field: FieldSchema, value: CellValue): string {
	if (field.type === "options") {
		const values = Array.isArray(value) ? value : [value]

		return values.map(item => field.options.find(option => option.value === item)?.label ?? String(item)).join(", ")
	}

	if (isLookupValue(value)) {
		return value.label
	}

	if (isFormulaError(value)) {
		return value.formulaError
	}

	return typeof value === "string" ? value : JSON.stringify(value)
}

/**
 * Compares two values of a field, as a sort of its column orders them: numbers by their value,
 * dates in time, no before yes, text in the language's order with numbers in it read as numbers
 * ("Ürün 9" before "Ürün 10"). Empty cells come last, and cells holding something not of the
 * field's type just before them.
 */
export function compareValues(field: FieldSchema, a: CellValue, b: CellValue, locale = "tr"): number {
	const rankA = rank(field, a)
	const rankB = rank(field, b)

	if (rankA !== rankB) {
		return rankA - rankB
	}

	if (rankA === 2) {
		return 0
	}

	if (rankA === 0) {
		if (NUMERIC.has(field.type)) {
			return compareNumbers(comparable(field, a) ?? "0", comparable(field, b) ?? "0")
		}

		if (DATES.has(field.type)) {
			return compareTexts(String(a), String(b))
		}

		if (field.type === "bool") {
			return Number(a) - Number(b)
		}
	}

	return sortText(field, a).localeCompare(sortText(field, b), locale, { numeric: true, sensitivity: "base" })
}

/**
 * The rows in the order of one column. Whichever way it goes, the cells that hold something not of
 * the column's type and then the empty ones stay last: a descending sort of prices puts the dearest
 * first, and "on iki" typed into a price and the rows with no price still at the end, where what
 * needs fixing is found together.
 */
export function rowOrder(store: RowStore, schema: ModuleSchema, sort: ColumnSort, locale = "tr"): RowOrder {
	const field = schema.field(sort.key)
	const sign = sort.direction === "asc" ? 1 : -1

	return (a, b) => {
		const left = store.get(a, field.key)
		const right = store.get(b, field.key)
		const rankLeft = rank(field, left)
		const rankRight = rank(field, right)

		if (rankLeft !== rankRight) {
			return rankLeft - rankRight
		}

		return rankLeft === 2 ? 0 : sign * compareValues(field, left, right, locale)
	}
}

/**
 * The values a column holds among these rows, each once with how many rows hold it, in the order a
 * sort of the column would put them, the empty cells last. `limit` keeps a list of 50,000 different
 * notes from being built whole: the rest are counted in `more`.
 */
export function distinctValues(
	store: RowStore,
	field: FieldSchema,
	rowIds: Iterable<RowId>,
	options: { readonly limit?: number; readonly locale?: string } = {}
): { readonly values: readonly DistinctValue[]; readonly more: number } {
	const found = new Map<string, { value: CellValue; count: number }>()

	for (const rowId of rowIds) {
		const value = store.get(rowId, field.key)

		// A cell holding several options counts once under each of them.
		for (const [key, each] of eachValue(field, value)) {
			const entry = found.get(key)

			if (entry) {
				entry.count++
			} else {
				found.set(key, { value: each, count: 1 })
			}
		}
	}

	const locale = options.locale ?? "tr"
	const all = [...found.entries()]
		.map(([key, entry]) => ({ key, value: entry.value, count: entry.count }))
		.sort((a, b) => compareValues(field, a.value, b.value, locale))
	const limit = options.limit ?? 1000

	return { values: all.slice(0, limit), more: Math.max(0, all.length - limit) }
}
