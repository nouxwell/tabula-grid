import type { ColumnLayout } from "./columns.js"
import type { ProcessRequest } from "./contract.js"
import { TabulaError } from "./errors.js"
import type { RowEntry, RowInit, RowStore } from "./rows.js"
import { FIELD_TYPES, type FieldSchema, type FieldType, type ModuleSchema } from "./schema.js"
import type { PendingRun, PersistedSession, RowResult, SheetSession } from "./session.js"
import { toCellValue, type CellValue } from "./value.js"
import { valueProblem } from "./values/read.js"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings.js"

/**
 * A sheet saved to go on with later. Saving a draft creates no business record: it is the sheet as
 * it stands, its rows under their ids, and what the backend said about each.
 *
 * It is plain JSON, kept wherever the application keeps it. The rows were written against one
 * version of the module's schema; `openDraft` tells when the schema has moved on since, and opens
 * such a draft only once that has been seen and accepted.
 */

export const DRAFT_FORMAT = "tabula-grid.draft"
export const DRAFT_VERSION = 1

/** A field as the draft's rows were written against it. */
export interface DraftField {
	readonly key: string
	readonly type: FieldType
	/** Its label then, so a field gone since is still known by name. Drafts saved before it was kept have none. */
	readonly label?: string
}

/** The user's view of the sheet. */
export interface DraftView {
	/** Widths the user set, by field key, as the grid's `columnWidths` holds them. */
	readonly columnWidths: Readonly<Record<string, number>>
	/** Which columns are hidden, pinned or moved, as the grid's `columns` holds them. */
	readonly columns?: ColumnLayout
}

export interface Draft {
	readonly format: typeof DRAFT_FORMAT
	/** The version of this format, not of the module's schema. */
	readonly version: typeof DRAFT_VERSION
	/** Made by the browser, so every save of one draft is the same draft: a lost answer makes no second one. */
	readonly id: string
	readonly name: string | null
	readonly module: string
	readonly schemaVersion: number
	readonly sheetId: string
	readonly fields: readonly DraftField[]
	/** When it was saved, as ISO 8601 text. */
	readonly savedAt: string
	/** The sheet's revision when it was saved. */
	readonly revision: number
	readonly rows: readonly RowEntry[]
	readonly session: PersistedSession
	readonly view: DraftView
}

export interface CreateDraftOptions {
	readonly id: string
	readonly name?: string | null
	readonly schema: ModuleSchema
	readonly store: RowStore
	/** Its results and any run with no answer go into the draft. */
	readonly session?: SheetSession | null
	readonly view?: DraftView
	readonly now?: () => Date
}

/** The sheet as it stands, as a draft. */
export function createDraft(options: CreateDraftOptions): Draft {
	const { schema, store, session } = options

	return Object.freeze({
		format: DRAFT_FORMAT,
		version: DRAFT_VERSION,
		id: options.id,
		name: options.name ?? null,
		module: schema.module,
		schemaVersion: schema.schemaVersion,
		sheetId: session?.sheetId ?? schema.module,
		fields: Object.freeze(
			schema.fields.map(field => Object.freeze({ key: field.key, type: field.type, label: field.label }))
		),
		savedAt: (options.now?.() ?? new Date()).toISOString(),
		revision: store.revision,
		rows: Object.freeze(store.snapshot()),
		session: session?.persisted() ?? Object.freeze({ results: Object.freeze([]), pending: null }),
		view: Object.freeze({
			columnWidths: Object.freeze({ ...options.view?.columnWidths }),
			...(options.view?.columns ? { columns: freezeLayout(options.view.columns) } : {})
		})
	})
}

// ---------------------------------------------------------------- opening

/** How the module's schema has moved on since a draft was saved. */
export interface DraftChanges {
	readonly fromVersion: number
	readonly toVersion: number
	/** Fields the draft has no values for: they open empty. */
	readonly added: readonly string[]
	/** Fields the schema no longer has: their values are dropped. */
	readonly removed: readonly string[]
	/** Fields of another type now: their values are kept, and checked again as the new type. */
	readonly retyped: readonly { readonly key: string; readonly from: FieldType; readonly to: FieldType }[]
	readonly renamed: readonly { readonly from: string; readonly to: string }[]
	/** How many rows hold a value in a removed field: what dropping them loses. */
	readonly losing: number
}

