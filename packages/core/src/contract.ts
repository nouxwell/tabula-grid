import { TabulaError } from "./errors"
import type { RowId } from "./rows"
import type { IssueScope, IssueSeverity, IssueTarget } from "./validation"
import type { CellValue } from "./value"

/**
 * What passes between a sheet and the backend of the application that embeds it.
 *
 * The package never chooses how: an application gives a `SheetAdapters` object, and each adapter
 * calls its backend however it likes and turns the answer into the shapes here. That is also where
 * a backend with answers of its own shape is adapted.
 */

/** One row as a backend receives it, under the id it keeps in the sheet. */
export interface PayloadRow {
	readonly rowId: RowId
	/**
	 * Every field of the schema that is submitted (`submit`), empty ones as null. A lookup is sent as
	 * its id; one holding text never matched to a record is sent as `{ label }`, for the backend to
	 * match or refuse.
	 */
	readonly values: Readonly<Record<string, CellValue>>
}

/** What a pre-flight check is sent, and what a process run is sent with its key. */
export interface SheetRequest {
	/** Pairs an answer with its question; new for every request. */
	readonly requestId: string
	readonly module: string
	readonly schemaVersion: number
	readonly sheetId: string
	/** The revision of the sheet the rows were read at: what the answer will be about. */
	readonly revision: number
	readonly rows: readonly PayloadRow[]
}

export interface ProcessRequest extends SheetRequest {
	/**
	 * The same for every attempt at one run, so a backend that has seen it answers with what it did
	 * rather than doing it twice. A run that got a definite answer is never sent again; the next one
	 * gets a new key.
	 */
	readonly idempotencyKey: string
}

/** An issue as a backend reports it. Everything but `code` has a sensible default. */
export interface IssueInput {
	/** Left out: `cell` with a row and a field, `row` with a row only, `sheet` with neither. */
	readonly scope?: IssueScope
	/** Another sheet's issue is passed over. */
	readonly sheetId?: string | null
	readonly rowId?: RowId | null
	readonly field?: string | null
	readonly targets?: readonly IssueTarget[]
	readonly code: string
	/** `error` by default. */
	readonly severity?: IssueSeverity
	/** Whether it stops the sheet from being processed; by default, an error does and a warning does not. */
	readonly blocking?: boolean
	/** Shown when the interface has no wording of its own for the code; the code itself by default. */
	readonly message?: string
	readonly params?: Readonly<Record<string, string | number | boolean | null>>
}

export interface CheckResponse {
	/** When given, it must be the request's. */
	readonly requestId?: string
	readonly issues?: readonly IssueInput[]
}

/**
 * `pending`: accepted and still running; the session asks `processStatus` until it is not.
 * `partial`: some rows went through and some did not, which only a backend that allows it says.
 * `cancelled`: stopped on request. Rows done before the stop stay done: a cancel takes nothing back.
 */
export type ProcessStatus = "pending" | "succeeded" | "partial" | "failed" | "cancelled"

/** `skipped`: not processed at all, such as after another row failed in an all-or-nothing run. */
export type RowOutcome = "succeeded" | "failed" | "skipped"

export interface RowResultInput {
	readonly rowId: RowId
	readonly result: RowOutcome
	/** Bound to this row unless they name another. */
	readonly issues?: readonly IssueInput[]
	/** Whatever the backend wants kept with the row, such as the id of the record it created. */
	readonly data?: Readonly<Record<string, CellValue>>
}

export interface ProcessProgress {
	readonly done: number
	readonly total: number
}

export interface ProcessResponse {
	/** When given, it must be the request's. */
	readonly requestId?: string
	/** The backend's name for the run, to ask about it or cancel it by. */
	readonly operationId?: string | null
	readonly status: ProcessStatus
	/**
	 * A row of the request left out is taken as not processed, unless the run as a whole succeeded.
	 * A row the request did not hold is passed over.
	 */
	readonly rows?: readonly RowResultInput[]
	/** About the run as a whole rather than one row. */
	readonly issues?: readonly IssueInput[]
	readonly progress?: ProcessProgress | null
}

/** How a run is asked about or cancelled: by its operation id when known, always by its key. */
export interface StatusQuery {
	readonly requestId: string
	readonly idempotencyKey: string
	readonly operationId: string | null
}

