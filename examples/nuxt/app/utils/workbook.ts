import { createWorkbook, readWorkbook, type Workbook } from "@nouxwell/tabula-core"

/**
 * The example keeps its workbook, every sheet's tab, template and draft, in the browser's storage.
 * An application keeps it on its server, as it keeps drafts.
 */
const WORKBOOK_KEY = "tabula-grid.example-nuxt.workbook"
/** Where a draft of one sheet was kept before there were tabs: read once, as the first tab. */
const OLD_DRAFT_KEY = "tabula-grid.example-nuxt.draft"

/** What the first sheet is called. */
export const FIRST_SHEET = "Fiyat listesi"

/** The workbook kept from last time, a draft of one sheet from before as its only tab, or a new one. */
export function loadWorkbook(module: string): Workbook {
	try {
		const kept = localStorage.getItem(WORKBOOK_KEY)

		if (kept !== null) {
			return readWorkbook(JSON.parse(kept))
		}

		const old = localStorage.getItem(OLD_DRAFT_KEY)

		if (old !== null) {
			const workbook = readWorkbook(JSON.parse(old), { name: FIRST_SHEET })

			storeWorkbook(workbook)
			localStorage.removeItem(OLD_DRAFT_KEY)

			return workbook
		}
	} catch {
		// Kept by another version, or broken: the work starts again from the server's rows.
	}

	return createWorkbook({ id: newId(), module, sheet: { name: FIRST_SHEET } })
}

export function storeWorkbook(workbook: Workbook): void {
	localStorage.setItem(WORKBOOK_KEY, JSON.stringify(workbook))
}

/** An id for a workbook or a draft, made in the browser. */
export function newId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
