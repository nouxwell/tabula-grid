import { neverAborted, raced } from "./async.js"
import type { AdapterContext } from "./contract.js"
import { TabulaError } from "./errors.js"
import { sequence } from "./ids.js"
import { Listeners } from "./listeners.js"
import type { CellWrite, RowId, RowStore, StoreChange } from "./rows.js"
import type { FieldSchema, LookupField, ModuleSchema } from "./schema.js"
import { toCellValue, type CellValue } from "./value.js"
import { isLookupValue } from "./values/read.js"
import { clean } from "./values/text.js"

/**
 * Lookups: a record picked by its name, kept as `{ id, label }`. The user sees the label, the
 * backend takes the id. A name typed or pasted is text until a record is matched to it, and text
 * in a lookup is an error (`not_matched`): there is no id to send.
 */

/** A record a lookup can hold. */
export interface LookupItem {
	readonly id: string | number
	readonly label: string
	/** A second line in the list, such as a product's code. */
	readonly description?: string
	/** Shown, not picked, such as an inactive product; never matched to a name. */
	readonly disabled?: boolean
	/**
	 * What the record says of the sheet's other fields, by their keys, such as a product's code and
	 * current price: written into those the lookup `fills` when it is matched or picked.
	 */
	readonly values?: Readonly<Record<string, CellValue>>
}

/**
 * What a lookup's record writes into its row besides itself: each field the lookup `fills`, with
 * what the record says of it, or emptied when there is no record. Nothing for any other field.
 */
export function lookupFills(field: FieldSchema, rowId: RowId, item: LookupItem | null): CellWrite[] {
	return field.type === "lookup"
		? field.fills.map(key => ({ rowId, field: key, value: item?.values?.[key] ?? null }))
		: []
}

export interface LookupSearchRequest {
	/** The schema's name for the lookup, such as `"product"`. */
	readonly lookup: string
	/** The field being edited, for a backend whose choice depends on it. */
	readonly field: string
	readonly query: string
	readonly limit: number
}

export interface LookupSearchResponse {
	readonly items: readonly LookupItem[]
	/** Whether more records fit the query than were sent. */
	readonly more?: boolean
}

/** Many names at once, such as from one paste: one request, not one per cell. */
export interface LookupResolveRequest {
	readonly lookup: string
	readonly labels: readonly string[]
}

export interface LookupResolveResponse {
	/**
	 * For each name, as it was sent, the records it may mean: one is a match, none or several is not.
	 * Matching is the backend's: in the user's language, and by more than the name if it likes, such
	 * as by a product code. The browser compares nothing, so "ÇELİK" and "çelik" are two names to it.
	 */
	readonly matches: readonly { readonly label: string; readonly items: readonly LookupItem[] }[]
}

/** What an editor needs to list a lookup's records as the user types: a `LookupResolver` is one. */
export interface LookupSearch {
	search(field: string, query: string, signal?: AbortSignal, limit?: number): Promise<LookupSearchResponse>
}

/** How a sheet reaches its records. Without `resolve`, names are matched only by picking from the list. */
export interface LookupAdapters {
	search(request: LookupSearchRequest, context: AdapterContext): Promise<LookupSearchResponse>
	resolve?(request: LookupResolveRequest, context: AdapterContext): Promise<LookupResolveResponse>
}

/**
 * The origin of the change that puts a matched record in place of a name. An undo history adds such
 * a change to the step before it, so one Ctrl+Z takes back a paste and what was matched in it.
 */
export const LOOKUP_ORIGIN = "lookup"

export interface LookupResolverOptions {
	readonly schema: ModuleSchema
	readonly store: RowStore
	readonly adapters: LookupAdapters
	/** How many names go in one resolve request. 200 by default. */
	readonly batchSize?: number
	/** Milliseconds an answer is used again rather than asked for anew. 60,000 by default. */
	readonly cacheFor?: number
	readonly now?: () => number
	readonly createRequestId?: () => string
}

interface Cached<T> {
	readonly value: T
	readonly at: number
}

/** The names waiting to be matched in one lookup: by name as written, cleaned, and the cells holding it. */
type Names = Map<string, { readonly label: string; readonly cells: Set<string> }>

/** By lookup. */
type Queue = Map<string, Names>

const DEFAULT_BATCH = 200
const DEFAULT_CACHE_FOR = 60_000

