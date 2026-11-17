import { TabulaError } from "./errors"
import { Listeners } from "./listeners"
import { sameValue, toCellValue, type CellValue } from "./value"

/**
 * A row's identity: the same from the moment the row is created until it is deleted, whatever is
 * sorted, filtered, inserted or pasted around it.
 *
 * It is not a database id and not a position. Every issue, result and formula refers to a row by
 * this id, which is what keeps "row 37" from meaning a different row after a sort.
 */
export type RowId = string

/** A cell value per field key. A field with no entry is an empty cell. */
export type RowValues = Readonly<Record<string, CellValue>>

export interface RowInit {
	/** The id to keep, such as one read back from a draft. Left out, the store makes one. */
	readonly rowId?: RowId
	readonly values?: Readonly<Record<string, CellValue | undefined>>
}

export interface RowEntry {
	readonly rowId: RowId
	readonly values: RowValues
}

export interface RemovedRow extends RowEntry {
	/** Where the row stood before the removal. */
	readonly index: number
}

/**
 * One step of a change, carrying what it needs to be undone.
 *
 * `insert` puts a run of rows in at one place. `remove` takes rows out from anywhere, listed in the
 * order they stood; putting each back at its `index`, in that order, restores the sheet exactly.
 */
export type StoreOperation =
	| {
			readonly kind: "set"
			readonly rowId: RowId
			readonly field: string
			readonly before: CellValue
			readonly after: CellValue
	  }
	| { readonly kind: "insert"; readonly index: number; readonly rows: readonly RowEntry[] }
	| { readonly kind: "remove"; readonly rows: readonly RemovedRow[] }

export interface StoreChange {
	/** The store's revision after this change. */
	readonly revision: number
	/** What the change was for, as given to `transact()`, such as `"paste"`. */
	readonly origin: string | null
	/** In the order they were made. */
	readonly operations: readonly StoreOperation[]
}

export interface TransactOptions {
	readonly origin?: string
}

export interface CellWrite {
	readonly rowId: RowId
	readonly field: string
	readonly value: CellValue | undefined
}

export interface RowStoreOptions {
	readonly rows?: readonly RowInit[]
	/** Makes the id of a new row. The default is unique within the page and very unlikely to repeat across sessions. */
	readonly createRowId?: () => RowId
}

type MutableRow = Record<string, CellValue>

/**
 * The rows of one sheet, each under an id of its own.
 *
 * Plain data, kept out of any framework's reactivity: a view learns about changes by subscribing,
 * and redraws what the change touched. Every change is a transaction with a revision number, so a
 * backend answer can say which state of the sheet it checked.
 *
 * Only cells that hold something are kept. An empty cell is no entry at all, so a sheet of 50,000
 * mostly empty rows costs what its contents cost.
 */
export class RowStore {
	#order: RowId[] = []
	readonly #rows = new Map<RowId, MutableRow>()
	#positions: Map<RowId, number> | null = null
	#revision = 0
	#log: StoreOperation[] | null = null
	readonly #createRowId: () => RowId
	readonly #listeners = new Listeners<StoreChange>()

	constructor(options: RowStoreOptions = {}) {
		this.#createRowId = options.createRowId ?? sessionRowIds()

		for (const { rowId, row } of this.#prepare(options.rows ?? [])) {
			this.#rows.set(rowId, row)
			this.#order.push(rowId)
		}
	}

	// ---------------------------------------------------------------- reading

	/** Counts changes: 0 for a new store, one more for each transaction that changed something. */
	get revision(): number {
		return this.#revision
	}

	get size(): number {
		return this.#order.length
	}

	has(rowId: RowId): boolean {
		return this.#rows.has(rowId)
	}

	rowIdAt(index: number): RowId | undefined {
		return this.#order[index]
	}

	/** Where the row stands, or -1 when there is no such row. */
	indexOf(rowId: RowId): number {
		if (this.#positions === null) {
			this.#positions = new Map(this.#order.map((id, index) => [id, index]))
		}

		return this.#positions.get(rowId) ?? -1
	}

