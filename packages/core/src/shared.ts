import { TabulaError } from "./errors.js"
import type { RowId, RowStore } from "./rows.js"
import type { FieldSchema, ModuleSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import { canonicalValue, isLookupValue } from "./values/read.js"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings.js"

/** One sheet's rows, as `sharedRecords` reads them. */
export interface SheetRows {
	/** The sheet's id, as its workbook has it. */
	readonly sheetId: string
	readonly schema: ModuleSchema
	readonly store: RowStore
	/** The rows to look at, such as those a run would send; every row with a record by default. */
	readonly rows?: readonly RowId[]
}

/** A record's row in one sheet, with the values compared. */
export interface SharedRecordRow {
	readonly sheetId: string
	readonly rowId: RowId
	readonly values: Readonly<Record<string, CellValue>>
}

/** A record more than one sheet holds a row of, such as a product two price lists change. */
export interface SharedRecord {
	/** The record as compared: a lookup's id, or the value as the backend would read it. */
	readonly key: string
	/** The record as a person reads it: a lookup's label, or the value. */
	readonly label: string
	/** Its rows, in the order the sheets were given, one per sheet. */
	readonly rows: readonly SharedRecordRow[]
	/** The fields its rows hold different values in; empty when every sheet would send the same. */
	readonly differs: readonly string[]
}

export interface SharedRecordsOptions {
	/** The field that names a row's record in every sheet, such as its product. */
	readonly key: string
	/** The fields compared; by default every field each sheet can write, bar the key. */
	readonly fields?: readonly string[]
	/** How values are read to be compared, so "12,5" and 12.5 are the same price. */
	readonly settings?: ValueSettings
}

/**
 * The records more than one sheet of a workbook holds a row of: before the sheets are sent one
 * after another, a record two of them change differently is one the user decides about, since the
 * sheet sent last would otherwise win without anyone seeing it. A sheet with two rows of the same
 * record counts once, by its first row; a row with no record is passed over.
 */
export function sharedRecords(sheets: readonly SheetRows[], options: SharedRecordsOptions): SharedRecord[] {
	const settings = options.settings ?? VALUE_SETTINGS.en
	const found = new Map<string, { label: string; rows: SharedRecordRow[] }>()

	for (const sheet of sheets) {
		if (!sheet.schema.has(options.key)) {
			throw new TabulaError(
				"invalid_argument",
				`Sheet "${sheet.sheetId}" has no field "${options.key}" to tell its records by.`
			)
		}

		const keyField = sheet.schema.field(options.key)
		const compared = (options.fields ?? writable(sheet.schema, options.key)).filter(key => sheet.schema.has(key))
		const seen = new Set<string>()

		for (const rowId of sheet.rows ?? sheet.store.rowIds()) {
			const record = sheet.store.get(rowId, options.key)
			const key = recordKey(keyField, record ?? null, settings)

			if (key === null || seen.has(key)) {
				continue
			}

			seen.add(key)

			const values = Object.fromEntries(compared.map(field => [field, sheet.store.get(rowId, field) ?? null]))
			const entry = found.get(key) ?? { label: recordLabel(record ?? null), rows: [] }

			entry.rows.push(Object.freeze({ sheetId: sheet.sheetId, rowId, values: Object.freeze(values) }))
			found.set(key, entry)
		}
	}

	const fieldsOf = new Map(sheets.map(sheet => [sheet.sheetId, sheet.schema]))
	const shared: SharedRecord[] = []

	for (const [key, entry] of found) {
		if (entry.rows.length < 2) {
			continue
		}

		const keys = [...new Set(entry.rows.flatMap(row => Object.keys(row.values)))]
		const differs = keys.filter(field => {
			const seen = new Set(
				entry.rows.map(row => {
					const schema = fieldsOf.get(row.sheetId)

					return schema?.has(field)
						? compareText(schema.field(field), row.values[field] ?? null, settings)
						: ""
				})
			)

			return seen.size > 1
		})

		shared.push(
			Object.freeze({
				key,
				label: entry.label,
				rows: Object.freeze(entry.rows),
				differs: Object.freeze(differs)
			})
		)
	}

	return shared
}

/** The fields a sheet sends that a person writes: editable, and not the record itself. */
function writable(schema: ModuleSchema, key: string): string[] {
	return schema.fields.filter(field => field.editable && field.key !== key).map(field => field.key)
}

function recordKey(field: FieldSchema, value: CellValue, settings: ValueSettings): string | null {
	if (value === null || value === "") {
		return null
	}

	return isLookupValue(value) ? `id:${String(value.id)}` : compareText(field, value, settings)
}

function recordLabel(value: CellValue): string {
	return isLookupValue(value) ? value.label : String(value ?? "")
}

/** A value as it is compared: what the backend would read it as, options in any order. */
function compareText(field: FieldSchema, value: CellValue, settings: ValueSettings): string {
	if (value === null || value === "") {
		return ""
	}

	if (isLookupValue(value)) {
		return `id:${String(value.id)}`
	}

	const read = canonicalValue(field, value, settings)

	return JSON.stringify(Array.isArray(read) ? [...read].sort() : read)
}
