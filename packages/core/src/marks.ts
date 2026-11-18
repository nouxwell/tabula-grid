import { TabulaError } from "./errors.js"
import type { UndoHistory } from "./history.js"
import { Listeners } from "./listeners.js"
import type { RowId } from "./rows.js"

/**
 * What a user puts on cells by hand to find them again: a fill, a text colour, bold, italic. "These
 * I will look at later", "this one is wrong at the supplier's". Never a value: a mark is kept with
 * the draft, beside the rows, and nothing of it is sent to the backend.
 *
 * Colours are names, not codes, so a theme draws each in its own shade, light or dark.
 */

export const MARK_COLORS = Object.freeze([
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
	"orange",
	"grey",
	"red"
] as const)
export type MarkColor = (typeof MARK_COLORS)[number]

export interface CellMark {
	readonly fill?: MarkColor
	readonly color?: MarkColor
	readonly bold?: true
	readonly italic?: true
}

/** A change to cells' marks: a colour, or null to take it off; bold and italic on or off. */
export interface CellMarkChange {
	readonly fill?: MarkColor | null
	readonly color?: MarkColor | null
	readonly bold?: boolean
	readonly italic?: boolean
}

/** One cell, by its row's id and its field's key. */
export interface MarkedCell {
	readonly rowId: RowId
	readonly field: string
}

/** The marks as JSON keeps them: by row id, then by field key. */
export type MarksData = Readonly<Record<RowId, Readonly<Record<string, CellMark>>>>

export interface CellMarksOptions {
	/** Marks to start with, such as a draft's. */
	readonly marks?: MarksData
	/** Each change becomes a step of it, so Ctrl+Z takes it back in its turn with the rows' changes. */
	readonly history?: UndoHistory
}

/** The marks on a sheet's cells: read by the grid, changed by the toolbar, kept by the draft. */
export class CellMarks {
	readonly #cells = new Map<RowId, Map<string, CellMark>>()
	readonly #history: UndoHistory | null
	readonly #listeners = new Listeners<CellMarks>()
	#version = 0

	constructor(options: CellMarksOptions = {}) {
		this.#history = options.history ?? null

		for (const [rowId, cells] of Object.entries(options.marks ?? {})) {
			for (const [field, mark] of Object.entries(cells)) {
				this.#put(rowId, field, cleanMark(mark))
			}
		}
	}

	/** Moves on with every change, for a view to redraw by. */
	get version(): number {
		return this.#version
	}

	/** How many cells carry a mark. */
	get size(): number {
		let count = 0

		for (const cells of this.#cells.values()) {
			count += cells.size
		}

		return count
	}

	get(rowId: RowId, field: string): CellMark | null {
		return this.#cells.get(rowId)?.get(field) ?? null
	}

	/** Whether any cell of the row carries a mark. */
	hasRow(rowId: RowId): boolean {
		return this.#cells.has(rowId)
	}

	/** The rows with a marked cell. */
	rows(): RowId[] {
		return [...this.#cells.keys()]
	}

	/** Puts the change on every cell given: a colour given replaces the one there, null takes it off. */
	mark(cells: readonly MarkedCell[], change: CellMarkChange): void {
		checkChange(change)
		this.#change(cells, mark => {
			const next: { fill?: MarkColor; color?: MarkColor; bold?: true; italic?: true } = { ...mark }

			for (const name of ["fill", "color"] as const) {
				if (change[name] === null) {
					delete next[name]
				} else if (change[name] !== undefined) {
					next[name] = change[name]
				}
			}

			for (const name of ["bold", "italic"] as const) {
				if (change[name] === false) {
					delete next[name]
				} else if (change[name] === true) {
					next[name] = true
				}
			}

			return next
		})
	}

	/** Bold or italic on every cell given, or off when every one already has it, as a spreadsheet's button. */
	toggle(cells: readonly MarkedCell[], style: "bold" | "italic"): void {
		const on = !cells.every(cell => this.get(cell.rowId, cell.field)?.[style] === true)

		this.mark(cells, { [style]: on })
	}

	/** Takes every mark off the cells given. */
	clear(cells: readonly MarkedCell[]): void {
		this.#change(cells, () => ({}))
	}

	/** Every mark, as JSON keeps them; only the rows given, such as the rows the sheet still has. */
	toJSON(rowIds?: Iterable<RowId>): MarksData {
		const keep = rowIds === undefined ? null : new Set(rowIds)
		const data: Record<RowId, Record<string, CellMark>> = {}

		for (const [rowId, cells] of this.#cells) {
			if (keep === null || keep.has(rowId)) {
				data[rowId] = Object.fromEntries(cells)
			}
		}

		return data
	}

	/** Called after each change. Returns the way to stop. */
	subscribe(listener: (marks: CellMarks) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Changes the cells, as one step of the history when there is one. */
	#change(cells: readonly MarkedCell[], next: (mark: CellMark) => CellMark): void {
		const before: [MarkedCell, CellMark | null][] = []
		const after: [MarkedCell, CellMark | null][] = []

		for (const cell of cells) {
			const old = this.get(cell.rowId, cell.field)
			const made = cleanMark(next(old ?? {}))
			const now = Object.keys(made).length === 0 ? null : made

			if (!sameMark(old, now)) {
				before.push([cell, old])
				after.push([cell, now])
			}
		}

		if (after.length === 0) {
			return
		}

		this.#apply(after)
		this.#history?.record({ undo: () => this.#apply(before), redo: () => this.#apply(after) })
	}

	#apply(entries: readonly (readonly [MarkedCell, CellMark | null])[]): void {
		for (const [cell, mark] of entries) {
			this.#put(cell.rowId, cell.field, mark)
		}

		this.#version++
		this.#listeners.emit(this)
	}

	#put(rowId: RowId, field: string, mark: CellMark | null): void {
		const cells = this.#cells.get(rowId)

		if (mark === null || Object.keys(mark).length === 0) {
			cells?.delete(field)

			if (cells?.size === 0) {
				this.#cells.delete(rowId)
			}

			return
		}

		if (cells) {
			cells.set(field, mark)
		} else {
			this.#cells.set(rowId, new Map([[field, mark]]))
		}
	}
}

