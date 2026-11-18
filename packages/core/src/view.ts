import type { RowOutcome } from "./contract.js"
import { Listeners } from "./listeners.js"
import type { RowId, RowStore, StoreChange } from "./rows.js"
import type { RowResults } from "./session.js"
import type { IssueSet } from "./validation.js"

/** Whether a row is to be shown. */
export type RowFilter = (rowId: RowId) => boolean

/** Which of two rows comes first: below zero for `a`, above zero for `b`, zero for either. */
export type RowOrder = (a: RowId, b: RowId) => number

/** The filter `filter()` sets when given no name. */
const DEFAULT_FILTER = "default"

/**
 * The rows on screen: all of them in the sheet's order, or those its filters keep, in the order a
 * sort puts them.
 *
 * Filters have names, so several stand together and each is taken away alone: the grid's column
 * filters and an issue panel's "only rows with issues" are two, and a row is shown when every one
 * keeps it. Filters and a sort are applied at a moment, as a spreadsheet's are. Fixing the issue that
 * put a row in the view does not take it out under the user's cursor, and changing a price does not
 * move its row; `refresh()` applies them again. Rows added meanwhile are shown, at their places in
 * the sheet's order, or after the others while a sort stands, so a paste lands where the user can
 * see it; rows removed go.
 *
 * Positions on screen are positions in the view; a row's place in the sheet is the store's.
 */
export class RowView {
	readonly store: RowStore
	readonly #listeners = new Listeners<RowView>()
	readonly #stop: () => void
	readonly #filters = new Map<string, RowFilter>()
	#order: RowOrder | null = null
	/** The rows shown, while a filter or a sort stands; null when every row is, in the sheet's order. */
	#ids: RowId[] | null = null
	#positions: Map<RowId, number> | null = null
	#version = 0

	constructor(store: RowStore) {
		this.store = store
		this.#stop = store.subscribe(change => this.#onChange(change))
	}

	/** Moves whenever the rows shown change: a filter, a sort, a refresh, rows added or removed. */
	get version(): number {
		return this.#version
	}

	/** Whether a filter stands. */
	get filtered(): boolean {
		return this.#filters.size > 0
	}

	/** Whether a sort stands. */
	get sorted(): boolean {
		return this.#order !== null
	}

	/**
	 * Whether the rows shown are other than every row in the sheet's order, filtered or sorted:
	 * positions on screen and in the sheet then differ.
	 */
	get arranged(): boolean {
		return this.#ids !== null
	}

	/** How many rows are shown. */
	get size(): number {
		return this.#ids?.length ?? this.store.size
	}

	rowIdAt(index: number): RowId | undefined {
		return this.#ids ? this.#ids[index] : this.store.rowIdAt(index)
	}

	/** Where the row is shown, or -1 when it is not. */
	indexOf(rowId: RowId): number {
		if (!this.#ids) {
			return this.store.indexOf(rowId)
		}

		if (!this.#positions) {
			this.#positions = new Map(this.#ids.map((id, index) => [id, index]))
		}

		return this.#positions.get(rowId) ?? -1
	}

	/**
	 * Shows only the rows `filter` keeps, with the others that stand, as the sheet is now. A filter
	 * of the same name is replaced.
	 */
	filter(filter: RowFilter, name: string = DEFAULT_FILTER): void {
		this.#filters.set(name, filter)
		this.#apply()
	}

	/** Puts the rows shown in this order, as the sheet is now; null goes back to the sheet's. */
	sort(order: RowOrder | null): void {
		if (order === null && this.#order === null) {
			return
		}

		this.#order = order
		this.#apply()
	}

	/** Applies the filters and the sort again, to the sheet as it is now. */
	refresh(): void {
		if (this.#ids !== null) {
			this.#apply()
		}
	}

	/** Takes away the filter of that name; with none, every filter and the sort, showing every row. */
	clear(name?: string): void {
		if (name !== undefined) {
			if (this.#filters.delete(name)) {
				this.#apply()
			}

			return
		}

		if (this.#ids === null && this.#filters.size === 0 && this.#order === null) {
			return
		}

		this.#filters.clear()
		this.#order = null
		this.#apply()
	}

	/**
	 * Shows a row a filter left out, in its place among the others, such as when the user goes to an
	 * issue on it. False when there is no such row.
	 */
	show(rowId: RowId): boolean {
		if (!this.store.has(rowId)) {
			return false
		}

		const ids = this.#ids

		if (ids && this.indexOf(rowId) < 0) {
			if (this.#order) {
				const order = this.#order
				const at = ids.findIndex(other => order(rowId, other) < 0)

				ids.splice(at < 0 ? ids.length : at, 0, rowId)
				this.#positions = null
				this.#changed()
			} else {
				this.#rebuild(new Set(ids).add(rowId))
			}
		}

		return true
	}

	subscribe(listener: (view: RowView) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Stops following the store. */
	dispose(): void {
		this.#stop()
	}

	#apply(): void {
		if (this.#filters.size === 0 && this.#order === null) {
			if (this.#ids !== null) {
				this.#ids = null
				this.#positions = null
				this.#changed()
			}

			return
		}

		const filters = [...this.#filters.values()]
		const ids = this.store.rowIds().filter(rowId => filters.every(filter => filter(rowId)))

		// Array.prototype.sort is stable: rows the order holds equal keep the sheet's order.
		if (this.#order) {
			ids.sort(this.#order)
		}

		this.#ids = ids
		this.#positions = null
		this.#changed()
	}

	#onChange(change: StoreChange): void {
		const shape = change.operations.some(operation => operation.kind !== "set")

		if (!shape) {
			return
		}

		if (this.#ids) {
			const shown = new Set(this.#ids)

			for (const operation of change.operations) {
				if (operation.kind === "insert") {
					for (const row of operation.rows) {
						shown.add(row.rowId)
					}
				}
			}

			// Rows removed drop out by themselves: the rebuild keeps only rows the store still has.
			this.#rebuild(shown)
		} else {
			this.#changed()
		}
	}

	/**
	 * The rows in `shown` the store still has: in the sheet's order, or, while a sort stands, in the
	 * order shown so far, with rows new to the view after them in the sheet's order.
	 */
	#rebuild(shown: ReadonlySet<RowId>): void {
		if (this.#order && this.#ids) {
			const kept = this.#ids.filter(rowId => this.store.has(rowId))
			const present = new Set(kept)
			const added = this.store.rowIds().filter(rowId => shown.has(rowId) && !present.has(rowId))

			this.#ids = [...kept, ...added]
		} else {
			this.#ids = this.store.rowIds().filter(rowId => shown.has(rowId))
		}

		this.#positions = null
		this.#changed()
	}

	#changed(): void {
		this.#version++
		this.#listeners.emit(this)
	}
}

/** The rows with an issue on them, standing or waiting to be checked again. */
export function rowsWithIssues(issues: IssueSet): RowFilter {
	return rowId => issues.hasIssues(rowId)
}

/** The rows whose last result from the backend is one of `outcomes`, such as the ones that failed. */
export function rowsWithResult(results: RowResults, outcomes: readonly RowOutcome[]): RowFilter {
	return rowId => {
		const outcome = results.resultOf(rowId)?.outcome

		return outcome !== undefined && outcomes.includes(outcome)
	}
}
