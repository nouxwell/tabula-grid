import {
	readCheckResponse,
	readProcessResponse,
	type CheckResponse,
	type IssueInput,
	type ProcessProgress,
	type ProcessRequest,
	type ProcessResponse,
	type ProcessStatus,
	type RowOutcome,
	type SheetAdapters,
	type SheetRequest,
	type StatusQuery
} from "./contract"
import { neverAborted, raced, wait } from "./async"
import { TabulaError } from "./errors"
import type { UndoHistory } from "./history"
import { randomPart, sequence } from "./ids"
import { Listeners } from "./listeners"
import type { RowId, RowStore, StoreChange } from "./rows"
import type { ModuleSchema } from "./schema"
import { SheetValidator, type Issue, type IssueScope, type IssueSet, type IssueSummary } from "./validation"
import type { CellValue } from "./value"
import { isLookupValue } from "./values/read"
import type { ValueSettings } from "./values/settings"

export interface SheetSessionOptions {
	readonly schema: ModuleSchema
	readonly store: RowStore
	readonly adapters: SheetAdapters
	/** The local checks. Left out, the session makes its own, with `settings`, and disposes of it. */
	readonly validator?: SheetValidator
	readonly settings?: ValueSettings
	/**
	 * Cleared when rows are sent to be processed. Once a backend has them, taking an edit back in the
	 * sheet alone would show what was never done.
	 */
	readonly history?: UndoHistory
	/** The sheet's name in requests and issues. The schema's module by default. */
	readonly sheetId?: string
	readonly createRequestId?: () => string
	/** Milliseconds between status questions while a run answers `pending`. 1,000 by default. */
	readonly pollInterval?: number
	/** What a draft kept of an earlier session over the same rows, to go on from where it stood. */
	readonly restore?: PersistedSession
}

/**
 * What a session hands to a draft: enough that opening the draft again neither unlocks a processed
 * row nor forgets a run that never answered.
 */
export interface PersistedSession {
	/** Each row's result, for the rows still in the sheet. */
	readonly results: readonly RowResult[]
	/** A run with no final answer, to be sent again under its key, or asked about. */
	readonly pending: PendingRun | null
}

export interface PendingRun {
	readonly request: ProcessRequest
	readonly operationId: string | null
}

/**
 * `unknown`: rows were sent and no answer came back, so whether they were processed is not known.
 * The session sends the same request again, under the same key, or asks how it went; it never
 * sends those rows as a new run, which could do them twice.
 */
export type SessionPhase = "idle" | "checking" | "processing" | "unknown"

export interface SessionFailure {
	readonly stage: "preflight" | "process" | "status" | "cancel"
	/**
	 * `request_failed`: the adapter threw, such as on a network error. `invalid_response`: the answer
	 * was not in the contract's shape. `unavailable`: there is no adapter to go on with.
	 */
	readonly code: "request_failed" | "invalid_response" | "unavailable"
	readonly message: string
	readonly error: unknown
}

export interface CheckRecord {
	readonly requestId: string
	readonly revision: number
	readonly outcome: "valid" | "invalid" | "failed" | "cancelled"
}

/** `sending`: no answer yet. `unknown`: none came, and none can be counted on. */
export type RunStatus = ProcessStatus | "sending" | "unknown"

export interface RunRecord {
	readonly requestId: string
	readonly idempotencyKey: string
	readonly operationId: string | null
	readonly revision: number
	/** How many rows were sent. */
	readonly rows: number
	readonly status: RunStatus
	readonly progress: ProcessProgress | null
}

export interface SessionState {
	readonly phase: SessionPhase
	readonly check: CheckRecord | null
	readonly run: RunRecord | null
	/** What went wrong with the last request, apart from the issues of the data. */
	readonly failure: SessionFailure | null
}

export interface CheckOutcome {
	readonly status: "valid" | "invalid" | "failed" | "cancelled" | "busy" | "unavailable"
	/** How many issues the backend reported. */
	readonly issues: number
}

