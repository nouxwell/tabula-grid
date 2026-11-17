import type { Draft } from "@nouxwell/tabula-core"

/**
 * The playground keeps one draft in the browser's own storage. A real application would keep drafts
 * on its backend, by their ids, through the same kind of `save` function.
 */
const KEY = "tabula-grid.playground.draft"

/** What was stored, as it was stored; null when there is nothing, or the storage cannot be read. */
export function loadStoredDraft(): unknown {
	try {
		const text = localStorage.getItem(KEY)

		return text === null ? null : (JSON.parse(text) as unknown)
	} catch {
		return null
	}
}

/** Saves synchronously, so a save started as the page goes away still lands. */
export async function storeDraft(draft: Draft): Promise<void> {
	localStorage.setItem(KEY, JSON.stringify(draft))
}

export function clearStoredDraft(): void {
	try {
		localStorage.removeItem(KEY)
	} catch {
		// Nothing stored, or nothing to be done about it.
	}
}