export interface OpenDraftOptions {
	/** Open even though the schema has moved on, once the user has seen `changes` and agreed. */
	readonly accept?: boolean
	/** A field renamed since, by its old key: its values go to the new one. */
	readonly rename?: Readonly<Record<string, string>>
}

export type DraftOpening =
	| {
			readonly status: "opened"
			/** For a new `RowStore`, under the ids the rows had. */
			readonly rows: RowInit[]
			/** For a new `SheetSession`'s `restore`. */
			readonly session: PersistedSession
			readonly view: DraftView
			/** What moved on since the draft was saved, or null when nothing did. */
			readonly changes: DraftChanges | null
	  }
	/** The schema has moved on: show `changes`, and open again with `accept` if the user agrees. */
	| { readonly status: "review"; readonly changes: DraftChanges }
	/** A draft of another module altogether. */
	| { readonly status: "wrong_module"; readonly module: string }

/**
 * Opens a draft against the module's schema as it is now. A draft saved under another schema
 * version is not opened silently: it comes back for review, with what changed, until it is opened
 * again with `accept`. Every value is then checked again by the sheet's validator, as any is.
 */
export function openDraft(draft: Draft, schema: ModuleSchema, options: OpenDraftOptions = {}): DraftOpening {
	if (draft.module !== schema.module) {
		return { status: "wrong_module", module: draft.module }
	}

	const rename = renames(draft, schema, options.rename ?? {})
	const changes = compare(draft, schema, rename)

	if (changes && !options.accept) {
		return { status: "review", changes }
	}

	const keep = (key: string): string | null => {
		const target = rename.get(key) ?? key

		return schema.has(target) ? target : null
	}

	const rows = draft.rows.map(row => {
		const values: Record<string, CellValue> = {}

		for (const [key, value] of Object.entries(row.values)) {
			const target = keep(key)

			if (target !== null) {
				values[target] = value
			}
		}

		return { rowId: row.rowId, values }
	})

	const columnWidths: Record<string, number> = {}

	for (const [key, width] of Object.entries(draft.view.columnWidths)) {
		const target = keep(key)

		if (target !== null) {
			columnWidths[target] = width
		}
	}

	// The layout follows renamed fields, and lets go of removed ones.
	const layout = draft.view.columns
	const keys = (list: readonly string[]): string[] => list.map(keep).filter((key): key is string => key !== null)
	const columns = layout
		? freezeLayout({
				...(layout.order ? { order: keys(layout.order) } : {}),
				...(layout.hidden ? { hidden: keys(layout.hidden) } : {}),
				...(layout.pinned ? { pinned: keys(layout.pinned) } : {})
			})
		: undefined

	return {
		status: "opened",
		rows,
		session: draft.session,
		view: Object.freeze({ columnWidths: Object.freeze(columnWidths), ...(columns ? { columns } : {}) }),
		changes
	}
}

function renames(draft: Draft, schema: ModuleSchema, given: Readonly<Record<string, string>>): Map<string, string> {
	const keys = new Set(draft.fields.map(field => field.key))
	const map = new Map<string, string>()

	for (const [from, to] of Object.entries(given)) {
		if (!keys.has(from)) {
			throw new TabulaError("invalid_argument", `The draft has no field "${from}" to rename.`)
		}

		if (!schema.has(to)) {
			throw new TabulaError("unknown_field", `The schema has no field "${to}" to rename "${from}" to.`)
		}

		map.set(from, to)
	}

	return map
}

/** A field of a draft, as a review before opening it shows it. */
export interface DraftFieldMapping {
	readonly key: string
	/** As the draft wrote it; null for a draft saved before labels were kept. */
	readonly label: string | null
	readonly type: FieldType
	/** Where its values go: its own field, the one it is renamed to, or null when they are dropped. */
	readonly target: string | null
	/** How many rows hold a value in it. */
	readonly filled: number
	/** Its first values, three at most, to know it by. */
	readonly samples: readonly CellValue[]
	/** How many of its values the target cannot read as its type: they open marked. */
	readonly unreadable: number
}

export interface DraftMapping {
	/** Every field of the draft, in its order. */
	readonly fields: readonly DraftFieldMapping[]
	/** The schema's fields no field of the draft goes to: they open empty. */
	readonly added: readonly string[]
	/** How many rows lose a value in a field that is dropped. */
	readonly losing: number
}

