import type { RowId, RowStore, StoreChange } from "./rows.js"
import type { ModuleSchema } from "./schema.js"
import { formatCell } from "./values/format.js"
import { readInput } from "./values/read.js"
import type { ValueSettings } from "./values/settings.js"

/**
 * Find and replace over a sheet, as a spreadsheet's Ctrl+H: text looked for in the cells as they are
 * shown, "1.533,80", "Mağaza, Web", and replaced as if it had been typed into each, so a number stays
 * a number and an option an option. Every replacement is one change of the store: one Ctrl+Z.
 */

/** The origin of the change `replaceCells` makes, as `StoreChange.origin` gives it. */
export const REPLACE_ORIGIN = "replace"

export interface FindOptions {
	readonly settings: ValueSettings
	/** Upper and lower case told apart. Off by default. */
	readonly matchCase?: boolean
	/** Only a cell whose whole text is what is looked for. Off by default. */
	readonly whole?: boolean
	/** The language case is folded in, the page's: in Turkish "I" is "ı" in lower case. */
	readonly locale?: string
}

/** A cell, by its row's id and its field's key. */
export interface FoundCell {
	readonly rowId: RowId
	readonly field: string
}

/**
 * The cells holding `text`, row by row in the order given, and in each row field by field in the
 * order given: where Next goes. Empty text finds nothing.
 */
export function findCells(
	store: RowStore,
	schema: ModuleSchema,
	rowIds: readonly RowId[],
	fields: readonly string[],
	text: string,
	options: FindOptions
): FoundCell[] {
	if (text === "") {
		return []
	}

	const matches = matcher(text, options)
	const known = fields.filter(key => schema.has(key))
	const found: FoundCell[] = []

	for (const rowId of rowIds) {
		for (const field of known) {
			if (matches(formatCell(schema.field(field), store.get(rowId, field), options.settings))) {
				found.push({ rowId, field })
			}
		}
	}

	return found
}

export interface ReplaceOptions extends FindOptions {
	/** Whether a cell may be written; a cell refused is left as it is and counted. All may by default. */
	readonly editable?: (rowId: RowId, field: string) => boolean
	readonly origin?: string
}

export interface ReplaceResult {
	/** Cells written. */
	readonly replaced: number
	/** Cells left as they were: their column or row cannot be written. */
	readonly skipped: number
	/** The store's change; null when nothing was written. */
	readonly change: StoreChange | null
}

/**
 * Replaces `text` with `replacement` in the cells given, such as `findCells`' answer, in one change.
 * Each cell's new text is read as typing it would be read; text that cannot be read is kept as typed
 * and its cell says why, as a paste does. A column that cannot be typed into, or a formula's, is
 * left as it is.
 */
export function replaceCells(
	store: RowStore,
	schema: ModuleSchema,
	cells: readonly FoundCell[],
	text: string,
	replacement: string,
	options: ReplaceOptions
): ReplaceResult {
	if (text === "") {
		return { replaced: 0, skipped: 0, change: null }
	}

	const writes: { rowId: RowId; field: string; value: ReturnType<typeof readInput>["value"] }[] = []
	let skipped = 0

	for (const cell of cells) {
		if (!schema.has(cell.field) || !store.has(cell.rowId)) {
			continue
		}

		const field = schema.field(cell.field)

		if (!field.editable || field.formula || options.editable?.(cell.rowId, cell.field) === false) {
			skipped++
			continue
		}

		const shown = formatCell(field, store.get(cell.rowId, cell.field), options.settings)
		const next = replaced(shown, text, replacement, options)

		if (next === null) {
			continue
		}

		writes.push({ rowId: cell.rowId, field: cell.field, value: readInput(field, next, options.settings).value })
	}

	const change = writes.length === 0 ? null : store.setCells(writes, { origin: options.origin ?? REPLACE_ORIGIN })

	return { replaced: writes.length, skipped, change }
}

function matcher(text: string, options: FindOptions): (shown: string) => boolean {
	const fold = (value: string): string => (options.matchCase ? value : value.toLocaleLowerCase(options.locale))
	const wanted = fold(text)

	return shown => (options.whole ? fold(shown) === wanted : fold(shown).includes(wanted))
}

/** The cell's text with every match replaced; null when it holds none. */
function replaced(shown: string, text: string, replacement: string, options: FindOptions): string | null {
	const fold = (value: string): string => (options.matchCase ? value : value.toLocaleLowerCase(options.locale))

	if (options.whole) {
		return fold(shown) === fold(text) ? replacement : null
	}

	const haystack = fold(shown)
	const needle = fold(text)
	let at = haystack.indexOf(needle)

	if (at < 0) {
		return null
	}

	// Folding case can change a text's length ("İ" in some languages); then the match is replaced whole.
	if (haystack.length !== shown.length) {
		return haystack.split(needle).join(replacement)
	}

	let result = ""
	let from = 0

	while (at >= 0) {
		result += shown.slice(from, at) + replacement
		from = at + needle.length
		at = haystack.indexOf(needle, from)
	}

	return result + shown.slice(from)
}