/**
 * Searches a sheet's lookups for the editor's list, and matches the names typed or pasted into them
 * to records, many at a time.
 *
 * Every name that lands in a lookup cell is gathered, and all of them, from one paste or several
 * edits in a row, go to the backend as one request per lookup (or a few, for thousands). A name
 * that means exactly one record becomes that record; one that means none or several stays text,
 * marked, for the user to pick from the list. An answer is used again for a minute, so pasting the
 * same names twice asks once.
 */
export class LookupResolver implements LookupSearch {
	readonly #schema: ModuleSchema
	readonly #store: RowStore
	readonly #adapters: LookupAdapters
	readonly #batchSize: number
	readonly #cacheFor: number
	readonly #now: () => number
	readonly #requestId: () => string
	readonly #listeners = new Listeners<LookupResolver>()
	readonly #stop: () => void
	readonly #searches = new Map<string, Cached<LookupSearchResponse>>()
	/** By lookup, then name: the record the name means, or null for none or several. */
	readonly #matches = new Map<string, Map<string, Cached<LookupItem | null>>>()
	#queue: Queue = new Map()
	#flushing: Promise<void> = Promise.resolve()
	#scheduled = false
	#pending = 0
	#failure: { readonly message: string; readonly error: unknown } | null = null
	#version = 0
	#disposed = false

	constructor(options: LookupResolverOptions) {
		const batchSize = options.batchSize ?? DEFAULT_BATCH

		if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
			throw new TabulaError("invalid_argument", `batchSize must be a whole number, 1 or more; got ${batchSize}.`)
		}

