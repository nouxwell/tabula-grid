import { filterKeys } from "./filters.js"
import { Listeners } from "./listeners.js"
import type { RowId, RowInit, RowStore, StoreChange } from "./rows.js"
import type { FieldSchema, ModuleSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import type { RowFilter } from "./view.js"
import { canonicalValue } from "./values/read.js"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings.js"

export interface SheetChangesOptions {
	readonly schema: ModuleSchema
	readonly store: RowStore
	/**
	 * The rows as they were loaded, to compare the sheet with: the backend's rows, say, when a draft
	 * is opened over them. Left out, the store as it is now.
	 */
	readonly baseline?: readonly RowInit[]
	/**
	 * The field that names a row in the baseline and in the sheet alike, such as its product: rows
	 * are matched by it. Left out, rows are matched by their ids, which the baseline must then carry.
	 */
	readonly key?: string
	readonly settings?: ValueSettings
}

export interface ChangeSummary {
	/** Rows with a change, the added ones among them. */
	readonly rows: number
	/** Cells holding other than they did. */
	readonly cells: number
	/** Rows the baseline did not have. */
	readonly added: number
	/** Rows of the baseline the sheet no longer has. */
	readonly missing: number
}

/**
 * What the user changed since the sheet was loaded: each cell that holds other than it did, and each
 * row added since. Only fields that are sent are followed; a column worked out from others, or one
 * shown for reference, moves with them and has no change of its own.
 *
 * Values are compared as the backend would read them: 12.5 and "12.50" are the same, a record is its
 * id, a multi-select's options count in any order. A row whose key changes is another row: an added
 * one, while the one it was goes missing. Taking a change back takes its mark away.
 */
export class SheetChanges {
	readonly schema: ModuleSchema
	readonly store: RowStore

	readonly #fields: readonly FieldSchema[]
	readonly #key: FieldSchema | null
	readonly #settings: ValueSettings
	readonly #listeners = new Listeners<SheetChanges>()
	readonly #stop: () => void
	/** Each baseline row by its key, with each followed field's value as it is compared. */
	readonly #baseline = new Map<string, ReadonlyMap<string, string>>()
	/** The fields changed in each row; in a row added, every one with a value. */
	readonly #changed = new Map<RowId, ReadonlySet<string>>()
	readonly #added = new Set<RowId>()
	/** Each row's key now, and how many rows hold each key, for the baseline rows gone missing. */
	readonly #keys = new Map<RowId, string>()
	readonly #holding = new Map<string, number>()
	#version = 0

	constructor(options: SheetChangesOptions) {
		this.schema = options.schema
		this.store = options.store
		this.#settings = options.settings ?? VALUE_SETTINGS.tr
		this.#fields = options.schema.fields.filter(field => field.submit)
		this.#key =
			options.key !== undefined && options.schema.has(options.key) ? options.schema.field(options.key) : null
		this.#takeBaseline(options.baseline)
		this.#stop = this.store.subscribe(change => this.#onChange(change))
	}

	/** Moves on every change of what is changed. */
	get version(): number {
		return this.#version
	}

	/** Whether the cell holds other than it did, or is in a row added since. */
	isChanged(rowId: RowId, field: string): boolean {
		return this.#changed.get(rowId)?.has(field) ?? false
	}

	/** Whether anything in the row changed, or the row was added. */
	hasChanges(rowId: RowId): boolean {
		return this.#changed.has(rowId)
	}

	/** Whether the baseline had no such row. */
	isAdded(rowId: RowId): boolean {
		return this.#added.has(rowId)
	}

	/** The rows with a change, in sheet order. */
	changedRows(): RowId[] {
		return this.store.rowIds().filter(rowId => this.#changed.has(rowId))
	}

	summary(): ChangeSummary {
		let cells = 0
		let missing = 0

		for (const fields of this.#changed.values()) {
			cells += fields.size
		}

		for (const key of this.#baseline.keys()) {
			if ((this.#holding.get(key) ?? 0) === 0) {
				missing++
			}
		}

		return { rows: this.#changed.size, cells, added: this.#added.size, missing }
	}

	/** Takes the sheet as it is now as what it is compared with, such as after its changes were sent. */
	reset(): void {
		this.#takeBaseline(undefined)
		this.#changedNow()
	}

	/** Called after each change of what is changed. Returns the way to stop. */
	subscribe(listener: (changes: SheetChanges) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Stops following the store. */
	dispose(): void {
		this.#stop()
	}

	#takeBaseline(rows: readonly RowInit[] | undefined): void {
		this.#baseline.clear()
		this.#changed.clear()
		this.#added.clear()
		this.#keys.clear()
		this.#holding.clear()

		const entries: [string, ReadonlyMap<string, string>][] = rows
			? rows.flatMap(row => {
					const key = this.#key ? this.#compared(this.#key, row.values?.[this.#key.key] ?? null) : row.rowId
					const values = new Map(
						this.#fields.map(field => [field.key, this.#compared(field, row.values?.[field.key] ?? null)])
					)

					return key === undefined ? [] : [[this.#key ? key : `id:${key}`, values] as const]
				})
			: this.store
					.rowIds()
					.map(rowId => [
						this.#keyOf(rowId),
						new Map(
							this.#fields.map(field => [
								field.key,
								this.#compared(field, this.store.get(rowId, field.key))
							])
						)
					])

		for (const [key, values] of entries) {
			if (!this.#baseline.has(key)) {
				this.#baseline.set(key, values)
			}
		}

		for (const rowId of this.store.rowIds()) {
			this.#follow(rowId)
		}
	}

	#onChange(change: StoreChange): void {
		const touched = new Set<RowId>()

		for (const operation of change.operations) {
			if (operation.kind === "set") {
				touched.add(operation.rowId)
			} else if (operation.kind === "insert") {
				for (const row of operation.rows) {
					touched.add(row.rowId)
				}
			} else {
				for (const row of operation.rows) {
					this.#forget(row.rowId)
					touched.delete(row.rowId)
				}
			}
		}

		for (const rowId of touched) {
			if (this.store.has(rowId)) {
				this.#follow(rowId)
			}
		}

		this.#changedNow()
	}

	/** Compares the row with the baseline's row of its key. */
	#follow(rowId: RowId): void {
		const key = this.#keyOf(rowId)
		const was = this.#keys.get(rowId)

		if (was !== key) {
			if (was !== undefined) {
				this.#holding.set(was, (this.#holding.get(was) ?? 1) - 1)
			}

			this.#keys.set(rowId, key)
			this.#holding.set(key, (this.#holding.get(key) ?? 0) + 1)
		}

		const base = this.#baseline.get(key)
		const changed = new Set<string>()

		for (const field of this.#fields) {
			const now = this.#compared(field, this.store.get(rowId, field.key))

			if (base ? base.get(field.key) !== now : now !== EMPTY) {
				changed.add(field.key)
			}
		}

		if (changed.size > 0) {
			this.#changed.set(rowId, changed)
		} else {
			this.#changed.delete(rowId)
		}

		if (base === undefined && changed.size > 0) {
			this.#added.add(rowId)
		} else {
			this.#added.delete(rowId)
		}
	}

	#forget(rowId: RowId): void {
		const key = this.#keys.get(rowId)

		if (key !== undefined) {
			this.#holding.set(key, (this.#holding.get(key) ?? 1) - 1)
			this.#keys.delete(rowId)
		}

		this.#changed.delete(rowId)
		this.#added.delete(rowId)
	}

	#keyOf(rowId: RowId): string {
		return this.#key ? this.#compared(this.#key, this.store.get(rowId, this.#key.key)) : `id:${rowId}`
	}

	/** A value as it is compared: what the backend would read it as, options in any order. */
	#compared(field: FieldSchema, value: CellValue | undefined): string {
		if (value === undefined || value === null || value === "") {
			return EMPTY
		}

		const read = field.type === "lookup" ? value : canonicalValue(field, value, this.#settings)

		return JSON.stringify(filterKeys(field, read).sort())
	}

	#changedNow(): void {
		this.#version++
		this.#listeners.emit(this)
	}
}

/** An empty cell as it is compared; an empty list of options is one too. */
const EMPTY = JSON.stringify([""])

/** The rows with a change since the baseline, the added ones among them. */
export function rowsChanged(changes: SheetChanges): RowFilter {
	return rowId => changes.hasChanges(rowId)
}
