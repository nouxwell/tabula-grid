import type { RowOutcome } from "./contract"
import { Listeners } from "./listeners"
import type { RowId, RowStore, StoreChange } from "./rows"
import type { RowResults } from "./session"
import type { IssueSet } from "./validation"

/** Whether a row is to be shown. */
export type RowFilter = (rowId: RowId) => boolean

/**
 * The rows on screen, in the order the sheet has them: all of them, or those a filter kept.
 *
 * A filter is applied at a moment, as a spreadsheet's is. Fixing the issue that put a row in the
 * view does not take it out under the user's cursor; `refresh()` applies the filter again. Rows
 * added while it stands are shown, so a paste lands where the user can see it, and rows removed go.
 *
 * Positions on screen are positions in the view; a row's place in the sheet is the store's.
 */
export class RowView {
	readonly store: RowStore
	readonly #listeners = new Listeners<RowView>()
	readonly #stop: () => void
	#filter: RowFilter | null = null
	/** The rows shown, when a filter stands; null when every row is. */
	#ids: RowId[] | null = null
	#positions: Map<RowId, number> | null = null
	#version = 0

	constructor(store: RowStore) {
		this.store = store
		this.#stop = store.subscribe(change => this.#onChange(change))
	}

	/** Moves whenever the rows shown change: a filter, a refresh, rows added or removed. */
	get version(): number {
		return this.#version
	}

	/** Whether a filter stands. */
	get filtered(): boolean {
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

	/** Shows only the rows `filter` keeps, as the sheet stands now. */
	filter(filter: RowFilter): void {
		this.#filter = filter
		this.#apply()
	}

	/** Applies the filter again, to the sheet as it stands now. */
	refresh(): void {
		if (this.#filter) {
			this.#apply()
		}
	}

	/** Shows every row again. */
	clear(): void {
		if (this.#ids === null) {
			return
		}

		this.#filter = null
		this.#ids = null
		this.#positions = null
		this.#changed()
	}

	/**
	 * Shows a row the filter left out, in its place among the others, such as when the user goes
	 * to an issue on it. False when there is no such row.
	 */
	show(rowId: RowId): boolean {
		if (!this.store.has(rowId)) {
			return false
		}

		if (this.#ids && this.indexOf(rowId) < 0) {
			const shown = new Set(this.#ids).add(rowId)

			this.#rebuild(shown)
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
		const filter = this.#filter

		if (!filter) {
			return
		}

		this.#ids = this.store.rowIds().filter(rowId => filter(rowId))
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

	/** The rows in `shown`, in the order the sheet has them. */
	#rebuild(shown: ReadonlySet<RowId>): void {
		this.#ids = this.store.rowIds().filter(rowId => shown.has(rowId))
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