export interface ProcessOutcome {
	/**
	 * A run's final status, or why there was none: `blocked` by issues, `nothing` to send, `busy`
	 * with another request, `unavailable` for want of an adapter, or `unknown` for want of an answer.
	 */
	readonly status: ProcessStatus | "blocked" | "nothing" | "busy" | "unavailable" | "unknown"
	readonly succeeded: number
	readonly failed: number
	readonly skipped: number
	/** Rows held back by an issue that blocks, when the status is `blocked`. */
	readonly blocked: number
}

export interface RowResult {
	readonly rowId: RowId
	readonly outcome: RowOutcome
	readonly data: Readonly<Record<string, CellValue>>
	/** The run it came from. */
	readonly requestId: string
}

/** Each row's result from the backend, for a view to show and to lock rows by. */
export interface RowResults {
	readonly version: number
	resultOf(rowId: RowId): RowResult | null
	/** A processed row cannot be changed, nor can one on its way to the backend. */
	isLocked(rowId: RowId): boolean
	subscribe(listener: () => void): () => void
}

const DEFAULT_POLL_INTERVAL = 1000

/**
 * A sheet's way to its backend: the pre-flight check and the process run, through the adapters it
 * is given, with the backend's issues merged into the local ones.
 *
 * Every answer is about a revision of the sheet. An answer about an older one still lands, but an
 * issue on a cell changed since is marked stale rather than shown as standing; so is an issue whose
 * cell is changed after it arrived. Nothing a backend said is taken as fixed until it says so.
 *
 * Rows that went through are locked and are not sent again. A run with no answer leaves the session
 * `unknown`, its rows locked, until the same request is sent again or the backend says how it went.
 */
export class SheetSession {
	readonly schema: ModuleSchema
	readonly store: RowStore
	readonly sheetId: string
	readonly validator: SheetValidator
	/** The local issues and the backend's, for the grid and the issue panel. */
	readonly issues: IssueSet
	readonly results: RowResults

	readonly #adapters: SheetAdapters
	readonly #history: UndoHistory | null
	readonly #ownValidator: boolean
	readonly #requestId: () => string
	readonly #pollInterval: number
	readonly #merged: MergedIssues
	readonly #results: Results
	readonly #listeners = new Listeners<SheetSession>()
	readonly #stop: () => void
	/** The revision each cell and each row last changed at, to tell what an answer could not have seen. */
	readonly #cellChanged = new Map<RowId, Map<string, number>>()
	readonly #rowChanged = new Map<RowId, number>()
	#state: SessionState = Object.freeze({ phase: "idle", check: null, run: null, failure: null })
	#version = 0
	#checking: { readonly controller: AbortController; readonly request: SheetRequest } | null = null
	#running: AbortController | null = null
	/** The request of a run without a final answer: what is sent again, under the same key. */
	#pending: ProcessRequest | null = null
	#disposed = false

	constructor(options: SheetSessionOptions) {
		const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL

		if (!Number.isFinite(pollInterval) || pollInterval < 0) {
			throw new TabulaError(
				"invalid_argument",
				`pollInterval must be 0 or more milliseconds; got ${pollInterval}.`
			)
		}

		this.schema = options.schema
		this.store = options.store
		this.sheetId = options.sheetId ?? options.schema.module
		this.#ownValidator = options.validator === undefined
		this.validator = options.validator ?? new SheetValidator(options.schema, options.store, options.settings)
		this.#adapters = options.adapters
		this.#history = options.history ?? null
		this.#requestId = options.createRequestId ?? sequence("req")
		this.#pollInterval = pollInterval
		this.#merged = new MergedIssues(this.validator, this.store, this.schema)
		this.#results = new Results()
		this.issues = this.#merged
		this.results = this.#results
		this.#stop = this.store.subscribe(change => this.#onChange(change))

		if (options.restore) {
			this.#restore(options.restore)
		}
	}

