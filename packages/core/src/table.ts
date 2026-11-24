import type { CsvDelimiter } from "./csv.js"
import type { RowId, RowInit, RowStore } from "./rows.js"
import type { FieldSchema, ModuleSchema } from "./schema.js"
import { withDefaults } from "./templates.js"
import type { CellValue } from "./value.js"
import { editText } from "./values/format.js"
import { canonicalValue, isFieldValue, isLookupValue, readInput } from "./values/read.js"
import type { ValueSettings } from "./values/settings.js"
import { fold } from "./values/text.js"

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
	/**
	 * Columns of the host's own, written as text before or after the fields' (after by default), such
	 * as each row's number or its issues. Nothing reads them back as a value.
	 */
	readonly extra?: readonly ExtraColumn[]
}

export interface ExtraColumn {
	readonly header: string
	readonly text: (rowId: RowId) => string
	readonly at?: "start" | "end"
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
	const before = (options.extra ?? []).filter(column => column.at === "start")
	const after = (options.extra ?? []).filter(column => column.at !== "start")
	const own = (columns: readonly ExtraColumn[], rowId: RowId): string[] =>
		columns.map(column => {
			const text = column.text(rowId)

			return FORMULA_START.test(text) ? `'${text}` : text
		})
	const rows: string[][] = []

	if ((options.header ?? "label") !== "none") {
		rows.push([
			...before.map(column => column.header),
			...fields.map(field => (options.header === "key" ? field.key : field.label)),
			...after.map(column => column.header)
		])
	}