export interface AdapterContext {
	/** Aborted when the answer is no longer wanted. An adapter passes it on to its HTTP client. */
	readonly signal: AbortSignal
	readonly requestId: string
}

/**
 * How a sheet reaches its backend. Each is optional: a sheet with no `preflight` has no backend
 * check, one with no `processStatus` cannot follow a run that answers `pending`.
 *
 * An adapter that throws, such as on a network error, is a failure of the request, kept apart from
 * the issues of the data. One that answers in the wrong shape is a failure too.
 */
export interface SheetAdapters {
	preflight?(request: SheetRequest, context: AdapterContext): Promise<CheckResponse>
	process?(request: ProcessRequest, context: AdapterContext): Promise<ProcessResponse>
	processStatus?(query: StatusQuery, context: AdapterContext): Promise<ProcessResponse>
	cancelProcess?(query: StatusQuery, context: AdapterContext): Promise<void>
}

// ---------------------------------------------------------------- reading answers

const SCOPES: readonly string[] = ["cell", "row", "sheet", "workbook"]
const SEVERITIES: readonly string[] = ["error", "warning"]
const STATUSES: readonly string[] = ["pending", "succeeded", "partial", "failed", "cancelled"]
const OUTCOMES: readonly string[] = ["succeeded", "failed", "skipped"]

/**
 * Checks a pre-flight answer against the contract. Properties it does not know are passed over, so
 * a backend may send more; a known one of the wrong kind is refused, with every problem at once.
 *
 * @throws TabulaError `invalid_response`
 */
export function readCheckResponse(input: unknown): CheckResponse {
	const reader = new Reader()
	const root = reader.object(input, "(root)")

	if (root === null) {
		return reader.done({})
	}

	return reader.done({
		...optional("requestId", reader.string(root.requestId, "requestId", true)),
		...optional("issues", reader.issues(root.issues, "issues"))
	})
}

/**
 * Checks a process answer, or a status answer, against the contract.
 *
 * @throws TabulaError `invalid_response`
 */
export function readProcessResponse(input: unknown): ProcessResponse {
	const reader = new Reader()
	const root = reader.object(input, "(root)")

	if (root === null) {
		return reader.done({ status: "failed" })
	}

	const status = reader.oneOf(root.status, "status", STATUSES)

	return reader.done({
		status: (status ?? "failed") as ProcessStatus,
		...optional("requestId", reader.string(root.requestId, "requestId", true)),
		...optional("operationId", reader.nullableString(root.operationId, "operationId")),
		...optional("rows", reader.rows(root.rows, "rows")),
		...optional("issues", reader.issues(root.issues, "issues")),
		...optional("progress", reader.progress(root.progress, "progress"))
	})
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
	return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V })
}

type Plain = Record<string, unknown>

class Reader {
	readonly #problems: string[] = []

	done<T>(value: T): T {
		if (this.#problems.length > 0) {
			throw new TabulaError(
				"invalid_response",
				`The backend's answer is not in the expected shape:\n${this.#problems.map(line => `  ${line}`).join("\n")}`
			)
		}

		return value
	}

	problem(path: string, message: string): void {
		this.#problems.push(`${path}: ${message}`)
	}

	object(value: unknown, path: string): Plain | null {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			return value as Plain
		}

		this.problem(path, `must be an object; got ${describe(value)}.`)