	/**
	 * What a draft keeps of this session: each row's result, and a run with no final answer. A run
	 * still going is kept as one with no answer: opened again, it is sent again under its key, or
	 * asked about, and never run twice.
	 */
	persisted(): PersistedSession {
		const results: RowResult[] = []

		for (const rowId of this.store.rowIds()) {
			const result = this.#results.resultOf(rowId)

			if (result) {
				results.push(result)
			}
		}

		const pending = this.#pending
			? Object.freeze({ request: this.#pending, operationId: this.#state.run?.operationId ?? null })
			: null

		return Object.freeze({ results: Object.freeze(results), pending })
	}

	/** Moves on every change of `state`. */
	get version(): number {
		return this.#version
	}

	get state(): SessionState {
		return this.#state
	}

	/** Called after each change of `state`. Returns the way to stop. */
	subscribe(listener: (session: SheetSession) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** The rows a check or a run would send, in sheet order: every row with something in it, bar those processed. */
	unfinishedRows(): RowId[] {
		return this.store
			.rowIds()
			.filter(rowId => this.#results.resultOf(rowId)?.outcome !== "succeeded" && !this.#isEmpty(rowId))
	}

	/**
	 * Asks the backend to check the sheet. A check started while another runs replaces it, and the
	 * answer to the older one is passed over.
	 */
	async check(): Promise<CheckOutcome> {
		const ask = this.#adapters.preflight

		if (!ask) {
			return { status: "unavailable", issues: 0 }
		}

		if (this.#state.phase === "processing" || this.#state.phase === "unknown") {
			return { status: "busy", issues: 0 }
		}

		this.#checking?.controller.abort()

		const controller = new AbortController()
		const request = this.#request(this.unfinishedRows())
		const current = { controller, request }

		this.#checking = current
		this.#setState({ phase: "checking", failure: null })

		let response: CheckResponse

		try {
			const answer = await raced(
				ask(request, { signal: controller.signal, requestId: request.requestId }),
				controller.signal
			)

			response = this.#answered(request.requestId, readCheckResponse(answer))
		} catch (error) {
			if (this.#checking !== current) {
				return { status: "cancelled", issues: 0 }
			}

			this.#checking = null
			this.#setState({
				phase: "idle",
				check: record(request, "failed"),
				failure: failure("preflight", error)
			})

			return { status: "failed", issues: 0 }
		}

		if (this.#checking !== current) {
			return { status: "cancelled", issues: 0 }
		}

		this.#checking = null

		const issues = (response.issues ?? [])
			.map((input, index) => this.#toIssue(input, "preflight", String(index), request.revision, null))
			.filter((issue): issue is Issue => issue !== null)

		this.#merged.replace(issue => issue.source === "preflight", issues)

		const outcome = issues.some(issue => issue.blocking && !issue.stale) ? "invalid" : "valid"

		this.#setState({ phase: "idle", check: record(request, outcome) })

		return { status: outcome, issues: issues.length }
	}

	/**
	 * Sends the unfinished rows to be processed, or, while the last run is `unknown`, the same
	 * request again under the same key. Rows with an error standing, local or the backend's, hold
	 * back the whole run: the backend checks again anyway, and a run is not the place to find out.
	 */
	async process(): Promise<ProcessOutcome> {
		const send = this.#adapters.process

		if (!send) {
			return outcome("unavailable")
		}

		if (this.#state.phase === "checking" || this.#state.phase === "processing") {
			return outcome("busy")
		}

		let request = this.#state.phase === "unknown" ? this.#pending : null

		if (request === null) {
			const rowIds = this.unfinishedRows()

			if (rowIds.length === 0) {
				return outcome("nothing")
			}

			const blocked = this.#blockedRows(rowIds)

			if (blocked > 0) {
				return { ...outcome("blocked"), blocked }
			}

			request = Object.freeze({
				...this.#request(rowIds),
				idempotencyKey: `${this.sheetId}:${this.store.revision}:${randomPart()}`
			})
			this.#history?.clear()
		}

		const sending = request
		const controller = new AbortController()

		this.#pending = sending
		this.#running = controller
		this.#results.setInFlight(new Set(sending.rows.map(row => row.rowId)))
		this.#setState({
			phase: "processing",
			failure: null,
			run: {
				requestId: sending.requestId,
				idempotencyKey: sending.idempotencyKey,
				operationId: this.#state.run?.requestId === sending.requestId ? this.#state.run.operationId : null,
				revision: sending.revision,
				rows: sending.rows.length,
				status: "sending",
				progress: null
			}
		})

		let response: ProcessResponse

		try {
			const answer = await raced(
				send(sending, { signal: controller.signal, requestId: sending.requestId }),
				controller.signal
			)

			response = this.#answered(sending.requestId, readProcessResponse(answer))
		} catch (error) {
			return this.#lose("process", error)
		}

		return this.#follow(sending, response, controller)
	}

	/** Asks the backend how a run with no answer went, while the session is `unknown`. */
	async refresh(): Promise<ProcessOutcome> {
		const ask = this.#adapters.processStatus
		const request = this.#pending

		if (this.#state.phase !== "unknown" || request === null) {
			return outcome(this.#state.phase === "idle" ? "nothing" : "busy")
		}

		if (!ask) {
			return outcome("unavailable")
		}

		const controller = new AbortController()

		this.#running = controller
		this.#setState({ phase: "processing", failure: null })

		let response: ProcessResponse

		try {
			const answer = await raced(
				ask(this.#query(), { signal: controller.signal, requestId: request.requestId }),
				controller.signal
			)

			response = this.#answered(request.requestId, readProcessResponse(answer))
		} catch (error) {
			return this.#lose("status", error)
		}

		return this.#follow(request, response, controller)
	}

	/**
	 * Stops a check, or asks the backend to stop a run. A run the backend cannot be asked about,
	 * for want of an operation id or a `cancelProcess` adapter, is no longer waited for, and its
	 * outcome is then unknown. Rows done before a stop stay done: a cancel takes nothing back.
	 */
	async cancel(): Promise<void> {
		const checking = this.#checking

		if (checking) {
			this.#checking = null
			checking.controller.abort()
			this.#setState({ phase: "idle", check: record(checking.request, "cancelled") })

			return
		}

		const run = this.#state.run
		const stop = this.#adapters.cancelProcess

		if (this.#state.phase !== "processing" || !run) {
			return
		}

		if (run.operationId !== null && stop) {
			try {
				await stop(this.#query(), { signal: neverAborted(), requestId: run.requestId })
			} catch (error) {
				this.#setState({ failure: failure("cancel", error) })
			}

			// The run's own answer says what was stopped and what was done first.
			return
		}

		this.#running?.abort()
	}

	/**
	 * Takes the rows that went through out of the sheet, as one change, so work goes on with the rest.
	 * Their results stay: an undo brings them back as they were, processed and locked.
	 *
	 * @returns how many rows were taken out
	 */
	removeSucceeded(): number {
		const done = this.store.rowIds().filter(rowId => this.#results.resultOf(rowId)?.outcome === "succeeded")

		if (done.length > 0) {
			this.store.transact(() => this.store.removeRows(done), { origin: "processed" })
		}

		return done.length
	}

	/** Stops every request and stops following the store. */
	dispose(): void {
		this.#disposed = true
		this.#checking?.controller.abort()
		this.#checking = null
		this.#running?.abort()
		this.#running = null
		this.#stop()
		this.#merged.dispose()

		if (this.#ownValidator) {
			this.validator.dispose()
		}
	}

	// ---------------------------------------------------------------- runs

	async #follow(
		request: ProcessRequest,
		first: ProcessResponse,
		controller: AbortController
	): Promise<ProcessOutcome> {
		let response = first

		while (response.status === "pending") {
			this.#record(request, response, false)
			this.#setRun({
				operationId: response.operationId ?? this.#state.run?.operationId ?? null,
				status: "pending",
				progress: response.progress ?? this.#state.run?.progress ?? null
			})

			const ask = this.#adapters.processStatus

			if (!ask) {
				return this.#lose(
					"status",
					new TabulaError(
						"invalid_argument",
						"The run is still going, and there is no processStatus adapter to follow it."
					),
					"unavailable"
				)
			}

			try {
				await wait(this.#pollInterval, controller.signal)

				const answer = await raced(
					ask(this.#query(), { signal: controller.signal, requestId: request.requestId }),
					controller.signal
				)

				response = this.#answered(request.requestId, readProcessResponse(answer))
			} catch (error) {
				return this.#lose("status", error)
			}
		}

		if (this.#disposed) {
			return outcome("unknown")
		}

		this.#record(request, response, true)
		this.#pending = null
		this.#running = null
		this.#results.setInFlight(new Set())
		this.#setState({
			phase: "idle",
			failure: null,
			run: {
				...(this.#state.run as RunRecord),
				operationId: response.operationId ?? this.#state.run?.operationId ?? null,
				status: response.status,
				progress: response.progress ?? this.#state.run?.progress ?? null
			}
		})

		const counts = { succeeded: 0, failed: 0, skipped: 0 }

		for (const row of request.rows) {
			const result = this.#results.resultOf(row.rowId)

			if (result?.requestId === request.requestId) {
				counts[result.outcome]++
			}
		}

		return { status: response.status, ...counts, blocked: 0 }
	}

	/** No answer to go by: the rows stay locked and the request stays ready to be sent again. */
	#lose(stage: SessionFailure["stage"], error: unknown, code?: SessionFailure["code"]): ProcessOutcome {
		if (!this.#disposed) {
			const run = this.#state.run

			this.#running = null
			this.#setState({
				phase: "unknown",
				failure: failure(stage, error, code),
				run: run ? Object.freeze({ ...run, status: "unknown" }) : null
			})
		}

