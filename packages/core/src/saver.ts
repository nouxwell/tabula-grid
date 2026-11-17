import type { AdapterContext } from "./contract"
import { createDraft, type Draft, type DraftView } from "./draft"
import { TabulaError } from "./errors"
import { sequence } from "./ids"
import { Listeners } from "./listeners"
import type { RowStore } from "./rows"
import type { ModuleSchema } from "./schema"
import type { SheetSession } from "./session"

export interface DraftSaverOptions {
	readonly schema: ModuleSchema
	readonly store: RowStore
	/** Its results go into each draft, and a change to them is a change to save. */
	readonly session?: SheetSession
	/**
	 * Keeps a draft wherever the application keeps them: its backend, the browser's storage. A draft
	 * carries its own id, so the same draft saved again replaces the last one rather than adding one.
	 */
	readonly save: (draft: Draft, context: AdapterContext) => Promise<void>
	/** The id of the draft being continued. Left out, a new one is made. */
	readonly id?: string
	readonly name?: string | null
	/** Read at each save: the user's view of the sheet, such as the grid's column widths. */
	readonly view?: () => DraftView
	/** Milliseconds after the last change before it saves on its own; 0 saves only when asked. 2,000 by default. */
	readonly delay?: number
	readonly createId?: () => string
	readonly now?: () => Date
}

/** `saved`: nothing changed since the last save. `failed`: the last save did not go through. */
export type SaverStatus = "saved" | "unsaved" | "saving" | "failed"

export interface SaverState {
	readonly status: SaverStatus
	/** When the last save went through, as ISO 8601 text; null before the first. */
	readonly savedAt: string | null
	/** What went wrong with the last save, when it did not go through. */
	readonly failure: { readonly message: string; readonly error: unknown } | null
}

const DEFAULT_DELAY = 2000

/**
 * Saves a sheet as a draft: on its own, a moment after the user stops changing it, and whenever
 * asked. Only one save is under way at a time; changes made during one are saved by the next.
 *
 * A save that fails leaves the sheet as it is and the state `failed`; the next change, or a call to
 * `save()`, tries again.
 */
export class DraftSaver {
	/** The draft's id: the same for every save. */
	readonly id: string

	readonly #options: DraftSaverOptions
	readonly #delay: number
	readonly #listeners = new Listeners<DraftSaver>()
	readonly #stops: (() => void)[] = []
	#name: string | null
	#state: SaverState = Object.freeze({ status: "saved", savedAt: null, failure: null })
	#version = 0
	/** Counts changes; the count a save started at is what it saved. */
	#changes = 0
	#saved = 0
	#timer: ReturnType<typeof setTimeout> | null = null
	#running: Promise<boolean> | null = null
	#disposed = false

	constructor(options: DraftSaverOptions) {
		const delay = options.delay ?? DEFAULT_DELAY

		if (!Number.isFinite(delay) || delay < 0) {
			throw new TabulaError("invalid_argument", `delay must be 0 or more milliseconds; got ${delay}.`)
		}

		this.#options = options
		this.#delay = delay
		this.#name = options.name ?? null
		this.id = options.id ?? (options.createId ?? sequence("d"))()
		this.#stops.push(options.store.subscribe(() => this.changed()))

		if (options.session) {
			this.#stops.push(options.session.results.subscribe(() => this.changed()))
			this.#stops.push(options.session.subscribe(() => this.#onSession()))
		}
	}

	get version(): number {
		return this.#version
	}

	get state(): SaverState {
		return this.#state
	}

	get name(): string | null {
		return this.#name
	}

	/** Whether something changed since the last save that went through. */
	get dirty(): boolean {
		return this.#changes !== this.#saved
	}

	subscribe(listener: (saver: DraftSaver) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Something the draft holds changed outside the store, such as a column width: save it in a moment. */
	changed(): void {
		if (this.#disposed) {
			return
		}

		this.#changes++

		if (this.#state.status !== "saving") {
			this.#setState({ status: "unsaved" })
		}

		this.#schedule()
	}

	/** Names the draft, and saves the name with it. */
	rename(name: string | null): void {
		this.#name = name
		this.changed()
	}

	/**
	 * Saves now, after any save under way. Resolves true once everything changed until now is saved,
	 * false when a save failed.
	 */
	async save(): Promise<boolean> {
		this.#clearTimer()

		while (this.#running) {
			await this.#running
		}

		if (this.#disposed) {
			return false
		}

		if (!this.dirty && this.#state.status === "saved" && this.#state.savedAt !== null) {
			return true
		}

		const run = this.#run()

		this.#running = run

		try {
			return await run
		} finally {
			this.#running = null
		}
	}

	/** Saves what is not saved yet, such as before the page goes away. Resolves at once when nothing is. */
	async flush(): Promise<boolean> {
		return this.dirty || this.#running ? this.save() : true
	}

	/** Stops saving on its own. A save under way still finishes. */
	dispose(): void {
		this.#disposed = true
		this.#clearTimer()

		for (const stop of this.#stops) {
			stop()
		}
	}

	async #run(): Promise<boolean> {
		const options = this.#options
		const at = this.#changes
		const draft = createDraft({
			id: this.id,
			name: this.#name,
			schema: options.schema,
			store: options.store,
			session: options.session ?? null,
			...(options.view ? { view: options.view() } : {}),
			...(options.now ? { now: options.now } : {})
		})

		this.#setState({ status: "saving", failure: null })

		try {
			await options.save(draft, {
				signal: new AbortController().signal,
				requestId: `${this.id}@${draft.revision}`
			})
		} catch (error) {
			this.#setState({
				status: "failed",
				failure: Object.freeze({ message: error instanceof Error ? error.message : String(error), error })
			})

			return false
		}

		this.#saved = at
		this.#setState({ status: this.dirty ? "unsaved" : "saved", savedAt: draft.savedAt, failure: null })

		// Changes made while it was saving are saved by the next one.
		if (this.dirty) {
			this.#schedule()
		}

		return true
	}

	/**
	 * A run starting, going unknown or ending changes what a draft holds of the session: a page closed
	 * mid-run must open again knowing the run is out there. A check changes nothing a draft keeps.
	 */
	#onSession(): void {
		if (this.#options.session?.state.phase !== "checking") {
			this.changed()
		}
	}

	#schedule(): void {
		if (this.#delay === 0 || this.#disposed) {
			return
		}

		this.#clearTimer()
		this.#timer = setTimeout(() => {
			this.#timer = null
			void this.save()
		}, this.#delay)
	}

	#clearTimer(): void {
		if (this.#timer !== null) {
			clearTimeout(this.#timer)
			this.#timer = null
		}
	}

	#setState(patch: Partial<SaverState>): void {
		this.#state = Object.freeze({ ...this.#state, ...patch })
		this.#version++
		this.#listeners.emit(this)
	}
}
