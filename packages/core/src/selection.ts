import { TabulaError } from "./errors"
import { Listeners } from "./listeners"

/**
 * Which cells are selected, in the positions the user sees: row and column indexes on screen, after
 * sorting, filtering and hiding. Turning a position into a row id and a field is the view's job.
 *
 * It follows Excel. The active cell, the one typing goes into, stays put while Shift extends the
 * selection; what moves is the opposite corner, the head. A plain move collapses the selection onto
 * one cell again.
 */

export interface CellPosition {
	readonly row: number
	readonly col: number
}

/** Inclusive on all four sides. */
export interface CellRange {
	readonly top: number
	readonly left: number
	readonly bottom: number
	readonly right: number
}

export type Direction = "up" | "down" | "left" | "right"

export interface MoveOptions {
	/** Move the head and keep the active cell, as Shift does. */
	readonly extend?: boolean
}

/** Whether the cell at a position is empty, for `jump()`. */
export type IsBlank = (row: number, col: number) => boolean

const STEPS: Readonly<Record<Direction, CellPosition>> = {
	up: { row: -1, col: 0 },
	down: { row: 1, col: 0 },
	left: { row: 0, col: -1 },
	right: { row: 0, col: 1 }
}

export class Selection {
	#rowCount: number
	#colCount: number
	#active: CellPosition | null = null
	/** The corner that stays when Shift extends the selection; usually the active cell. */
	#pivot: CellPosition | null = null
	#head: CellPosition | null = null
	readonly #listeners = new Listeners<Selection>()

	constructor(rowCount: number, colCount: number) {
		this.#rowCount = requireCount(rowCount, "rowCount")
		this.#colCount = requireCount(colCount, "colCount")

		if (!this.#isEmpty()) {
			this.#active = this.#pivot = this.#head = cell(0, 0)
		}
	}

	get rowCount(): number {
		return this.#rowCount
	}

	get colCount(): number {
		return this.#colCount
	}

	/** The cell typing goes into. Null when the grid has no cells. */
	get active(): CellPosition | null {
		return this.#active
	}

	/** The corner Shift moves; the one to keep on screen while extending. Null when the grid has no cells. */
	get head(): CellPosition | null {
		return this.#head
	}

	get range(): CellRange | null {
		return this.#pivot && this.#head ? rangeOf(this.#pivot, this.#head) : null
	}

	contains(row: number, col: number): boolean {
		const range = this.range

		return range !== null && within(range, cell(row, col))
	}

	isActive(row: number, col: number): boolean {
		return this.#active !== null && this.#active.row === row && this.#active.col === col
	}

	/** Goes to a cell, kept inside the grid: `moveTo(Infinity, Infinity)` is the last cell. */
	moveTo(row: number, col: number, options: MoveOptions = {}): void {
		const target = this.#clamp(row, col)

		if (target === null || this.#active === null || this.#pivot === null) {
			return
		}

		if (options.extend) {
			this.#commit(this.#active, this.#pivot, target)
		} else {
			this.#commit(target, target, target)
		}
	}

	/** Moves by a number of rows and columns: from the head when extending, from the active cell otherwise. */
	move(rows: number, cols: number, options: MoveOptions = {}): void {
		const from = options.extend ? this.#head : this.#active

		if (from !== null) {
			this.moveTo(from.row + rows, from.col + cols, options)
		}
	}

