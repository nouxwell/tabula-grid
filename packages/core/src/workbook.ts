import { DRAFT_FORMAT, readDraft, type Draft } from "./draft.js"
import { TabulaError } from "./errors.js"

/**
 * Several sheets kept together, as a spreadsheet keeps its tabs: each one a sheet of the same module
 * with rows, a template and a draft of its own, in the order the tabs stand, and the one that was
 * open. It is plain JSON, kept wherever the application keeps its drafts.
 *
 * Each sheet's draft is a draft as `createDraft` writes it, opened with `openDraft`; a sheet not yet
 * saved has none. A draft of one sheet, from before there were workbooks, reads as a workbook of
 * that one sheet.
 */

export const WORKBOOK_FORMAT = "tabula-grid.workbook"
export const WORKBOOK_VERSION = 1

/** A value the application keeps with a sheet: text, a number, true or false, or null. */
export type SheetMeta = Readonly<Record<string, string | number | boolean | null>>

export interface WorkbookSheet {
	/** The sheet's id in requests and issues: a session over it takes it as its `sheetId`. */
	readonly sheetId: string
	/** What its tab says. */
	readonly name: string
	/** The template it works with, by its id; null for the module schema as it is. */
	readonly template: string | null
	/** The sheet as last saved; null before it was. */
	readonly draft: Draft | null
	/** What the application keeps with the sheet, such as the counts its tab shows while it is closed. */
	readonly meta: SheetMeta
}

export interface Workbook {
	readonly format: typeof WORKBOOK_FORMAT
	readonly version: typeof WORKBOOK_VERSION
	readonly id: string
	readonly module: string
	/** The sheet that is open, by its id. */
	readonly active: string
	/** In the order their tabs stand; never empty. */
	readonly sheets: readonly WorkbookSheet[]
}

export interface NewSheet {
	readonly name: string
	readonly template?: string | null
	readonly draft?: Draft | null
	readonly meta?: SheetMeta
}

/** A workbook of one sheet, open: where a module's work starts. */
export function createWorkbook(options: {
	readonly id: string
	readonly module: string
	readonly sheet: NewSheet
}): Workbook {
	const sheet = sheetOf(freeSheetId([]), options.sheet)

	return freeze({
		format: WORKBOOK_FORMAT,
		version: WORKBOOK_VERSION,
		id: options.id,
		module: options.module,
		active: sheet.sheetId,
		sheets: [sheet]
	})
}

/**
 * Checks what was read back from storage against the workbook format, every problem at once. A
 * draft of one sheet comes back as a workbook of that sheet, named `name`, or by its own name.
 *
 * @throws TabulaError `invalid_workbook`, or `invalid_draft` for a draft of one sheet that does not read
 */
export function readWorkbook(input: unknown, options: { readonly name?: string } = {}): Workbook {
	const root = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Plain) : null

	if (!root) {
		throw new TabulaError("invalid_workbook", "A workbook must be an object.")
	}

	if (root.format === DRAFT_FORMAT) {
		const draft = readDraft(input)

		return freeze({
			format: WORKBOOK_FORMAT,
			version: WORKBOOK_VERSION,
			id: draft.id,
			module: draft.module,
			active: draft.sheetId,
			sheets: [
				{
					sheetId: draft.sheetId,
					name: options.name ?? draft.name ?? draft.sheetId,
					template: null,
					draft,
					meta: {}
				}
			]
		})
	}

	const problems: string[] = []
	const problem = (path: string, message: string): void => {
		problems.push(`${path}: ${message}`)
	}
	const text = (value: unknown, path: string): string => {
		if (typeof value !== "string" || value.trim() === "") {
			problem(path, "must be a non-empty string.")

			return ""
		}

		return value
	}

	if (root.format !== WORKBOOK_FORMAT) {
		problem("format", `must be "${WORKBOOK_FORMAT}".`)
	}

	if (root.version !== WORKBOOK_VERSION) {
		problem("version", `must be ${WORKBOOK_VERSION}.`)
	}

	const id = text(root.id, "id")
	const module = text(root.module, "module")
	const listed = Array.isArray(root.sheets) ? root.sheets : []
	const seen = new Set<string>()

	if (!Array.isArray(root.sheets) || listed.length === 0) {
		problem("sheets", "must be a list of one sheet or more.")
	}

	const sheets = listed.flatMap((item, index): WorkbookSheet[] => {
		const path = `sheets[${index}]`
		const sheet = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Plain) : null

		if (!sheet) {
			problem(path, "must be an object.")

			return []
		}

		const sheetId = text(sheet.sheetId, `${path}.sheetId`)

		if (seen.has(sheetId)) {
			problem(`${path}.sheetId`, `"${sheetId}" is another sheet's too.`)
		}

		seen.add(sheetId)

		const template =
			sheet.template === null || sheet.template === undefined ? null : text(sheet.template, `${path}.template`)
		let draft: Draft | null = null

		if (sheet.draft !== null && sheet.draft !== undefined) {
			try {
				draft = readDraft(sheet.draft)

				if (draft.module !== module) {
					problem(`${path}.draft.module`, `must be "${module}", the workbook's.`)
				}
			} catch (error) {
				problem(`${path}.draft`, error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error))
			}
		}

		return [
			{
				sheetId,
				name: text(sheet.name, `${path}.name`),
				template,
				draft,
				meta: readMeta(sheet.meta, `${path}.meta`, problem)
			}
		]
	})

	if (problems.length > 0) {
		throw new TabulaError(
			"invalid_workbook",
			`The workbook cannot be read:\n${problems.map(line => `  ${line}`).join("\n")}`
		)
	}

	const active = typeof root.active === "string" && seen.has(root.active) ? root.active : (sheets[0]?.sheetId ?? "")

	return freeze({ format: WORKBOOK_FORMAT, version: WORKBOOK_VERSION, id, module, active, sheets })
}

