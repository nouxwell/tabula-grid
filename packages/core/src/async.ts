/** Settles as the promise does, or rejects once the signal aborts, whichever comes first. */
export function raced<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = (): void => reject(abortError())

		if (signal.aborted) {
			abort()

			return
		}

		signal.addEventListener("abort", abort, { once: true })
		promise.then(
			value => {
				signal.removeEventListener("abort", abort)
				resolve(value)
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort)
				reject(error instanceof Error ? error : new Error(String(error)))
			}
		)
	})
}

/** Resolves after `ms`, or rejects once the signal aborts. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
	return raced(new Promise<void>(resolve => setTimeout(resolve, ms)), signal)
}

export function abortError(): Error {
	const error = new Error("The request was cancelled.")

	error.name = "AbortError"

	return error
}

/** A signal that never aborts, for a request nobody will cancel. */
export function neverAborted(): AbortSignal {
	return new AbortController().signal
}