	for (const rowId of options.rowIds ?? store.rowIds()) {
		rows.push([
			...own(before, rowId),
			...fields.map(field => cellText(field, store.get(rowId, field.key), settings)),
			...own(after, rowId)
		])
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
	/**
	 * The column that finds each row in the sheet, for `matchRows`, by its position: its text is kept
	 * in `keys`, and it brings no value.
	 */
	readonly key?: number | null
}

/**
 * What became of a column. `unknown`: no field has its header. `duplicate`: an earlier column went
 * to the same field. `read_only`: its field is not typed into, such as one shown for reference or
 * worked out by a formula. `skipped`: left out on purpose. `key`: it finds the rows (`key`).
 */
export type ColumnStatus = "matched" | "unknown" | "duplicate" | "read_only" | "skipped" | "key"

export interface ColumnMatch {
	readonly index: number
	readonly header: string
	/** The field the column went to; null unless it was `matched`. */
	readonly field: string | null
	readonly status: ColumnStatus
	/** Its first few values that are not empty, as written: what a column is told by. */
	readonly samples: readonly string[]
	/** Its cells whose text is not a value of its field's type. */
	readonly unreadable: number
}

export interface TableImport {
	readonly columns: readonly ColumnMatch[]
	/** For `RowStore.appendRows`: new rows, ids to be made. Empty lines are left out. */
	readonly rows: RowInit[]
	/** With `key`, that column's text in each row, trimmed, in the order of `rows`; empty otherwise. */
	readonly keys: readonly string[]
	/** Required fields no column brought: every row lacks them, and will say so. */
	readonly missing: readonly string[]
	/**
	 * Cells whose text is not a value of their field's type: kept as written, and marked, as a paste
	 * keeps them. A lookup's name is not counted: matching it to a record is the lookup's work.
	 */
	readonly unreadable: number
}

/** How many of a column's first values `ColumnMatch.samples` shows. */
const SAMPLES = 3

/**
 * Rows from a table whose first row names the columns, by each field's label or key, in any case.
 * Each cell is read as what a user typed into the field would be.
 */
export function importTable(table: readonly (readonly string[])[], options: TableImportOptions): TableImport {
	const { schema, settings } = options
	const [header = [], ...lines] = table
	const body = lines.filter(line => !line.every(cell => cell.trim() === ""))
	const key = options.key ?? null
	const taken = new Set<string>()

	const matched = header.map((raw, index): Omit<ColumnMatch, "samples" | "unreadable"> => {
		const name = raw.trim()
		const given = options.columns?.[index]

		if (index === key) {
			return { index, header: name, field: null, status: "key" }
		}

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
	const keys: string[] = []
	const unreadable = matched.map(() => 0)

	for (const line of body) {
		const values: Record<string, CellValue> = {}

		for (const column of matched) {
			if (column.field === null) {
				continue
			}

			const field = schema.field(column.field)
			const result = readInput(field, line[column.index] ?? "", settings)

			if (result.value !== null) {
				values[field.key] = result.value
			}

			if (result.problem && result.problem.code !== "not_matched") {
				unreadable[column.index] = (unreadable[column.index] ?? 0) + 1
			}
		}

		rows.push({ values })

		if (key !== null) {
			keys.push((line[key] ?? "").trim())
		}
	}

	const columns = matched.map(column => ({
		...column,
		samples: samplesOf(body, column.index, SAMPLES),
		unreadable: unreadable[column.index] ?? 0
	}))
	const missing = schema.fields
		.filter(field => field.required && field.editable && !taken.has(field.key))
		.map(field => field.key)

	return { columns, rows, keys, missing, unreadable: unreadable.reduce((sum, count) => sum + count, 0) }
}

// ---------------------------------------------------------------- where the columns go

/**
 * Why a column is suggested for a field. `remembered`: the host said this header went there before.
 * `name`: the header is the field's label or key. `similar`: the header shares a word with the
 * label, "Fiyat" with "Yeni fiyat". `values`: the column's values read as that field's and as no
 * other's, "TRY" and "USD" as a currency's options.
 */
export type SuggestionReason = "remembered" | "name" | "similar" | "values"

export interface ColumnSuggestion {
	/** The field the column would go to; null to leave it out. */
	readonly field: string | null
	readonly reason: SuggestionReason | null
}

export interface SuggestOptions {
	readonly schema: ModuleSchema
	readonly settings: ValueSettings
	/**
	 * Where headers went before, by `headerKey`: a field's key, or null for a column left out. Kept by
	 * the host, such as from the user's last import.
	 */
	readonly remembered?: Readonly<Record<string, string | null>>
}

/** How many of a column's values are read to tell what it holds. */
const PROBE = 50
/**
 * The share of a column's values that must read as a field's for the column to go there: most, so
 * a few values written another way, such as "31/12/26" among dates, still let it.
 */
const READABLE = 0.6

/**
 * Where each column of a table would go, and why, for an import the user then looks over: what the
 * host remembered, then the header as a field's name, then a word the two share, then values only
 * one field reads. Only fields typed into are suggested, each for one column at most; a column
 * nothing fits is left out.
 */
export function suggestColumns(table: readonly (readonly string[])[], options: SuggestOptions): ColumnSuggestion[] {
	const { schema, settings } = options
	const [header = [], ...lines] = table
	const body = lines.filter(line => !line.every(cell => cell.trim() === ""))
	const open = schema.fields.filter(field => field.editable)
	const taken = new Set<string>()
	const result: (ColumnSuggestion | undefined)[] = header.map(() => undefined)
	const choose = (index: number, field: string | null, reason: SuggestionReason): void => {
		result[index] = { field, reason }

		if (field !== null) {
			taken.add(field)
		}
	}
	const free = (field: FieldSchema): boolean => !taken.has(field.key)

	header.forEach((name, index) => {
		const key = headerKey(name)

		if (options.remembered && Object.hasOwn(options.remembered, key)) {
			const field = options.remembered[key] ?? null

			if (field === null) {
				choose(index, null, "remembered")
			} else if (schema.has(field) && schema.field(field).editable && !taken.has(field)) {
				choose(index, field, "remembered")
			}
		}
	})

	header.forEach((name, index) => {
		const field = result[index] ? null : fieldNamed(schema, name.trim())

		if (field?.editable && free(field)) {
			choose(index, field.key, "name")
		}
	})

	header.forEach((name, index) => {
		const words = wordsOf(name)

		if (result[index] || words.size === 0) {
			return
		}

		const scored = open.filter(free).map(field => ({ field, score: overlap(words, wordsOf(field.label)) }))
		const best = Math.max(0, ...scored.map(item => item.score))
		const top = scored.filter(item => item.score === best)

		if (best > 0 && top.length === 1 && top[0]) {
			choose(index, top[0].field.key, "similar")
		}
	})

	header.forEach((_, index) => {
		if (result[index]) {
			return
		}

		const texts = samplesOf(body, index, PROBE)
		const readers = open.filter(
			field =>
				free(field) && field.type !== "string" && field.type !== "lookup" && readsAs(field, texts, settings)
		)

		if (texts.length > 0 && readers.length === 1 && readers[0]) {
			choose(index, readers[0].key, "values")
		}
	})

	return result.map(item => item ?? { field: null, reason: null })
}

/** A header as `SuggestOptions.remembered` keeps it: trimmed and lower-cased, in Turkish. */
export function headerKey(header: string): string {
	return header.trim().toLocaleLowerCase("tr")
}

function readsAs(field: FieldSchema, texts: readonly string[], settings: ValueSettings): boolean {
	const read = texts.filter(text => readInput(field, text, settings).problem === null).length

	return texts.length > 0 && read / texts.length >= READABLE
}

const TURKISH: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }

/** The words of a header or a label, compared without case or Turkish letters: "Döviz kuru" is döviz, kuru. */
function wordsOf(text: string): Set<string> {
	const plain = text
		.toLocaleLowerCase("tr")
		.replace(/[çğıöşü]/g, letter => TURKISH[letter] ?? letter)
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")

	return new Set(plain.split(/[^a-z0-9]+/).filter(word => word.length > 1))
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
	const shared = [...a].filter(word => b.has(word)).length

	return shared === 0 ? 0 : shared / new Set([...a, ...b]).size
}

function samplesOf(body: readonly (readonly string[])[], index: number, limit: number): string[] {
	const found: string[] = []

	for (const line of body) {
		const text = (line[index] ?? "").trim()

		if (text !== "") {
			found.push(text)

			if (found.length === limit) {
				break
			}
		}
	}

	return found
}

// ---------------------------------------------------------------- finding the rows

/** The field types rows are found by: a code, a number, a record's name. */
const KEY_TYPES: ReadonlySet<string> = new Set(["string", "integer", "lookup"])

export interface MatchSuggestion {
	/** The table's column that finds the rows, by position. */
	readonly column: number
	/** The field of the sheet it finds them by. */
	readonly field: string
}

/**
 * The column most likely to find a table's rows in the sheet, and the field it finds them by: the
 * column whose values most often stand in some row's text, whole-number or lookup field, such as a
 * product code. Null when none finds half of the values it holds.
 */
export function suggestMatch(
	table: readonly (readonly string[])[],
	store: RowStore,
	options: { readonly schema: ModuleSchema; readonly settings: ValueSettings }
): MatchSuggestion | null {
	const { schema, settings } = options
	const [header = [], ...lines] = table
	const body = lines.filter(line => !line.every(cell => cell.trim() === ""))
	const fields = schema.fields.filter(field => KEY_TYPES.has(field.type))
	const indexes = new Map<string, Map<string, RowId[]>>()
	let best: MatchSuggestion | null = null
	let bestShare = 0

	for (let column = 0; column < header.length; column++) {
		const texts = samplesOf(body, column, PROBE)

		for (const field of texts.length === 0 ? [] : fields) {
			const index = indexes.get(field.key) ?? indexOf(store, field, settings)

			indexes.set(field.key, index)

			const found = texts.filter(text => {
				const key = textKey(field, text, settings)

				return key !== null && index.has(key)
			}).length
			const share = found / texts.length

			if (share >= 0.5 && share > bestShare) {
				best = { column, field: field.key }
				bestShare = share
			}
		}
	}

	return best
}

/**
 * The rows of the sheet each key finds: those whose `field` holds what the key's text reads as,
 * compared as a backend is sent them, so "1.001" finds 1001, and text without regard to case or the
 * spaces around it. A key that finds none gives an empty list; one that finds several, all of them.
 */
export function matchRows(
	store: RowStore,
	field: FieldSchema,
	keys: readonly string[],
	settings: ValueSettings
): RowId[][] {
	const index = indexOf(store, field, settings)

	return keys.map(text => {
		const key = textKey(field, text, settings)

		return key === null ? [] : [...(index.get(key) ?? [])]
	})
}

function indexOf(store: RowStore, field: FieldSchema, settings: ValueSettings): Map<string, RowId[]> {
	const index = new Map<string, RowId[]>()

	for (const rowId of store.rowIds()) {
		const key = valueKey(field, store.get(rowId, field.key), settings)

		if (key !== null) {
			const rows = index.get(key)

			if (rows) {
				rows.push(rowId)
			} else {
				index.set(key, [rowId])
			}
		}
	}

	return index
}

function textKey(field: FieldSchema, text: string, settings: ValueSettings): string | null {
	if (text.trim() === "") {
		return null
	}

	return field.type === "lookup" ? fold(text) : valueKey(field, readInput(field, text, settings).value, settings)
}

function valueKey(field: FieldSchema, value: CellValue, settings: ValueSettings): string | null {
	if (value === null) {
		return null
	}

	if (isLookupValue(value)) {
		return fold(value.label)
	}

	const canonical = canonicalValue(field, value, settings)

	return typeof canonical === "string" ? fold(canonical) : JSON.stringify(canonical)
}

// ---------------------------------------------------------------- into the sheet

/** The origin an import's change carries in the store and in the undo history. */
export const IMPORT_ORIGIN = "import"

export interface ImportApplyOptions {
	/**
	 * For each row of the import, the rows of the sheet it is written into, as `matchRows` found
	 * them: the values the file brought, an empty cell emptying the cell it lands in. Left out, every
	 * row is added.
	 */
	readonly matches?: readonly (readonly RowId[])[]
	/** With `matches`, what becomes of a row that found none: added at the end, or left out. */
	readonly unmatched?: "add" | "skip"
	/** Rows not to be written into, such as those the backend has processed. */
	readonly locked?: (rowId: RowId) => boolean
	readonly origin?: string
}

export interface ImportApplied {
	/** The rows added at the end, in order. */
	readonly added: readonly RowId[]
	/** How many rows of the sheet were written into. */
	readonly updated: number
	/** Rows of the file left out: finding none with `unmatched: "skip"`, or only rows locked. */
	readonly skipped: number
}

/**
 * An import put into the sheet as one change, taken back with one Ctrl+Z: rows written into where
 * `matches` found them, the others added at the end with the schema's defaults, or left out.
 */
export function applyImport(
	store: RowStore,
	schema: ModuleSchema,
	imported: TableImport,
	options: ImportApplyOptions = {}
): ImportApplied {
	const fields = imported.columns.flatMap(column =>
		column.status === "matched" && column.field ? [column.field] : []
	)
	const adding: RowInit[] = []
	const written = new Set<RowId>()
	let added: RowId[] = []
	let skipped = 0

	store.transact(
		() => {
			imported.rows.forEach((row, index) => {
				const targets = options.matches?.[index] ?? []

				if (targets.length === 0) {
					if (options.matches && options.unmatched === "skip") {
						skipped++
					} else {
						adding.push(row)
					}

					return
				}

				const open = targets.filter(rowId => store.has(rowId) && !options.locked?.(rowId))

				if (open.length === 0) {
					skipped++

					return
				}

				for (const rowId of open) {
					for (const key of fields) {
						store.setCell(rowId, key, row.values?.[key] ?? null)
					}

					written.add(rowId)
				}
			})

			if (adding.length > 0) {
				added = store.appendRows(withDefaults(schema, adding))
			}
		},
		{ origin: options.origin ?? IMPORT_ORIGIN }
	)

	return { added, updated: written.size, skipped }
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