		return outcome("unknown")
	}

	/** Keeps what an answer says about each row it was sent. */
	#record(request: ProcessRequest, response: ProcessResponse, final: boolean): void {
		const sent = new Set(request.rows.map(row => row.rowId))
		const answered = new Set<RowId>()
		const results: RowResult[] = []
		const issues: Issue[] = []

		response.rows?.forEach((row, index) => {
			if (!sent.has(row.rowId) || answered.has(row.rowId)) {
				return
			}

			answered.add(row.rowId)
			results.push(
				Object.freeze({
					rowId: row.rowId,
					outcome: row.result,
					data: Object.freeze({ ...row.data }),
					requestId: request.requestId
				})
			)
			row.issues?.forEach((input, at) => {
				const issue = this.#toIssue(input, "process", `${index}.${at}`, request.revision, row.rowId)

				if (issue) {
					issues.push(issue)
				}
			})
		})

		if (final) {
			for (const rowId of sent) {
				// A row an earlier `pending` answer settled keeps that result.
				const settled = this.#results.resultOf(rowId)?.requestId === request.requestId

				if (!answered.has(rowId) && !settled) {
					const kind = response.status === "succeeded" ? "succeeded" : "skipped"

					answered.add(rowId)
					results.push(
						Object.freeze({ rowId, outcome: kind, data: Object.freeze({}), requestId: request.requestId })
					)
				}
			}

			response.issues?.forEach((input, index) => {
				const issue = this.#toIssue(input, "process", `run.${index}`, request.revision, null)

				if (issue) {
					issues.push(issue)
				}
			})
		}

		const done = new Set(results.filter(result => result.outcome === "succeeded").map(result => result.rowId))

		// What a run says about a row replaces what the last one said; a row that went through has
		// nothing left for a pre-flight check to say.
		this.#merged.replace(
			issue =>
				(issue.source === "process" && (issue.rowId === null ? final : answered.has(issue.rowId))) ||
				(issue.source === "preflight" && issue.rowId !== null && done.has(issue.rowId)),
			issues
		)
		this.#results.record(results)
	}

	#query(): StatusQuery {
		const request = this.#pending as ProcessRequest

		return Object.freeze({
			requestId: request.requestId,
			idempotencyKey: request.idempotencyKey,
			operationId: this.#state.run?.operationId ?? null
		})
	}

	#blockedRows(rowIds: readonly RowId[]): number {
		const server = this.#merged.server.filter(issue => issue.blocking && !issue.stale)

		if (server.some(issue => issue.rowId === null)) {
			return rowIds.length
		}

		const blockedByServer = new Set(server.map(issue => issue.rowId))

		return rowIds.filter(rowId => blockedByServer.has(rowId) || this.validator.hasErrors(rowId)).length
	}

	// ---------------------------------------------------------------- requests and answers

	#request(rowIds: readonly RowId[]): SheetRequest {
		return Object.freeze({
			requestId: this.#requestId(),
			module: this.schema.module,
			schemaVersion: this.schema.schemaVersion,
			sheetId: this.sheetId,
			revision: this.store.revision,
			rows: Object.freeze(rowIds.map(rowId => Object.freeze({ rowId, values: this.#payload(rowId) })))
		})
	}

	#payload(rowId: RowId): Readonly<Record<string, CellValue>> {
		const values: Record<string, CellValue> = {}

		for (const field of this.schema.fields) {
			if (field.submit) {
				const value = this.store.get(rowId, field.key)

				values[field.key] = field.type === "lookup" ? lookupPayload(value) : value
			}
		}

		return Object.freeze(values)
	}

	/** Nothing to send: a row holding only columns shown for reference is empty too. */
	#isEmpty(rowId: RowId): boolean {
		return this.schema.fields.every(field => !field.submit || this.store.get(rowId, field.key) === null)
	}

	/** An answer that names a request must name this one. */
	#answered<T extends { readonly requestId?: string }>(requestId: string, response: T): T {
		if (response.requestId !== undefined && response.requestId !== requestId) {
			throw new TabulaError(
				"invalid_response",
				`The answer is to request "${response.requestId}", not to "${requestId}", the one it came back for.`
			)
		}

		return response
	}

	/**
	 * An issue from a backend as the sheet holds it. One for another sheet or for a row no longer in
	 * this one is passed over. One for a field the schema does not have is kept as the row's, the key
	 * in its params, so it is still seen.
	 */
	#toIssue(input: IssueInput, source: string, key: string, revision: number, row: RowId | null): Issue | null {
		if (input.sheetId != null && input.sheetId !== this.sheetId) {
			return null
		}

		const rowId = input.rowId === undefined ? row : input.rowId

		if (rowId !== null && !this.store.has(rowId)) {
			return null
		}

		const params: Record<string, string> = {}

		for (const [name, value] of Object.entries(input.params ?? {})) {
			params[name] = value === null ? "" : String(value)
		}

		let field = input.field ?? null

		if (field !== null && !this.schema.has(field)) {
			params.field ??= field
			field = null
		}

		const scope = scopeOf(input.scope, rowId, field)
		const severity = input.severity ?? "error"
		const issue: Issue = {
			id: `${source}|${key}|${input.code}|${rowId ?? ""}|${field ?? ""}`,
			scope,
			source,
			rowId: scope === "sheet" || scope === "workbook" ? null : rowId,
			field: scope === "cell" ? field : null,
			targets: Object.freeze((input.targets ?? []).map(target => Object.freeze({ ...target }))),
			code: input.code,
			severity,
			blocking: input.blocking ?? severity === "error",
			stale: false,
			message: input.message ?? input.code,
			params: Object.freeze(params)
		}

		return Object.freeze({ ...issue, stale: this.#changedSince(issue, revision) })
	}

	/** Whether a cell the issue is about changed after the revision it was found at. */
	#changedSince(issue: Issue, revision: number): boolean {
		if (issue.rowId === null) {
			return this.store.revision > revision
		}

		const changed =
			issue.scope === "row"
				? (this.#rowChanged.get(issue.rowId) ?? -1)
				: (this.#cellChanged.get(issue.rowId)?.get(issue.field ?? "") ?? -1)

		return (
			changed > revision ||
			issue.targets.some(
				target =>
					!this.store.has(target.rowId) ||
					(this.#cellChanged.get(target.rowId)?.get(target.field) ?? -1) > revision
			)
		)
	}

	// ---------------------------------------------------------------- the sheet changing

	#onChange(change: StoreChange): void {
		const cells = new Map<RowId, Set<string>>()
		const removed = new Set<RowId>()

		for (const operation of change.operations) {
			if (operation.kind === "set") {
				let fields = this.#cellChanged.get(operation.rowId)

				if (!fields) {
					fields = new Map()
					this.#cellChanged.set(operation.rowId, fields)
				}

				fields.set(operation.field, change.revision)
				this.#rowChanged.set(operation.rowId, change.revision)

				const touched = cells.get(operation.rowId) ?? new Set()

				touched.add(operation.field)
				cells.set(operation.rowId, touched)
			} else if (operation.kind === "insert") {
				for (const row of operation.rows) {
					this.#rowChanged.set(row.rowId, change.revision)
				}
			} else {
				for (const row of operation.rows) {
					removed.add(row.rowId)
				}
			}
		}

		const touches = (rowId: RowId, field: string): boolean =>
			removed.has(rowId) || (cells.get(rowId)?.has(field) ?? false)

		this.#merged.update(issue => {
			if (issue.rowId !== null && !this.store.has(issue.rowId)) {
				return null
			}

			if (issue.stale) {
				return issue
			}

			const affected =
				issue.rowId === null ||
				(issue.scope === "row" ? cells.has(issue.rowId) : touches(issue.rowId, issue.field ?? "")) ||
				issue.targets.some(target => touches(target.rowId, target.field))

			return affected ? Object.freeze({ ...issue, stale: true }) : issue
		})
	}

	// ---------------------------------------------------------------- state

	/** Takes up where a draft left off: results back on their rows, a run with no answer still unknown. */
	#restore(saved: PersistedSession): void {
		this.#results.record(saved.results.filter(result => this.store.has(result.rowId)))

		const pending = saved.pending

		if (!pending) {
			return
		}

		const request = pending.request

		this.#pending = request
		this.#results.setInFlight(new Set(request.rows.map(row => row.rowId)))
		this.#setState({
			phase: "unknown",
			run: Object.freeze({
				requestId: request.requestId,
				idempotencyKey: request.idempotencyKey,
				operationId: pending.operationId,
				revision: request.revision,
				rows: request.rows.length,
				status: "unknown",
				progress: null
			})
		})
	}

	#setState(patch: Partial<SessionState>): void {
		if (this.#disposed) {
			return
		}

		this.#state = Object.freeze({ ...this.#state, ...patch })
		this.#version++
		this.#listeners.emit(this)
	}

	#setRun(patch: Partial<RunRecord>): void {
		const run = this.#state.run

		if (run) {
			this.#setState({ run: Object.freeze({ ...run, ...patch }) })
		}
	}
}