	/**
	 * Ctrl and an arrow, as in Excel: inside a run of filled cells, to the end of the run; otherwise to
	 * the next filled cell, or to the edge of the grid when there is none.
	 */
	jump(direction: Direction, isBlank: IsBlank, options: MoveOptions = {}): void {
		const from = options.extend ? this.#head : this.#active

		if (from === null) {
			return
		}

		const target = edgeOf(from, STEPS[direction], this.#rowCount, this.#colCount, isBlank)

		this.moveTo(target.row, target.col, options)
	}

	/** Whole rows, `from` through `to`. The active cell goes to the first column of `from`. */
	selectRows(from: number, to: number = from): void {
		const start = this.#clamp(from, 0)
		const end = this.#clamp(to, Infinity)

		if (start !== null && end !== null) {
			this.#commit(start, start, end)
		}
	}

	/** Whole columns, `from` through `to`. The active cell goes to the first row of `from`. */
	selectColumns(from: number, to: number = from): void {
		const start = this.#clamp(0, from)
		const end = this.#clamp(Infinity, to)

		if (start !== null && end !== null) {
			this.#commit(start, start, end)
		}
	}

	/** Every cell. The active cell stays where it is. */
	selectAll(): void {
		const start = this.#clamp(0, 0)
		const end = this.#clamp(Infinity, Infinity)

		if (start !== null && end !== null && this.#active !== null) {
			this.#commit(this.#active, start, end)
		}
	}

	/** The grid changed size, such as after rows were deleted. Everything is kept inside it. */
	resize(rowCount: number, colCount: number): void {
		this.#rowCount = requireCount(rowCount, "rowCount")
		this.#colCount = requireCount(colCount, "colCount")

		if (this.#isEmpty()) {
			if (this.#active !== null) {
				this.#active = this.#pivot = this.#head = null
				this.#listeners.emit(this)
			}

			return
		}

		const active = this.#active ?? cell(0, 0)
		const pivot = this.#pivot ?? active
		const head = this.#head ?? active

		this.#commit(this.#clampCell(active), this.#clampCell(pivot), this.#clampCell(head))
	}

	/** Called after each change of the selection. Returns the way to stop. */
	subscribe(listener: (selection: Selection) => void): () => void {
		return this.#listeners.add(listener)
	}

	#isEmpty(): boolean {
		return this.#rowCount === 0 || this.#colCount === 0
	}

	#clamp(row: number, col: number): CellPosition | null {
		if (Number.isNaN(row) || Number.isNaN(col)) {
			throw new TabulaError("invalid_argument", `A cell position must be a number; got ${row}, ${col}.`)
		}

		return this.#isEmpty() ? null : this.#clampCell(cell(row, col))
	}

	#clampCell(position: CellPosition): CellPosition {
		return cell(
			Math.min(this.#rowCount - 1, Math.max(0, Math.trunc(position.row))),
			Math.min(this.#colCount - 1, Math.max(0, Math.trunc(position.col)))
		)
	}

	#commit(active: CellPosition, pivot: CellPosition, head: CellPosition): void {
		// Shrinking the selection past the active cell would leave typing going into a cell that is not
		// selected. The fixed corner takes over.
		const settled = within(rangeOf(pivot, head), active) ? active : pivot

		if (same(settled, this.#active) && same(pivot, this.#pivot) && same(head, this.#head)) {
			return
		}

		this.#active = settled
		this.#pivot = pivot
		this.#head = head
		this.#listeners.emit(this)
	}
}

function edgeOf(
	from: CellPosition,
	step: CellPosition,
	rowCount: number,
	colCount: number,
	isBlank: IsBlank
): CellPosition {
	const inside = (position: CellPosition): boolean =>
		position.row >= 0 && position.row < rowCount && position.col >= 0 && position.col < colCount
	const blank = (position: CellPosition): boolean => isBlank(position.row, position.col)
	const advance = (position: CellPosition): CellPosition => cell(position.row + step.row, position.col + step.col)

	let current = from
	let next = advance(current)

	if (!inside(next)) {
		return current
	}

	if (!blank(current) && !blank(next)) {
		while (inside(next) && !blank(next)) {
			current = next
			next = advance(next)
		}

		return current
	}

	current = next

	while (blank(current)) {
		next = advance(current)

		if (!inside(next)) {
			return current
		}

		current = next
	}

	return current
}

function cell(row: number, col: number): CellPosition {
	return Object.freeze({ row, col })
}

function rangeOf(a: CellPosition, b: CellPosition): CellRange {
	return Object.freeze({
		top: Math.min(a.row, b.row),
		left: Math.min(a.col, b.col),
		bottom: Math.max(a.row, b.row),
		right: Math.max(a.col, b.col)
	})
}

function within(range: CellRange, position: CellPosition): boolean {
	return (
		position.row >= range.top &&
		position.row <= range.bottom &&
		position.col >= range.left &&
		position.col <= range.right
	)
}

function same(a: CellPosition, b: CellPosition | null): boolean {
	return b !== null && a.row === b.row && a.col === b.col
}

function requireCount(count: number, name: string): number {
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new TabulaError("invalid_argument", `${name} must be a whole number, 0 or more; got ${count}.`)
	}

	return count
}