/** An id no sheet of these has: "sheet-1", "sheet-2"… */
export function freeSheetId(sheets: readonly Pick<WorkbookSheet, "sheetId">[]): string {
	const taken = new Set(sheets.map(sheet => sheet.sheetId))
	let number = 1

	while (taken.has(`sheet-${number}`)) {
		number++
	}

	return `sheet-${number}`
}

/** The workbook with a new sheet, after `after` (the last by default), open; and the sheet's id. */
export function addSheet(
	workbook: Workbook,
	sheet: NewSheet,
	after?: string
): { readonly workbook: Workbook; readonly sheetId: string } {
	const added = sheetOf(freeSheetId(workbook.sheets), sheet)
	const at = after === undefined ? -1 : workbook.sheets.findIndex(each => each.sheetId === after)
	const sheets = [...workbook.sheets]

	sheets.splice(at < 0 ? sheets.length : at + 1, 0, added)

	return { workbook: freeze({ ...workbook, active: added.sheetId, sheets }), sheetId: added.sheetId }
}

/**
 * The workbook with one sheet changed: its name, template, draft or what the application keeps
 * with it.
 *
 * @throws TabulaError `invalid_argument` for a sheet the workbook does not have, or an empty name
 */
export function withSheet(
	workbook: Workbook,
	sheetId: string,
	patch: Partial<Pick<WorkbookSheet, "name" | "template" | "draft" | "meta">>
): Workbook {
	found(workbook, sheetId)

	if (patch.name !== undefined && patch.name.trim() === "") {
		throw new TabulaError("invalid_argument", "A sheet's name must not be empty.")
	}

	return freeze({
		...workbook,
		sheets: workbook.sheets.map(sheet =>
			sheet.sheetId === sheetId
				? { ...sheet, ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) }
				: sheet
		)
	})
}

/**
 * The workbook without a sheet. The one open then is its neighbour, the next or, for the last, the
 * one before.
 *
 * @throws TabulaError `invalid_argument` for the only sheet, or one the workbook does not have
 */
export function removeSheet(workbook: Workbook, sheetId: string): Workbook {
	found(workbook, sheetId)

	if (workbook.sheets.length === 1) {
		throw new TabulaError("invalid_argument", "A workbook keeps one sheet at least.")
	}

	const at = workbook.sheets.findIndex(sheet => sheet.sheetId === sheetId)
	const sheets = workbook.sheets.filter(sheet => sheet.sheetId !== sheetId)
	const active =
		workbook.active === sheetId ? (sheets[Math.min(at, sheets.length - 1)]?.sheetId ?? "") : workbook.active

	return freeze({ ...workbook, active, sheets })
}

/**
 * The workbook with another sheet open.
 *
 * @throws TabulaError `invalid_argument` for a sheet the workbook does not have
 */
export function openSheet(workbook: Workbook, sheetId: string): Workbook {
	found(workbook, sheetId)

	return freeze({ ...workbook, active: sheetId })
}

type Plain = Record<string, unknown>

function sheetOf(sheetId: string, sheet: NewSheet): WorkbookSheet {
	if (sheet.name.trim() === "") {
		throw new TabulaError("invalid_argument", "A sheet's name must not be empty.")
	}

	return {
		sheetId,
		name: sheet.name.trim(),
		template: sheet.template ?? null,
		draft: sheet.draft ?? null,
		meta: sheet.meta ?? {}
	}
}

function found(workbook: Workbook, sheetId: string): WorkbookSheet {
	const sheet = workbook.sheets.find(each => each.sheetId === sheetId)

	if (!sheet) {
		throw new TabulaError("invalid_argument", `The workbook has no sheet "${sheetId}".`)
	}

	return sheet
}

function readMeta(value: unknown, path: string, problem: (path: string, message: string) => void): SheetMeta {
	if (value === undefined || value === null) {
		return {}
	}

	if (typeof value !== "object" || Array.isArray(value)) {
		problem(path, "must be an object.")

		return {}
	}

	const meta: Record<string, string | number | boolean | null> = {}

	for (const [key, item] of Object.entries(value as Plain)) {
		if (item === null || ["string", "number", "boolean"].includes(typeof item)) {
			meta[key] = item as string | number | boolean | null
		} else {
			problem(`${path}.${key}`, "must be text, a number, true, false or null.")
		}
	}

	return meta
}

function freeze(workbook: Workbook): Workbook {
	return Object.freeze({
		...workbook,
		sheets: Object.freeze(
			workbook.sheets.map(sheet => Object.freeze({ ...sheet, meta: Object.freeze({ ...sheet.meta }) }))
		)
	})
}