// ---------------------------------------------------------------- the merged issues

interface IssueIndex {
	readonly sheet: Issue[]
	readonly rows: Map<RowId, Issue[]>
	readonly cells: Map<RowId, Map<string, Issue[]>>
}

/** The local validator's issues and the backend's, read as one set. */
class MergedIssues implements IssueSet {
	readonly #local: SheetValidator
	readonly #store: RowStore
	readonly #schema: ModuleSchema
	readonly #listeners = new Listeners<MergedIssues>()
	readonly #stop: () => void
	#server: readonly Issue[] = []
	#index: IssueIndex | null = null
	#version = 0

	constructor(local: SheetValidator, store: RowStore, schema: ModuleSchema) {
		this.#local = local
		this.#store = store
		this.#schema = schema
		this.#stop = local.subscribe(() => this.#changed())
	}

	get version(): number {
		return this.#version
	}

	/** The backend's issues alone. */
	get server(): readonly Issue[] {
		return this.#server
	}

	issuesAt(rowId: RowId, field: string): readonly Issue[] {
		const own = this.#local.issuesAt(rowId, field)
		const remote = this.#indexed().cells.get(rowId)?.get(field)

		return remote ? [...own, ...remote] : own
	}

	rowIssues(rowId: RowId): readonly Issue[] {
		return this.#indexed().rows.get(rowId) ?? []
	}