/** The rows with a marked cell, for a `RowView` filter: the sheet's "Renkli" rows. */
export function rowsMarked(marks: CellMarks): (rowId: RowId) => boolean {
	return rowId => marks.hasRow(rowId)
}

/**
 * Marks read from JSON, such as a draft's, each problem reported under `path`. A colour that is not
 * one, or a cell that is not an object, is a problem; an empty mark is dropped.
 */
export function readMarks(input: unknown, path: string, problem: (path: string, message: string) => void): MarksData {
	if (input === undefined || input === null) {
		return {}
	}

	const rows = plain(input)

	if (!rows) {
		problem(path, "must be an object of marks by row id, then field key.")

		return {}
	}

	const data: Record<RowId, Record<string, CellMark>> = {}

	for (const [rowId, value] of Object.entries(rows)) {
		const cells = plain(value)

		if (!cells) {
			problem(`${path}.${rowId}`, "must be an object of marks by field key.")
			continue
		}

		for (const [field, raw] of Object.entries(cells)) {
			const mark = plain(raw)
			const at = `${path}.${rowId}.${field}`

			if (!mark) {
				problem(at, 'must be an object such as { fill: "yellow", bold: true }.')
				continue
			}

			const read: { fill?: MarkColor; color?: MarkColor; bold?: true; italic?: true } = {}

			for (const name of ["fill", "color"] as const) {
				if (mark[name] === undefined) {
					continue
				}

				if ((MARK_COLORS as readonly unknown[]).includes(mark[name])) {
					read[name] = mark[name] as MarkColor
				} else {
					problem(`${at}.${name}`, `must be one of ${MARK_COLORS.join(", ")}.`)
				}
			}

			for (const name of ["bold", "italic"] as const) {
				if (mark[name] === true) {
					read[name] = true
				} else if (mark[name] !== undefined && mark[name] !== false) {
					problem(`${at}.${name}`, "must be true or false.")
				}
			}

			if (Object.keys(read).length > 0) {
				data[rowId] = { ...data[rowId], [field]: Object.freeze(read) }
			}
		}
	}

	return data
}

function checkChange(change: CellMarkChange): void {
	for (const name of ["fill", "color"] as const) {
		const color = change[name]

		if (color !== undefined && color !== null && !(MARK_COLORS as readonly unknown[]).includes(color)) {
			throw new TabulaError(
				"invalid_argument",
				`A mark's ${name} is one of ${MARK_COLORS.join(", ")}; got ${color}.`
			)
		}
	}
}

function cleanMark(mark: CellMark): CellMark {
	return Object.freeze({
		...(mark.fill ? { fill: mark.fill } : {}),
		...(mark.color ? { color: mark.color } : {}),
		...(mark.bold ? { bold: true as const } : {}),
		...(mark.italic ? { italic: true as const } : {})
	})
}

function sameMark(a: CellMark | null, b: CellMark | null): boolean {
	return (
		(a?.fill ?? null) === (b?.fill ?? null) &&
		(a?.color ?? null) === (b?.color ?? null) &&
		(a?.bold ?? false) === (b?.bold ?? false) &&
		(a?.italic ?? false) === (b?.italic ?? false)
	)
}

function plain(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}