	/** Every row id, in order. A copy: O(rows), so a view drawing one screen reads `rowIdAt()` instead. */
	rowIds(): RowId[] {
		return [...this.#order]
	}

	/** The cell's value; null when it is empty. */
	get(rowId: RowId, field: string): CellValue {
		return this.#row(rowId)[field] ?? null
	}

	/** The row's cells that hold something, as a frozen copy. */
	values(rowId: RowId): RowValues {
		return frozenCopy(this.#row(rowId))
	}

	/** Every row with its id and values, in order: what a draft keeps. It survives `JSON.stringify` as it is. */
	snapshot(): RowEntry[] {
		return this.#order.map(rowId => Object.freeze({ rowId, values: frozenCopy(this.#row(rowId)) }))
	}

	/** Called after each transaction that changed something. Returns the way to stop. */
	subscribe(listener: (change: StoreChange) => void): () => void {
		return this.#listeners.add(listener)
	}

	// ---------------------------------------------------------------- writing

	/**
	 * Makes every write inside `fn` one change: one revision, one notice to the listeners, one step
	 * to undo. If `fn` throws, everything it wrote is taken back and the error is rethrown.
	 *
	 * A transaction started inside another joins it, and its writes stand or fall with the outer one.
	 *
	 * @returns the change, or null when nothing changed or the call joined an outer transaction
	 */
	transact(fn: () => void, options: TransactOptions = {}): StoreChange | null {
		if (this.#log !== null) {
			fn()

			return null
		}

		const log: StoreOperation[] = []
		this.#log = log

		try {
			fn()
		} catch (error) {
			this.#log = null

			for (let index = log.length - 1; index >= 0; index--) {
				this.#revert(log[index] as StoreOperation)
			}

			throw error
		}

		this.#log = null

		if (log.length === 0) {
			return null
		}

		this.#revision++

		const change: StoreChange = Object.freeze({
			revision: this.#revision,
			origin: options.origin ?? null,
			operations: Object.freeze(log)
		})

		this.#listeners.emit(change)

		return change
	}

	/**
	 * Writes one cell. Null or undefined empties it. A value equal to the one there already is no
	 * change at all, so it does not move the revision.
	 */
	setCell(rowId: RowId, field: string, value: CellValue | undefined): void {
		this.#write(() => {
			const row = this.#row(rowId)

			requireField(field)

			const after = toCellValue(value, `The value of "${field}" in row "${rowId}"`)
			const before = row[field] ?? null

			if (sameValue(before, after)) {
				return
			}

			assign(row, field, after)
			this.#record({ kind: "set", rowId, field, before, after })
		})
	}

	/** Writes many cells as one change, such as a paste. */
	setCells(writes: Iterable<CellWrite>, options: TransactOptions = {}): StoreChange | null {
		return this.transact(() => {
			for (const write of writes) {
				this.setCell(write.rowId, write.field, write.value)
			}
		}, options)
	}