		return null
	}

	/** `undefined` when missing and allowed to be. */
	string(value: unknown, path: string, optionalValue = false): string | undefined {
		if (value === undefined && optionalValue) {
			return undefined
		}

		if (typeof value === "string" && value !== "") {
			return value
		}

		this.problem(path, `must be a non-empty string; got ${describe(value)}.`)

		return undefined
	}

	nullableString(value: unknown, path: string): string | null | undefined {
		return value === null ? null : this.string(value, path, true)
	}

	oneOf(value: unknown, path: string, allowed: readonly string[], optionalValue = false): string | undefined {
		if (value === undefined && optionalValue) {
			return undefined
		}

		if (typeof value === "string" && allowed.includes(value)) {
			return value
		}

		this.problem(path, `must be one of ${allowed.join(", ")}; got ${describe(value)}.`)

		return undefined
	}

	array(value: unknown, path: string): unknown[] | undefined {
		if (value === undefined) {
			return undefined
		}

		if (Array.isArray(value)) {
			return value
		}

		this.problem(path, `must be an array; got ${describe(value)}.`)

		return undefined
	}

	issues(value: unknown, path: string): IssueInput[] | undefined {
		return this.array(value, path)
			?.map((item, index) => this.issue(item, `${path}[${index}]`))
			.filter((issue): issue is IssueInput => issue !== null)
	}

	issue(value: unknown, path: string): IssueInput | null {
		const item = this.object(value, path)

		if (item === null) {
			return null
		}

		const code = this.string(item.code, `${path}.code`)
		const blocking = item.blocking

		if (blocking !== undefined && typeof blocking !== "boolean") {
			this.problem(`${path}.blocking`, `must be true or false; got ${describe(blocking)}.`)
		}

		return {
			code: code ?? "",
			...optional("scope", this.oneOf(item.scope, `${path}.scope`, SCOPES, true) as IssueScope | undefined),
			...optional("sheetId", this.nullableString(item.sheetId, `${path}.sheetId`)),
			...optional("rowId", this.nullableString(item.rowId, `${path}.rowId`)),
			...optional("field", this.nullableString(item.field, `${path}.field`)),
			...optional("targets", this.targets(item.targets, `${path}.targets`)),
			...optional(
				"severity",
				this.oneOf(item.severity, `${path}.severity`, SEVERITIES, true) as IssueSeverity | undefined
			),
			...optional("blocking", typeof blocking === "boolean" ? blocking : undefined),
			...optional("message", this.string(item.message, `${path}.message`, true)),
			...optional("params", this.params(item.params, `${path}.params`))
		}
	}

	targets(value: unknown, path: string): IssueTarget[] | undefined {
		return this.array(value, path)
			?.map((item, index) => {
				const target = this.object(item, `${path}[${index}]`)
				const rowId = target && this.string(target.rowId, `${path}[${index}].rowId`)
				const field = target && this.string(target.field, `${path}[${index}].field`)

				return rowId && field ? { rowId, field } : null
			})
			.filter((target): target is IssueTarget => target !== null)
	}

	params(value: unknown, path: string): Record<string, string | number | boolean | null> | undefined {
		if (value === undefined) {
			return undefined
		}

		const params = this.object(value, path)

		if (params === null) {
			return undefined
		}

		for (const [key, param] of Object.entries(params)) {
			if (param !== null && !["string", "number", "boolean"].includes(typeof param)) {
				this.problem(`${path}.${key}`, `must be text, a number, true, false or null; got ${describe(param)}.`)
			}
		}

		return params as Record<string, string | number | boolean | null>
	}

	rows(value: unknown, path: string): RowResultInput[] | undefined {
		return this.array(value, path)
			?.map((item, index) => this.row(item, `${path}[${index}]`))
			.filter((row): row is RowResultInput => row !== null)
	}

	row(value: unknown, path: string): RowResultInput | null {
		const item = this.object(value, path)

		if (item === null) {
			return null
		}

		const rowId = this.string(item.rowId, `${path}.rowId`)
		const result = this.oneOf(item.result, `${path}.result`, OUTCOMES) as RowOutcome | undefined
		const data = item.data === undefined ? undefined : this.object(item.data, `${path}.data`)

		if (rowId === undefined || result === undefined) {
			return null
		}

		return {
			rowId,
			result,
			...optional("issues", this.issues(item.issues, `${path}.issues`)),
			...optional("data", data === null ? undefined : (data as Record<string, CellValue>))
		}
	}

	progress(value: unknown, path: string): ProcessProgress | null | undefined {
		if (value === undefined || value === null) {
			return value
		}

		const item = this.object(value, path)
		const done = item?.done
		const total = item?.total

		if (item === null) {
			return undefined
		}

		if (typeof done !== "number" || typeof total !== "number" || done < 0 || total < 0) {
			this.problem(path, "must have a done and a total, each a number, 0 or more.")

			return undefined
		}

		return { done, total }
	}
}

function describe(value: unknown): string {
	if (value === null) {
		return "null"
	}

	if (Array.isArray(value)) {
		return "an array"
	}

	return typeof value === "string" ? JSON.stringify(value) : typeof value
}