		this.#schema = options.schema
		this.#store = options.store
		this.#adapters = options.adapters
		this.#batchSize = batchSize
		this.#cacheFor = options.cacheFor ?? DEFAULT_CACHE_FOR
		this.#now = options.now ?? (() => Date.now())
		this.#requestId = options.createRequestId ?? sequence("lookup")
		this.#stop = this.#store.subscribe(change => this.#onChange(change))
	}

	/** Moves when the number of names waiting changes, or a request fails or recovers. */
	get version(): number {
		return this.#version
	}

	/** How many names are waiting for the backend. */
	get pending(): number {
		return this.#pending
	}

	/** What went wrong with the last resolve request, until one goes through again. */
	get failure(): { readonly message: string; readonly error: unknown } | null {
		return this.#failure
	}

	subscribe(listener: (resolver: LookupResolver) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Searches the records of a lookup field, for the editor's list. */
	async search(
		field: string,
		query: string,
		signal: AbortSignal = neverAborted(),
		limit = 20
	): Promise<LookupSearchResponse> {
		const lookup = this.#lookupOf(field)

		if (!lookup) {
			throw new TabulaError("invalid_argument", `"${field}" is not a lookup field.`)
		}

		const key = `${lookup.lookup}\u0000${limit}\u0000${clean(query)}`
		const cached = this.#fresh(this.#searches.get(key))

		if (cached) {
			return cached
		}

		const requestId = this.#requestId()
		const answer = await raced(
			this.#adapters.search({ lookup: lookup.lookup, field, query, limit }, { signal, requestId }),
			signal
		)
		const response = readSearchResponse(answer)

		this.#searches.set(key, { value: response, at: this.#now() })

		return response
	}

	/**
	 * What each name would be matched to in a lookup field's records, as a paste would be: the record,
	 * or null for none or several. The names not known yet go to the backend in one request; answers
	 * are used again for a minute. Nothing is written.
	 */
	async match(field: string, labels: readonly string[]): Promise<(LookupItem | null)[]> {
		const lookup = this.#lookupOf(field)
		const resolve = this.#adapters.resolve

		if (!lookup || !resolve) {
			return labels.map(() => null)
		}

		const known = this.#matches.get(lookup.lookup) ?? new Map<string, Cached<LookupItem | null>>()
		const unknown = [
			...new Set(
				labels.filter(label => clean(label) !== "" && this.#fresh(known.get(clean(label))) === undefined)
			)
		]

		this.#matches.set(lookup.lookup, known)

		if (unknown.length > 0) {
			const answer = await resolve(
				{ lookup: lookup.lookup, labels: unknown },
				{ signal: neverAborted(), requestId: this.#requestId() }
			)

			this.#learn(known, unknown, readResolveResponse(answer))
		}

		return labels.map(label => this.#fresh(known.get(clean(label))) ?? null)
	}

	/** Matches every lookup cell holding a name, such as after a draft is opened. */
	resolveAll(): Promise<void> {
		for (const rowId of this.#store.rowIds()) {
			for (const field of this.#schema.fields) {
				this.#enqueue(rowId, field.key, this.#store.get(rowId, field.key))
			}
		}

		return this.settled()
	}

	/** Settles once every name gathered so far has had its answer. */
	async settled(): Promise<void> {
		do {
			await Promise.resolve()
			await this.#flushing
		} while (this.#queue.size > 0 || this.#scheduled)
	}

	/** Stops following the store. Answers still on their way are not written. */
	dispose(): void {
		this.#disposed = true
		this.#stop()
	}

	// ---------------------------------------------------------------- gathering

	#onChange(change: StoreChange): void {
		// An undo puts back what was there; matching it again would be a new change, and end the redo.
		if (change.origin === "undo" || change.origin === "redo" || change.origin === LOOKUP_ORIGIN) {
			return
		}

		const emptied: { readonly rowId: RowId; readonly field: string }[] = []

		for (const operation of change.operations) {
			if (operation.kind === "set") {
				// A cell left with no record leaves nothing for its record to have filled.
				if (!isLookupValue(operation.after) && (this.#lookupOf(operation.field)?.fills.length ?? 0) > 0) {
					emptied.push({ rowId: operation.rowId, field: operation.field })
				}

				this.#enqueue(operation.rowId, operation.field, operation.after)
			} else if (operation.kind === "insert") {
				for (const row of operation.rows) {
					for (const [field, value] of Object.entries(row.values)) {
						this.#enqueue(row.rowId, field, value)
					}
				}
			}
		}

		if (emptied.length > 0) {
			void Promise.resolve().then(() => this.#empty(emptied))
		}
	}

	/**
	 * Empties what the records of cells now holding none had filled, once the change that emptied
	 * them is done, as part of it for Ctrl+Z.
	 */
	#empty(cells: readonly { readonly rowId: RowId; readonly field: string }[]): void {
		if (cells.length === 0 || this.#disposed) {
			return
		}

		const writes = cells.flatMap(({ rowId, field }) => {
			const lookup = this.#lookupOf(field)

			if (!lookup || !this.#store.has(rowId) || isLookupValue(this.#store.get(rowId, field))) {
				return []
			}

			return lookupFills(lookup, rowId, null).filter(write => this.#store.get(rowId, write.field) !== null)
		})

		if (writes.length > 0) {
			this.#store.setCells(writes, { origin: LOOKUP_ORIGIN })
		}
	}

	#enqueue(rowId: RowId, field: string, value: CellValue): void {
		const lookup = this.#lookupOf(field)

		if (!lookup || !this.#adapters.resolve || typeof value !== "string" || value.trim() === "") {
			return
		}

		let names = this.#queue.get(lookup.lookup)

		if (!names) {
			names = new Map()
			this.#queue.set(lookup.lookup, names)
		}

		const key = clean(value)
		const entry = names.get(key) ?? { label: value, cells: new Set<string>() }

		entry.cells.add(cellKey(rowId, field))
		names.set(key, entry)
		this.#schedule()
	}

	#schedule(): void {
		if (this.#scheduled || this.#disposed) {
			return
		}

		this.#scheduled = true
		// After the change that gathered the names: everything one paste or one script writes in a
		// row goes in one request.
		this.#flushing = this.#flushing.then(async () => {
			await Promise.resolve()
			this.#scheduled = false
			await this.#flush()
		})
	}

	// ---------------------------------------------------------------- matching

	async #flush(): Promise<void> {
		const queue = this.#queue
		const resolve = this.#adapters.resolve

		this.#queue = new Map()

		if (!resolve || this.#disposed) {
			return
		}

		for (const [lookup, names] of queue) {
			const known = this.#matches.get(lookup) ?? new Map<string, Cached<LookupItem | null>>()
			const unknown = [...names].filter(([key]) => !this.#fresh(known.get(key))).map(([, entry]) => entry.label)

			this.#matches.set(lookup, known)
			this.#setPending(this.#pending + unknown.length)

			for (let start = 0; start < unknown.length; start += this.#batchSize) {
				const labels = unknown.slice(start, start + this.#batchSize)

				try {
					const answer = await resolve(
						{ lookup, labels },
						{ signal: neverAborted(), requestId: this.#requestId() }
					)

					this.#learn(known, labels, readResolveResponse(answer))
					this.#setFailure(null)
				} catch (error) {
					this.#setFailure(error)
				} finally {
					this.#setPending(this.#pending - labels.length)
				}
			}

			this.#write(names, known)
		}
	}

	/** Keeps what the backend said each name means: one record that can be picked, or nothing. */
	#learn(
		known: Map<string, Cached<LookupItem | null>>,
		labels: readonly string[],
		response: LookupResolveResponse
	): void {
		const at = this.#now()
		const answers = new Map(response.matches.map(match => [clean(match.label), match.items] as const))

		for (const label of labels) {
			const items = (answers.get(clean(label)) ?? []).filter(item => !item.disabled)

			known.set(clean(label), { value: items.length === 1 ? (items[0] as LookupItem) : null, at })
		}
	}

	/** Puts each matched record in the cells still holding its name, as one change. */
	#write(names: Names, known: Map<string, Cached<LookupItem | null>>): void {
		if (this.#disposed) {
			return
		}

		const writes: CellWrite[] = []

		for (const [key, entry] of names) {
			const item = this.#fresh(known.get(key))

			if (!item) {
				continue
			}

			for (const cell of entry.cells) {
				const [rowId, field] = cell.split("\u0000") as [RowId, string]
				const value = this.#store.has(rowId) ? this.#store.get(rowId, field) : null

				// Only where the name still stands: the user may have typed something else meanwhile.
				if (typeof value === "string" && clean(value) === key) {
					writes.push({ rowId, field, value: Object.freeze({ id: item.id, label: item.label }) })

					const lookup = this.#lookupOf(field)

					if (lookup) {
						writes.push(...lookupFills(lookup, rowId, item))
					}
				}
			}
		}

		if (writes.length > 0) {
			this.#store.setCells(writes, { origin: LOOKUP_ORIGIN })
		}
	}

	// ---------------------------------------------------------------- helpers

	#lookupOf(field: string): LookupField | null {
		if (!this.#schema.has(field)) {
			return null
		}

		const schemaField = this.#schema.field(field)

		return schemaField.type === "lookup" ? schemaField : null
	}

	#fresh<T>(cached: Cached<T> | undefined): T | undefined {
		return cached && this.#now() - cached.at < this.#cacheFor ? cached.value : undefined
	}

	#setPending(pending: number): void {
		if (pending !== this.#pending) {
			this.#pending = pending
			this.#changed()
		}
	}

	#setFailure(error: unknown): void {
		if (error === null && this.#failure === null) {
			return
		}

		this.#failure =
			error === null
				? null
				: Object.freeze({ message: error instanceof Error ? error.message : String(error), error })
		this.#changed()
	}

	#changed(): void {
		this.#version++
		this.#listeners.emit(this)
	}
}