	/**
	 * Puts rows in at `index`, 0 to `size`: a number of empty rows, or rows with ids and values.
	 *
	 * @returns the ids of the new rows, in order
	 */
	insertRows(index: number, rows: number | readonly RowInit[]): RowId[] {
		if (!Number.isInteger(index) || index < 0 || index > this.#order.length) {
			throw new TabulaError(
				"invalid_argument",
				`Rows can be inserted at 0 to ${this.#order.length}; got ${index}.`
			)
		}

		const inits = typeof rows === "number" ? blankRows(rows) : rows
		let ids: RowId[] = []

		this.#write(() => {
			const prepared = this.#prepare(inits)

			if (prepared.length === 0) {
				return
			}

			ids = prepared.map(entry => entry.rowId)

			for (const { rowId, row } of prepared) {
				this.#rows.set(rowId, row)
			}

			// Spread into a new array rather than into splice(): as arguments, a paste of 200,000 rows
			// overflows the call stack.
			this.#order = [...this.#order.slice(0, index), ...ids, ...this.#order.slice(index)]
			this.#positions = null
			this.#record({
				kind: "insert",
				index,
				rows: Object.freeze(prepared.map(({ rowId, row }) => Object.freeze({ rowId, values: frozenCopy(row) })))
			})
		})

		return ids
	}

	appendRows(rows: number | readonly RowInit[]): RowId[] {
		return this.insertRows(this.#order.length, rows)
	}

	/**
	 * Takes rows out, wherever they stand. Every id must exist: one unknown id and nothing is removed.
	 */
	removeRows(rowIds: Iterable<RowId>): void {
		const doomed = new Set(rowIds)

		for (const rowId of doomed) {
			this.#row(rowId)
		}

		if (doomed.size === 0) {
			return
		}

		this.#write(() => {
			const removed: RemovedRow[] = []
			const kept: RowId[] = []

			// One pass whatever the number of rows: removing them one at a time is a pass per row.
			this.#order.forEach((rowId, index) => {
				if (!doomed.has(rowId)) {
					kept.push(rowId)

					return
				}

				removed.push(Object.freeze({ index, rowId, values: frozenCopy(this.#row(rowId)) }))
				this.#rows.delete(rowId)
			})

			this.#order = kept
			this.#positions = null
			this.#record({ kind: "remove", rows: Object.freeze(removed) })
		})
	}

	// ---------------------------------------------------------------- taking back

	/**
	 * Takes a change back: its operations undone, the last first, as one new change with a revision
	 * of its own. Rows come back under the ids they had, to the places they stood.
	 *
	 * The sheet must be as the change left it: nothing changed since, or every later change taken
	 * back first. Otherwise nothing is written and a `conflict` is thrown, rather than mixing the
	 * change into a sheet it never saw.
	 *
	 * @returns the change that took it back
	 */
	revert(change: StoreChange, options: TransactOptions = {}): StoreChange | null {
		return this.#standalone("revert", options, () => {
			const operations = change.operations

			for (let index = operations.length - 1; index >= 0; index--) {
				this.#undo(operations[index] as StoreOperation)
			}
		})
	}

	/**
	 * Makes a change again once `revert()` has taken it back, with the same row ids. The sheet must be
	 * as it was before the change, or a `conflict` is thrown and nothing is written.
	 *
	 * @returns the change that made it again
	 */
	replay(change: StoreChange, options: TransactOptions = {}): StoreChange | null {
		return this.#standalone("replay", options, () => {
			for (const operation of change.operations) {
				this.#redo(operation)
			}
		})
	}

	// ---------------------------------------------------------------- internals

	#write(fn: () => void): void {
		if (this.#log === null) {
			this.transact(fn)
		} else {
			fn()
		}
	}

	#record(operation: StoreOperation): void {
		this.#log?.push(Object.freeze(operation))
	}

	#row(rowId: RowId): MutableRow {
		const row = this.#rows.get(rowId)

		if (!row) {
			throw new TabulaError("unknown_row", `There is no row "${rowId}" in this sheet.`)
		}

		return row
	}

	/** Checks the ids and values of new rows without touching the store, so a refusal leaves it as it was. */
	#prepare(inits: readonly RowInit[]): { rowId: RowId; row: MutableRow }[] {
		const batch = new Set<RowId>()

		return inits.map(init => {
			const given = init.rowId !== undefined
			const rowId = given ? init.rowId : this.#createRowId()

			if (typeof rowId !== "string" || rowId === "") {
				throw new TabulaError("invalid_argument", `A row id must be a non-empty string; got ${String(rowId)}.`)
			}

			if (this.#rows.has(rowId) || batch.has(rowId)) {
				throw new TabulaError(
					"duplicate_row",
					given
						? `There is already a row "${rowId}" in this sheet.`
						: `createRowId() returned "${rowId}", an id already in use.`
				)
			}

			batch.add(rowId)

			const row = Object.create(null) as MutableRow

			for (const [field, value] of Object.entries(init.values ?? {})) {
				requireField(field)

				const cell = toCellValue(value, `The value of "${field}" in row "${rowId}"`)

				if (cell !== null) {
					row[field] = cell
				}
			}

			return { rowId, row }
		})
	}

	#revert(operation: StoreOperation): void {
		switch (operation.kind) {
			case "set":
				assign(this.#row(operation.rowId), operation.field, operation.before)
				break
			case "insert": {
				const inserted = new Set(operation.rows.map(entry => entry.rowId))

				this.#order = this.#order.filter(rowId => !inserted.has(rowId))

				for (const rowId of inserted) {
					this.#rows.delete(rowId)
				}
				break
			}
			case "remove":
				this.#restore(operation.rows)
				break
		}

		this.#positions = null
	}

	/** A transaction that must be a change of its own, never part of an outer one. */
	#standalone(name: string, options: TransactOptions, fn: () => void): StoreChange | null {
		if (this.#log !== null) {
			throw new TabulaError(
				"invalid_argument",
				`${name}() makes a change of its own and cannot run inside a transaction.`
			)
		}

		return this.transact(fn, options)
	}

	#undo(operation: StoreOperation): void {
		switch (operation.kind) {
			case "set":
				this.#swap(operation.rowId, operation.field, operation.after, operation.before)
				break
			case "insert":
				this.#expectRows(operation.rows, true)
				this.removeRows(operation.rows.map(entry => entry.rowId))
				break
			case "remove":
				this.#putBack(operation.rows)
				break
		}
	}

	#redo(operation: StoreOperation): void {
		switch (operation.kind) {
			case "set":
				this.#swap(operation.rowId, operation.field, operation.before, operation.after)
				break
			case "insert":
				this.#expectRows(operation.rows, false)

				if (operation.index > this.#order.length) {
					throw new TabulaError(
						"conflict",
						`Rows went in at ${operation.index}, past the end of this sheet of ${this.#order.length} rows.`
					)
				}

				this.insertRows(operation.index, operation.rows)
				break
			case "remove":
				this.#expectRows(operation.rows, true)
				this.removeRows(operation.rows.map(entry => entry.rowId))
				break
		}
	}

	/** Writes `to` into a cell that must hold `from`. */
	#swap(rowId: RowId, field: string, from: CellValue, to: CellValue): void {
		const row = this.#rows.get(rowId)

		if (!row) {
			throw new TabulaError("conflict", `There is no row "${rowId}" in this sheet any more.`)
		}

		if (!sameValue(row[field] ?? null, from)) {
			throw new TabulaError("conflict", `The cell "${field}" in row "${rowId}" has changed since.`)
		}

		assign(row, field, to)
		this.#record({ kind: "set", rowId, field, before: from, after: to })
	}

	#expectRows(entries: readonly RowEntry[], present: boolean): void {
		for (const { rowId } of entries) {
			if (this.#rows.has(rowId) !== present) {
				throw new TabulaError(
					"conflict",
					present
						? `There is no row "${rowId}" in this sheet any more.`
						: `There is a row "${rowId}" in this sheet already.`
				)
			}
		}
	}

	/**
	 * Puts removed rows back where they stood, in one pass, and records it as one insert for each run
	 * of rows that stood together: replaying those inserts in order puts every row back in its place.
	 */
	#putBack(entries: readonly RemovedRow[]): void {
		this.#expectRows(entries, false)

		const total = this.#order.length + entries.length
		let previous = -1

		for (const entry of entries) {
			if (!Number.isInteger(entry.index) || entry.index <= previous || entry.index >= total) {
				throw new TabulaError(
					"conflict",
					`Row "${entry.rowId}" stood at ${entry.index}, which is not a place in this sheet of ${total} rows.`
				)
			}

			previous = entry.index
		}

		if (entries.length === 0) {
			return
		}

		this.#restore(entries)
		this.#positions = null

		let start = 0

		for (let end = 1; end <= entries.length; end++) {
			const next = entries[end]

			if (next === undefined || next.index !== (entries[end - 1] as RemovedRow).index + 1) {
				const run = entries.slice(start, end)

				this.#record({
					kind: "insert",
					index: (run[0] as RemovedRow).index,
					rows: Object.freeze(run.map(({ rowId, values }) => Object.freeze({ rowId, values })))
				})
				start = end
			}
		}
	}

	/** Puts removed rows back where they stood, in one pass. */
	#restore(entries: readonly RemovedRow[]): void {
		const order: RowId[] = []
		const total = this.#order.length + entries.length
		let next = 0
		let from = 0

		for (let position = 0; position < total; position++) {
			const entry = entries[next]

			if (entry !== undefined && entry.index === position) {
				order.push(entry.rowId)
				this.#rows.set(entry.rowId, Object.assign(Object.create(null) as MutableRow, entry.values))
				next++
			} else {
				order.push(this.#order[from++] as RowId)
			}
		}

		this.#order = order
	}
}

