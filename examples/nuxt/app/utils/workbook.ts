import {
	createWorkbook,
	readWorkbook,
	sheetRecords,
	type FormulaSheets,
	type RowInit,
	type Workbook
} from "@nouxwell/tabula-core"

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

/** The field a sheet's rows are told apart by: SHEET finds this row's product in another sheet by it. */
export const RECORD_KEY = "productId"

/** A tab's rows as SHEET reads them: as last saved, or the server's for a tab never saved. */
function savedRows(tab: Workbook["sheets"][number], serverRows: readonly RowInit[]): readonly RowInit[] {
	if (tab.draft) {
		return tab.draft.rows
	}

	return tab.meta.blank === true ? [] : serverRows
}

/**
 * The workbook's sheets for SHEET, by their tabs' names: each one as last saved, a product's first
 * row where it has more than one. A sheet is read only when a formula names it, and once.
 */
export function workbookSheets(workbook: Workbook, serverRows: readonly RowInit[]): FormulaSheets {
	const read = new Map<string, ReturnType<typeof sheetRecords>>()

	return {
		key: RECORD_KEY,
		sheet: name => {
			const tab = workbook.sheets.find(each => each.name === name)

			if (!tab) {
				return undefined
			}

			let records = read.get(name)

			if (!records) {
				records = sheetRecords(savedRows(tab, serverRows), RECORD_KEY)
				read.set(name, records)
			}

			return records
		}
	}
}

/**
 * What changes what SHEET reads, for the open sheet: every tab's name, and when each of the others
 * was saved. The open sheet's own saves are left out, so saving it does not work it out again.
 */
export function sheetsSignature(workbook: Workbook): string {
	return JSON.stringify(
		workbook.sheets.map(tab => [tab.name, tab.sheetId === workbook.active ? "" : (tab.draft?.savedAt ?? "")])
	)
}

/** How many products a sheet holds, for a formula editor to show; null for a name no tab has. */
export function sheetRowCount(workbook: Workbook, name: string, serverRows: readonly RowInit[]): number | null {
	const tab = workbook.sheets.find(each => each.name === name)

	return tab ? sheetRecords(savedRows(tab, serverRows), RECORD_KEY).size : null
}

/**
 * When each tab was last saved, for the tooltip of a cell that reads it: "son kayıt 10:24", the day
 * too when it was not today. A tab never saved holds the server's rows.
 */
export function sheetNotes(workbook: Workbook, now = new Date()): Record<string, string> {
	const notes: Record<string, string> = {}
	const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" })
	const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" })

	for (const tab of workbook.sheets) {
		if (tab.name in notes) {
			continue
		}

		if (!tab.draft) {
			notes[tab.name] = "sunucudaki satırlar"
			continue
		}

		const saved = new Date(tab.draft.savedAt)
		const today = saved.toDateString() === now.toDateString()

		notes[tab.name] = `son kayıt ${today ? "" : `${day.format(saved)} `}${time.format(saved)}`
	}

	return notes
}