export interface MapDraftOptions {
	/** A field renamed since, by its old key, as `openDraft` takes it. */
	readonly rename?: Readonly<Record<string, string>>
	/** How values are read, to count what a field of another type cannot. Turkish by default. */
	readonly settings?: ValueSettings
}

/**
 * What opening a draft would do to each of its fields, with `rename` as given: for a screen that
 * lets the user map the fields of a draft saved under another schema before it opens.
 *
 * @throws TabulaError `invalid_argument` or `unknown_field` for a rename `openDraft` refuses
 */
export function mapDraft(draft: Draft, schema: ModuleSchema, options: MapDraftOptions = {}): DraftMapping {
	const rename = renames(draft, schema, options.rename ?? {})
	const settings = options.settings ?? VALUE_SETTINGS.tr
	const targets = new Set<string>()
	let losing = 0

	const fields = draft.fields.map(field => {
		const to = rename.get(field.key) ?? field.key
		const target = schema.has(to) ? to : null
		const values = draft.rows.map(row => row.values[field.key] ?? null).filter(value => value !== null)
		const moved = target !== null && (target !== field.key || schema.field(target).type !== field.type)
		const unreadable = moved
			? values.filter(value => valueProblem(schema.field(target), value, settings) !== null).length
			: 0

		if (target !== null) {
			targets.add(target)
		}

		return Object.freeze({
			key: field.key,
			label: field.label ?? null,
			type: field.type,
			target,
			filled: values.length,
			samples: Object.freeze(values.slice(0, 3)),
			unreadable
		})
	})

	const dropped = new Set(fields.filter(field => field.target === null).map(field => field.key))

	for (const row of draft.rows) {
		if (Object.entries(row.values).some(([key, value]) => value !== null && dropped.has(key))) {
			losing++
		}
	}

	return Object.freeze({
		fields: Object.freeze(fields),
		added: Object.freeze(schema.fields.filter(field => !targets.has(field.key)).map(field => field.key)),
		losing
	})
}

/**
 * The renames that look meant: each field the schema no longer has, paired with a new field of the
 * same type whose name shares a word with its own ("Fiyat" and "Yeni fiyat", "price" and
 * "newPrice"), the closest first, each new field taken once. A suggestion for the user to confirm,
 * never applied on its own.
 */
export function suggestRenames(draft: Draft, schema: ModuleSchema): Record<string, string> {
	const kept = new Set(draft.fields.map(field => field.key))
	const fresh = schema.fields.filter(field => !kept.has(field.key))
	const pairs: { readonly from: string; readonly to: string; readonly score: number }[] = []

	for (const old of draft.fields.filter(field => !schema.has(field.key))) {
		for (const field of fresh) {
			const score = field.type === old.type ? likeness(old, field) : 0

			if (score > 0) {
				pairs.push({ from: old.key, to: field.key, score })
			}
		}
	}

	pairs.sort((a, b) => b.score - a.score)

	const result: Record<string, string> = {}
	const taken = new Set<string>()

	for (const pair of pairs) {
		if (!(pair.from in result) && !taken.has(pair.to)) {
			result[pair.from] = pair.to
			taken.add(pair.to)
		}
	}

	return result
}

/** How alike two fields' names are: shared words of their labels count double, of their keys once. */
function likeness(old: DraftField, field: FieldSchema): number {
	const shared = (a: readonly string[], b: readonly string[]): number => a.filter(word => b.includes(word)).length

	return 2 * shared(words(old.label ?? ""), words(field.label)) + shared(keyWords(old.key), keyWords(field.key))
}

function words(text: string): string[] {
	return text
		.toLocaleLowerCase("tr")
		.split(/[^\p{L}\p{N}]+/u)
		.filter(word => word.length > 1)
}