function assign(row: MutableRow, field: string, value: CellValue): void {
	if (value === null) {
		delete row[field]
	} else {
		row[field] = value
	}
}

function frozenCopy(row: MutableRow): RowValues {
	return Object.freeze(Object.assign(Object.create(null) as MutableRow, row))
}

function requireField(field: string): void {
	if (typeof field !== "string" || field === "") {
		throw new TabulaError("invalid_argument", `A field key must be a non-empty string; got ${String(field)}.`)
	}
}

function blankRows(count: number): RowInit[] {
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new TabulaError("invalid_argument", `A number of rows must be a whole number, 0 or more; got ${count}.`)
	}

	return Array.from({ length: count }, () => ({}))
}

/**
 * Ids such as `r_1k3x9q2_1`: a random part drawn once per store, then a counter.
 *
 * The counter keeps them unique within the page. The random part keeps a row made today from taking
 * the id of a row in a draft saved yesterday, which would let yesterday's backend answer land on it.
 * It comes from `crypto.getRandomValues`, which, unlike `randomUUID`, also works on plain http.
 */
function sessionRowIds(): () => RowId {
	const prefix = randomPart()
	let counter = 0

	return () => `r_${prefix}_${(++counter).toString(36)}`
}

function randomPart(): string {
	const scope = globalThis as { crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array } }
	const word = new Uint32Array(1)

	if (typeof scope.crypto?.getRandomValues === "function") {
		scope.crypto.getRandomValues(word)
	} else {
		word[0] = Math.floor(Math.random() * 2 ** 32)
	}

	return (word[0] ?? 0).toString(36).padStart(7, "0")
}
