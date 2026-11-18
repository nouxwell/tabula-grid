import type { CsvDelimiter } from "./csv.js"
import type { RowId, RowInit, RowStore } from "./rows.js"
import type { FieldSchema, ModuleSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import { editText } from "./values/format.js"
import { isFieldValue, readInput } from "./values/read.js"
import type { ValueSettings } from "./values/settings.js"

/**
 * A sheet as a table of text and back: what a CSV file, or any file a backend has read, holds.
 *
 * The text is the sheet's own: numbers with its decimal mark and every digit, dates in its pattern,
 * yes and no in its words, a lookup by its name. Read back with the same settings, it gives the same
 * values.
 */

// ---------------------------------------------------------------- export

export interface TableExportOptions {
	readonly store: RowStore
	/** The columns to write, in order, such as the ones shown. */
	readonly fields: readonly FieldSchema[]
	/** The rows to write, in order, such as a filtered view's. Every row by default. */
	readonly rowIds?: readonly RowId[]
	readonly settings: ValueSettings
	/** What the first row holds: the columns' labels, their keys, or nothing. Labels by default. */
	readonly header?: "label" | "key" | "none"
}

/**
 * Text a spreadsheet would take for a formula and run when the file is opened: `=`, `+`, `-`, `@`, a
 * tab or a carriage return at the start. Such a cell is written with `'` before it, which a
 * spreadsheet shows as text. A number in a number column is never touched: `-12` stays a number.
 */
const FORMULA_START = /^[=+\-@\t\r]/

const NUMBER_TYPES: ReadonlySet<string> = new Set(["integer", "decimal", "quantity", "money", "percent"])

export function exportTable(options: TableExportOptions): string[][] {
	const { store, fields, settings } = options
	const rows: string[][] = []

	if ((options.header ?? "label") !== "none") {
		rows.push(fields.map(field => (options.header === "key" ? field.key : field.label)))
	}

	for (const rowId of options.rowIds ?? store.rowIds()) {
		rows.push(fields.map(field => cellText(field, store.get(rowId, field.key), settings)))
	}

	return rows
}

function cellText(field: FieldSchema, value: CellValue, settings: ValueSettings): string {
	const text = editText(field, value, settings)
	const number = NUMBER_TYPES.has(field.type) && value !== null && isFieldValue(field, value)

	return !number && FORMULA_START.test(text) ? `'${text}` : text
}

/** The delimiter a spreadsheet in the sheet's language expects: `;` where the comma is the decimal mark. */
export function csvDelimiterFor(settings: ValueSettings): CsvDelimiter {
	return settings.decimalSeparator === "," ? ";" : ","
}

// ---------------------------------------------------------------- import

export interface TableImportOptions {
	readonly schema: ModuleSchema
	readonly settings: ValueSettings
	/**
	 * Which field each column goes to, by the column's position, over what its header says. Null
	 * leaves a column out.
	 */
	readonly columns?: Readonly<Record<number, string | null>>
}

/**
 * What became of a column. `unknown`: no field has its header. `duplicate`: an earlier column went
 * to the same field. `read_only`: its field is not typed into, such as one shown for reference or
 * worked out by a formula. `skipped`: left out on purpose.
 */
export type ColumnStatus = "matched" | "unknown" | "duplicate" | "read_only" | "skipped"

export interface ColumnMatch {
	readonly index: number
	readonly header: string
	/** The field the column went to; null unless it was `matched`. */
	readonly field: string | null
	readonly status: ColumnStatus
}

export interface TableImport {
	readonly columns: readonly ColumnMatch[]
	/** For `RowStore.appendRows`: new rows, ids to be made. Empty lines are left out. */
	readonly rows: RowInit[]
	/** Required fields no column brought: every row lacks them, and will say so. */
	readonly missing: readonly string[]
	/**
	 * Cells whose text is not a value of their field's type: kept as written, and marked, as a paste
	 * keeps them. A lookup's name is not counted: matching it to a record is the lookup's work.
	 */
	readonly unreadable: number
}

/**
 * Rows from a table whose first row names the columns, by each field's label or key, in any case.
 * Each cell is read as what a user typed into the field would be.
 */
export function importTable(table: readonly (readonly string[])[], options: TableImportOptions): TableImport {
	const { schema, settings } = options
	const [header = [], ...body] = table
	const taken = new Set<string>()

	const columns: ColumnMatch[] = header.map((raw, index) => {
		const name = raw.trim()
		const given = options.columns?.[index]

		if (given === null) {
			return { index, header: name, field: null, status: "skipped" }
		}

		const field = given !== undefined ? (schema.has(given) ? schema.field(given) : null) : fieldNamed(schema, name)

		if (!field) {
			return { index, header: name, field: null, status: "unknown" }
		}

		if (!field.editable) {
			return { index, header: name, field: null, status: "read_only" }
		}

		if (taken.has(field.key)) {
			return { index, header: name, field: null, status: "duplicate" }
		}

		taken.add(field.key)

		return { index, header: name, field: field.key, status: "matched" }
	})

	const rows: RowInit[] = []
	let unreadable = 0

	for (const line of body) {
		if (line.every(cell => cell.trim() === "")) {
			continue
		}

		const values: Record<string, CellValue> = {}

		for (const column of columns) {
			if (column.field === null) {
				continue
			}

			const field = schema.field(column.field)
			const result = readInput(field, line[column.index] ?? "", settings)

			if (result.value !== null) {
				values[field.key] = result.value
			}

			if (result.problem && result.problem.code !== "not_matched") {
				unreadable++
			}
		}

		rows.push({ values })
	}

	const missing = schema.fields
		.filter(field => field.required && field.editable && !taken.has(field.key))
		.map(field => field.key)

	return { columns, rows, missing, unreadable }
}

/** The field a header names: by label, then by key, regardless of case, Turkish or not. */
function fieldNamed(schema: ModuleSchema, name: string): FieldSchema | null {
	const same = (a: string, b: string): boolean =>
		a.toLocaleLowerCase("tr") === b.toLocaleLowerCase("tr") || a.toLowerCase() === b.toLowerCase()

	return (
		schema.fields.find(field => same(field.label.trim(), name)) ??
		schema.fields.find(field => same(field.key, name)) ??
		null
	)
}