/** "newPrice", "new_price" and "new-price" alike: new, price. */
function keyWords(key: string): string[] {
	return words(key.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
}

/** What moved on between the draft's schema and this one; null when nothing did. */
function compare(draft: Draft, schema: ModuleSchema, rename: ReadonlyMap<string, string>): DraftChanges | null {
	const old = new Map(draft.fields.map(field => [rename.get(field.key) ?? field.key, field] as const))
	const added = schema.fields.filter(field => !old.has(field.key)).map(field => field.key)
	const removed = draft.fields
		.filter(field => !schema.has(rename.get(field.key) ?? field.key))
		.map(field => field.key)
	const retyped = schema.fields.flatMap(field => {
		const before = old.get(field.key)

		return before && before.type !== field.type ? [{ key: field.key, from: before.type, to: field.type }] : []
	})
	const renamed = [...rename].map(([from, to]) => ({ from, to }))

	const same =
		draft.schemaVersion === schema.schemaVersion &&
		added.length === 0 &&
		removed.length === 0 &&
		retyped.length === 0 &&
		renamed.length === 0

	if (same) {
		return null
	}

	const gone = new Set(removed)
	const losing = draft.rows.filter(row => Object.keys(row.values).some(key => gone.has(key))).length

	return {
		fromVersion: draft.schemaVersion,
		toVersion: schema.schemaVersion,
		added,
		removed,
		retyped,
		renamed,
		losing
	}
}

// ---------------------------------------------------------------- reading

/**
 * Checks what was read back from storage against the draft format, every problem at once.
 *
 * @throws TabulaError `invalid_draft`
 */
export function readDraft(input: unknown): Draft {
	const problems: string[] = []
	const problem = (path: string, message: string): void => {
		problems.push(`${path}: ${message}`)
	}
	const root = plain(input)

	if (!root) {
		throw new TabulaError("invalid_draft", "A draft must be an object.")
	}

	if (root.format !== DRAFT_FORMAT) {
		problem("format", `must be "${DRAFT_FORMAT}".`)
	}

	if (root.version !== DRAFT_VERSION) {
		problem("version", `must be ${DRAFT_VERSION}; a draft of another version of this format cannot be read.`)
	}

	const text = (value: unknown, path: string): string => {
		if (typeof value !== "string" || value === "") {
			problem(path, "must be a non-empty string.")

			return ""
		}

		return value
	}
	const whole = (value: unknown, path: string): number => {
		if (!Number.isSafeInteger(value) || (value as number) < 0) {
			problem(path, "must be a whole number, 0 or more.")

			return 0
		}

		return value as number
	}

	const id = text(root.id, "id")
	const name = root.name === null || root.name === undefined ? null : text(root.name, "name")
	const module = text(root.module, "module")
	const schemaVersion = whole(root.schemaVersion, "schemaVersion")
	const sheetId = text(root.sheetId, "sheetId")
	const savedAt = text(root.savedAt, "savedAt")
	const revision = whole(root.revision, "revision")

	const fields: DraftField[] = list(root.fields, "fields", problem).flatMap((item, index) => {
		const field = plain(item)
		const type = field?.type

		if (!field || !FIELD_TYPES.includes(type as FieldType)) {
			problem(`fields[${index}]`, `must have a key and one of the field types (${FIELD_TYPES.join(", ")}).`)

			return []
		}

		const label = field.label === undefined ? undefined : text(field.label, `fields[${index}].label`)

		return [{ key: text(field.key, `fields[${index}].key`), type: type as FieldType, ...(label ? { label } : {}) }]
	})

	const rows = list(root.rows, "rows", problem).flatMap((item, index) => {
		const row = readRow(item, `rows[${index}]`, problem)

		return row ? [row] : []
	})

	const sessionRoot = plain(root.session)
	const results = list(sessionRoot?.results, "session.results", problem).flatMap((item, index) => {
		const result = readResult(item, `session.results[${index}]`, problem)

		return result ? [result] : []
	})
	const pending =
		sessionRoot?.pending === null || sessionRoot?.pending === undefined
			? null
			: readPending(sessionRoot.pending, "session.pending", problem)

	const widths = plain(plain(root.view)?.columnWidths) ?? {}
	const columnWidths: Record<string, number> = {}

	for (const [key, width] of Object.entries(widths)) {
		if (typeof width === "number" && Number.isFinite(width) && width > 0) {
			columnWidths[key] = width
		} else {
			problem(`view.columnWidths.${key}`, "must be a number of pixels.")
		}
	}

	const columns = readLayout(plain(root.view)?.columns, "view.columns", problem)

	if (problems.length > 0) {
		throw new TabulaError(
			"invalid_draft",
			`The draft cannot be read:\n${problems.map(line => `  ${line}`).join("\n")}`
		)
	}

	return Object.freeze({
		format: DRAFT_FORMAT,
		version: DRAFT_VERSION,
		id,
		name,
		module,
		schemaVersion,
		sheetId,
		fields: Object.freeze(fields),
		savedAt,
		revision,
		rows: Object.freeze(rows),
		session: Object.freeze({ results: Object.freeze(results), pending }),
		view: Object.freeze({ columnWidths: Object.freeze(columnWidths), ...(columns ? { columns } : {}) })
	})
}

function readLayout(input: unknown, path: string, problem: Problem): ColumnLayout | undefined {
	if (input === undefined || input === null) {
		return undefined
	}

	const layout = plain(input)

	if (!layout) {
		problem(path, "must be an object.")

		return undefined
	}

	const list = (name: "order" | "hidden" | "pinned"): string[] | undefined => {
		const value = layout[name]

		if (value === undefined) {
			return undefined
		}

		if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
			problem(`${path}.${name}`, "must be a list of field keys.")

			return undefined
		}

		return value as string[]
	}

	const order = list("order")
	const hidden = list("hidden")
	const pinned = list("pinned")

	return freezeLayout({ ...(order ? { order } : {}), ...(hidden ? { hidden } : {}), ...(pinned ? { pinned } : {}) })
}

