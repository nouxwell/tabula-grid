import type { ProcessRequest } from "./contract"
import { TabulaError } from "./errors"
import type { RowEntry, RowInit, RowStore } from "./rows"
import { FIELD_TYPES, type FieldType, type ModuleSchema } from "./schema"
import type { PendingRun, PersistedSession, RowResult, SheetSession } from "./session"
import { toCellValue, type CellValue } from "./value"

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
}

/** The user's view of the sheet. */
export interface DraftView {
	/** Widths the user set, by field key, as the grid's `columnWidths` holds them. */
	readonly columnWidths: Readonly<Record<string, number>>
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
		fields: Object.freeze(schema.fields.map(field => Object.freeze({ key: field.key, type: field.type }))),
		savedAt: (options.now?.() ?? new Date()).toISOString(),
		revision: store.revision,
		rows: Object.freeze(store.snapshot()),
		session: session?.persisted() ?? Object.freeze({ results: Object.freeze([]), pending: null }),
		view: Object.freeze({ columnWidths: Object.freeze({ ...options.view?.columnWidths }) })
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

	return {
		status: "opened",
		rows,
		session: draft.session,
		view: Object.freeze({ columnWidths: Object.freeze(columnWidths) }),
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

		return [{ key: text(field.key, `fields[${index}].key`), type: type as FieldType }]
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
		view: Object.freeze({ columnWidths: Object.freeze(columnWidths) })
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
