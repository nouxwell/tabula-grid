type Listener<T> = (event: T) => void

/**
 * A list of listeners, called in the order they subscribed.
 *
 * A listener that throws does not stop the others, and does not undo the change it was told about:
 * the change has happened. The error is reported the way a browser reports one thrown from an event
 * listener, so it is seen rather than swallowed.
 */
export class Listeners<T> {
	readonly #listeners = new Set<Listener<T>>()

	add(listener: Listener<T>): () => void {
		// Wrapped, so the same function subscribed twice is two subscriptions, each with its own way out.
		const entry: Listener<T> = event => listener(event)
		this.#listeners.add(entry)

		return () => {
			this.#listeners.delete(entry)
		}
	}

	emit(event: T): void {
		for (const listener of [...this.#listeners]) {
			// One that an earlier listener unsubscribed is not called.
			if (!this.#listeners.has(listener)) {
				continue
			}

			try {
				listener(event)
			} catch (error) {
				report(error)
			}
		}
	}
}

function report(error: unknown): void {
	const scope = globalThis as { reportError?: (error: unknown) => void }

	if (typeof scope.reportError === "function") {
		scope.reportError(error)

		return
	}

	// Where there is no reportError, an unhandled rejection is the nearest thing: seen, and not in the way.
	void Promise.reject(error)
}