	issues(): Issue[] {
		const index = this.#indexed()
		const result: Issue[] = [...index.sheet]

		for (const rowId of this.#store.rowIds()) {
			result.push(...(index.rows.get(rowId) ?? []))

			for (const field of this.#schema.fields) {
				result.push(...this.issuesAt(rowId, field.key))
			}
		}

		return result
	}

	summary(): IssueSummary {
		const local = this.#local.summary()
		const rows = this.#local.affectedRows()
		let errors = local.errors
		let warnings = local.warnings
		let stale = 0

		for (const issue of this.#server) {
			if (issue.stale) {
				stale++
			} else if (issue.severity === "error") {
				errors++
			} else {
				warnings++
			}

			if (issue.rowId !== null) {
				rows.add(issue.rowId)
			}
		}

		return { errors, warnings, stale, rows: rows.size }
	}

	subscribe(listener: () => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Takes out the backend's issues `drop` picks, and adds `add`. */
	replace(drop: (issue: Issue) => boolean, add: readonly Issue[]): void {
		const kept = this.#server.filter(issue => !drop(issue))

		if (kept.length === this.#server.length && add.length === 0) {
			return
		}

		this.#server = [...kept, ...add]
		this.#index = null
		this.#changed()
	}

	/** Passes each of the backend's issues through `fn`: the same issue, a changed one, or null to drop it. */
	update(fn: (issue: Issue) => Issue | null): void {
		let changed = false
		const next: Issue[] = []

		for (const issue of this.#server) {
			const updated = fn(issue)

			changed ||= updated !== issue

			if (updated) {
				next.push(updated)
			}
		}

		if (changed) {
			this.#server = next
			this.#index = null
			this.#changed()
		}
	}

	dispose(): void {
		this.#stop()
	}

	#indexed(): IssueIndex {
		if (this.#index) {
			return this.#index
		}

		const index: IssueIndex = { sheet: [], rows: new Map(), cells: new Map() }

		for (const issue of this.#server) {
			if (issue.rowId === null) {
				index.sheet.push(issue)
			} else if (issue.field === null) {
				push(index.rows, issue.rowId, issue)
			} else {
				let fields = index.cells.get(issue.rowId)

				if (!fields) {
					fields = new Map()
					index.cells.set(issue.rowId, fields)
				}

				push(fields, issue.field, issue)
			}
		}

		this.#index = index

		return index
	}

