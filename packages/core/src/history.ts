import { TabulaError } from "./errors"
import { Listeners } from "./listeners"
import { LOOKUP_ORIGIN } from "./lookup"
import type { RowStore, StoreChange } from "./rows"

export interface UndoHistoryOptions {
	/** How many steps can be taken back; the oldest is forgotten past that. 100 by default. */
	readonly limit?: number
	/**
	 * Whether a change belongs to the step before it rather than being a step of its own. By default,
	 * a lookup matching the names an edit put in (`"lookup"`): one Ctrl+Z takes back both.
	 */
	readonly joins?: (change: StoreChange) => boolean
}

/** The origin of the change that takes a step back, as `StoreChange.origin` gives it. */
export const UNDO_ORIGIN = "undo"
/** The origin of the change that makes a step again. */
export const REDO_ORIGIN = "redo"

const DEFAULT_LIMIT = 100

/** One step: a change, and any that joined it, in the order they were made. */
type Step = StoreChange[]

/**
 * Undo and redo for a sheet: every change to the store is a step, whoever made it.
 *
 * A step is one transaction, so a paste of 500 rows goes back in one go, the rows it added included.
 * A change that follows from the one before, such as a lookup matching the names a paste put in,
 * joins that step rather than making one of its own. Taking a step back is itself a change, with a
 * revision of its own and `"undo"` as its origin: an answer from the backend about the sheet before
 * the undo is out of date after it, as it should be.
 *
 * Steps are taken back strictly last first. Any new change, including one a listener makes in answer
 * to an undo, ends the way forward: what was taken back can no longer be made again on top of it.
 */
export class UndoHistory {
	readonly #store: RowStore
	readonly #limit: number
	readonly #joins: (change: StoreChange) => boolean
	readonly #undo: Step[] = []
	#redo: Step[] = []
	/** The revision of the change an undo or a redo is making, which is not a step of its own. */
	#making = -1
	/** Changes recorded so far, to tell whether a listener wrote while a step was being taken. */
	#recorded = 0
	#version = 0
	readonly #listeners = new Listeners<UndoHistory>()
	#stop: (() => void) | null

	constructor(store: RowStore, options: UndoHistoryOptions = {}) {
		const limit = options.limit ?? DEFAULT_LIMIT

		if (!Number.isSafeInteger(limit) || limit < 1) {
			throw new TabulaError(
				"invalid_argument",
				`The limit of an undo history must be a whole number, 1 or more; got ${limit}.`
			)
		}

		this.#store = store
		this.#limit = limit
		this.#joins = options.joins ?? (change => change.origin === LOOKUP_ORIGIN)
		this.#stop = store.subscribe(change => this.#record(change))
	}

	/** Moves on every change to what can be undone or redone, for a view to redraw its buttons by. */
	get version(): number {
		return this.#version
	}

	get canUndo(): boolean {
		return this.#undo.length > 0
	}

	get canRedo(): boolean {
		return this.#redo.length > 0
	}

	/**
	 * The change that began the step `undo()` would take back, such as one whose origin is `"paste"`.
	 * Null when there is none.
	 */
	get nextUndo(): StoreChange | null {
		return this.#undo[this.#undo.length - 1]?.[0] ?? null
	}

	/** The change that began the step `redo()` would make again. Null when there is none. */
	get nextRedo(): StoreChange | null {
		return this.#redo[this.#redo.length - 1]?.[0] ?? null
	}

	/**
	 * Takes the last step back.
	 *
	 * @returns the change that took it back, for a view to show where it landed; null when there was
	 *   nothing to undo
	 * @throws TabulaError `conflict` when the sheet is not as the step left it, which only a store
	 *   changed while this history was not listening can be. Nothing is written, and the history,
	 *   which no longer describes the sheet, is cleared.
	 */
	undo(): StoreChange | null {
		const step = this.#undo.pop()

		if (step === undefined) {
			return null
		}

		const recorded = this.#recorded
		const made = this.#take(step, this.#undo, () => this.#store.revert(step, { origin: UNDO_ORIGIN }))

		// A listener that wrote in answer made a change on top of the undo: the step stays undone.
		if (this.#recorded === recorded) {
			this.#redo.push(step)
		}

		this.#changed()

		return made
	}

	/**
	 * Makes the last step taken back again.
	 *
	 * @returns the change that made it again; null when there was nothing to redo
	 * @throws TabulaError `conflict`, as `undo()` does
	 */
	redo(): StoreChange | null {
		const step = this.#redo.pop()

		if (step === undefined) {
			return null
		}

		const recorded = this.#recorded
		const made = this.#take(step, this.#redo, () => this.#store.replay(step, { origin: REDO_ORIGIN }))

		// Changes listeners made in answer were recorded already, and came after this one.
		this.#undo.splice(Math.max(0, this.#undo.length - (this.#recorded - recorded)), 0, step)
		this.#trim()
		this.#changed()

		return made
	}

	/** Forgets every step, such as after a draft is loaded into the store. */
	clear(): void {
		if (this.#undo.length === 0 && this.#redo.length === 0) {
			return
		}

		this.#undo.length = 0
		this.#redo = []
		this.#changed()
	}

	/** Called after each change to what can be undone or redone. Returns the way to stop. */
	subscribe(listener: (history: UndoHistory) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Stops following the store and forgets every step. */
	dispose(): void {
		this.#stop?.()
		this.#stop = null
		this.clear()
	}

	/** Runs an undo or a redo; on failure puts the step back, or clears everything on a conflict. */
	#take(step: Step, from: Step[], fn: () => StoreChange | null): StoreChange | null {
		this.#making = this.#store.revision + 1

		try {
			return fn()
		} catch (error) {
			if (error instanceof TabulaError && error.code === "conflict") {
				this.#undo.length = 0
				this.#redo = []
				this.#changed()
			} else {
				from.push(step)
			}

			throw error
		} finally {
			this.#making = -1
		}
	}

	#record(change: StoreChange): void {
		if (change.revision === this.#making) {
			return
		}

		this.#recorded++

		const last = this.#undo[this.#undo.length - 1]

		// Never while a step is being taken: what a listener writes then comes after that step, not
		// inside the one below it.
		if (last && this.#making === -1 && this.#joins(change)) {
			last.push(change)
		} else {
			this.#undo.push([change])
			this.#trim()
		}

		this.#redo = []
		this.#changed()
	}

	#trim(): void {
		if (this.#undo.length > this.#limit) {
			this.#undo.splice(0, this.#undo.length - this.#limit)
		}
	}

	#changed(): void {
		this.#version++
		this.#listeners.emit(this)
	}
}