function freezeLayout(layout: ColumnLayout): ColumnLayout {
	return Object.freeze({
		...(layout.order ? { order: Object.freeze([...layout.order]) } : {}),
		...(layout.hidden ? { hidden: Object.freeze([...layout.hidden]) } : {}),
		...(layout.pinned ? { pinned: Object.freeze([...layout.pinned]) } : {})
	})
}

type Plain = Record<string, unknown>
type Problem = (path: string, message: string) => void

function plain(value: unknown): Plain | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Plain) : null
}

function list(value: unknown, path: string, problem: Problem): unknown[] {
	if (Array.isArray(value)) {
		return value
	}

	problem(path, "must be an array.")

	return []
}

function readRow(item: unknown, path: string, problem: Problem): RowEntry | null {
	const row = plain(item)
	const values = plain(row?.values)

	if (!row || typeof row.rowId !== "string" || row.rowId === "" || !values) {
		problem(path, "must have a rowId and values.")

		return null
	}

	const read: Record<string, CellValue> = {}

	for (const [key, value] of Object.entries(values)) {
		try {
			read[key] = toCellValue(value, `${path}.values.${key}`)
		} catch (error) {
			problem(`${path}.values.${key}`, error instanceof Error ? error.message : String(error))
		}
	}

	return Object.freeze({ rowId: row.rowId, values: Object.freeze(read) })
}

function readResult(item: unknown, path: string, problem: Problem): RowResult | null {
	const result = plain(item)
	const outcome = result?.outcome

	if (
		!result ||
		typeof result.rowId !== "string" ||
		typeof result.requestId !== "string" ||
		(outcome !== "succeeded" && outcome !== "failed" && outcome !== "skipped")
	) {
		problem(path, "must have a rowId, a requestId and an outcome of succeeded, failed or skipped.")

		return null
	}

	let data: Record<string, CellValue> = {}

	try {
		data = toCellValue(plain(result.data) ?? {}, `${path}.data`) as Record<string, CellValue>
	} catch (error) {
		problem(`${path}.data`, error instanceof Error ? error.message : String(error))
	}

	return Object.freeze({ rowId: result.rowId, outcome, requestId: result.requestId, data })
}

function readPending(item: unknown, path: string, problem: Problem): PendingRun | null {
	const pending = plain(item)
	const request = plain(pending?.request)
	const strings = ["requestId", "idempotencyKey", "module", "sheetId"] as const
	const numbers = ["schemaVersion", "revision"] as const

	if (
		!pending ||
		!request ||
		strings.some(key => typeof request[key] !== "string") ||
		numbers.some(key => !Number.isSafeInteger(request[key])) ||
		!(pending.operationId === null || typeof pending.operationId === "string")
	) {
		problem(path, "must hold the request of the run with no answer, and its operationId or null.")

		return null
	}

	const rows = list(request.rows, `${path}.request.rows`, problem).flatMap((row, index) => {
		const read = readRow(row, `${path}.request.rows[${index}]`, problem)

		return read ? [read] : []
	})

	return Object.freeze({
		request: Object.freeze({ ...(request as unknown as ProcessRequest), rows: Object.freeze(rows) }),
		operationId: pending.operationId as string | null
	})
}
