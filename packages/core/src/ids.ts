/**
 * A random part for ids such as row ids and request ids: 7 base-36 characters drawn from
 * `crypto.getRandomValues`, which, unlike `randomUUID`, also works on plain http.
 */
export function randomPart(): string {
	const scope = globalThis as { crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array } }
	const word = new Uint32Array(1)

	if (typeof scope.crypto?.getRandomValues === "function") {
		scope.crypto.getRandomValues(word)
	} else {
		word[0] = Math.floor(Math.random() * 2 ** 32)
	}

	return (word[0] ?? 0).toString(36).padStart(7, "0")
}

/** Ids such as `r_1k3x9q2_1`: a random part drawn once, then a counter. */
export function sequence(prefix: string): () => string {
	const random = randomPart()
	let counter = 0

	return () => `${prefix}_${random}_${(++counter).toString(36)}`
}