	#changed(): void {
		this.#version++
		this.#listeners.emit(this)
	}
}

// ---------------------------------------------------------------- results

class Results implements RowResults {
	readonly #results = new Map<RowId, RowResult>()
	readonly #listeners = new Listeners<Results>()
	#inFlight: ReadonlySet<RowId> = new Set()
	#version = 0

	get version(): number {
		return this.#version
	}

	resultOf(rowId: RowId): RowResult | null {
		return this.#results.get(rowId) ?? null
	}

	isLocked(rowId: RowId): boolean {
		return this.#inFlight.has(rowId) || this.#results.get(rowId)?.outcome === "succeeded"
	}

	subscribe(listener: () => void): () => void {
		return this.#listeners.add(listener)
	}

	setInFlight(rows: ReadonlySet<RowId>): void {
		if (rows.size === 0 && this.#inFlight.size === 0) {
			return
		}

		this.#inFlight = rows
		this.#changed()
	}

	record(results: readonly RowResult[]): void {
		if (results.length === 0) {
			return
		}

		for (const result of results) {
			this.#results.set(result.rowId, result)
		}

		this.#changed()
	}

	#changed(): void {
		this.#version++
		this.#listeners.emit(this)
	}
}

// ---------------------------------------------------------------- helpers

function outcome(status: ProcessOutcome["status"]): ProcessOutcome {
	return { status, succeeded: 0, failed: 0, skipped: 0, blocked: 0 }
}