function cellKey(rowId: RowId, field: string): string {
	return `${rowId}\u0000${field}`
}

// ---------------------------------------------------------------- reading answers

function readSearchResponse(input: unknown): LookupSearchResponse {
	const root = plain(input)

	if (!root || !Array.isArray(root.items)) {
		throw new TabulaError("invalid_response", "A lookup search answer must be an object with an items array.")
	}

	return Object.freeze({
		items: Object.freeze(root.items.map((item, index) => readItem(item, `items[${index}]`))),
		more: root.more === true
	})
}

function readResolveResponse(input: unknown): LookupResolveResponse {
	const root = plain(input)

	if (!root || !Array.isArray(root.matches)) {
		throw new TabulaError("invalid_response", "A lookup resolve answer must be an object with a matches array.")
	}

	return Object.freeze({
		matches: Object.freeze(
			root.matches.map((match, index) => {
				const entry = plain(match)

				if (!entry || typeof entry.label !== "string" || !Array.isArray(entry.items)) {
					throw new TabulaError("invalid_response", `matches[${index}] must have a label and an items array.`)
				}

				return Object.freeze({
					label: entry.label,
					items: Object.freeze(
						entry.items.map((item, at) => readItem(item, `matches[${index}].items[${at}]`))
					)
				})
			})
		)
	})
}

function readItem(input: unknown, path: string): LookupItem {
	const item = plain(input)
	const id = item?.id

	if (!item || (typeof id !== "string" && typeof id !== "number") || typeof item.label !== "string") {
		throw new TabulaError("invalid_response", `${path} must have an id (text or a number) and a label.`)
	}

	const values = item.values === undefined || item.values === null ? null : plain(item.values)

	if (item.values !== undefined && item.values !== null && !values) {
		throw new TabulaError("invalid_response", `${path}.values must be an object of values by field key.`)
	}

	return Object.freeze({
		id,
		label: item.label,
		...(typeof item.description === "string" ? { description: item.description } : {}),
		...(item.disabled === true ? { disabled: true } : {}),
		...(values
			? {
					values: Object.freeze(
						Object.fromEntries(
							Object.entries(values).map(([key, value]) => [
								key,
								toCellValue(value, `${path}.values.${key}`)
							])
						)
					)
				}
			: {})
	})
}

function plain(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}