function record(request: SheetRequest, outcome: CheckRecord["outcome"]): CheckRecord {
	return Object.freeze({ requestId: request.requestId, revision: request.revision, outcome })
}

function failure(stage: SessionFailure["stage"], error: unknown, code?: SessionFailure["code"]): SessionFailure {
	const invalid = error instanceof TabulaError && error.code === "invalid_response"

	return Object.freeze({
		stage,
		code: code ?? (invalid ? "invalid_response" : "request_failed"),
		message: error instanceof Error ? error.message : String(error),
		error
	})
}

/** The widest scope the ids can carry, when the one given needs more than they have. */
function scopeOf(given: IssueScope | undefined, rowId: RowId | null, field: string | null): IssueScope {
	const scope = given ?? (rowId === null ? "sheet" : field === null ? "row" : "cell")

	if (scope === "cell" && field === null) {
		return rowId === null ? "sheet" : "row"
	}

	if (scope === "row" && rowId === null) {
		return "sheet"
	}

	return scope
}

function lookupPayload(value: CellValue): CellValue {
	if (isLookupValue(value)) {
		return value.id
	}

	return typeof value === "string" ? Object.freeze({ label: value }) : value
}

function push<K>(map: Map<K, Issue[]>, key: K, issue: Issue): void {
	const list = map.get(key)

	if (list) {
		list.push(issue)
	} else {
		map.set(key, [issue])
	}
}
