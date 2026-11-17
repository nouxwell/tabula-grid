import { describe, expect, it, vi } from "vitest"
import {
	ModuleSchema,
	RowStore,
	SheetSession,
	UndoHistory,
	type AdapterContext,
	type CheckResponse,
	type ProcessRequest,
	type ProcessResponse,
	type RowId,
	type SheetAdapters,
	type SheetRequest,
	type StatusQuery
} from "../src/index"

const schema = ModuleSchema.from({
	module: "product.price_update",
	schemaVersion: 3,
	fields: [
		{ key: "product", type: "lookup", lookup: "product", required: true },
		{ key: "sku", type: "string", editable: false, submit: false },
		{ key: "price", type: "money", required: true, rules: [{ rule: "min", value: "0" }] },
		{ key: "note", type: "string" }
	]
})

interface Call<Request, Response> {
	readonly request: Request
	readonly context: AdapterContext
	resolve(response: Response): void
	reject(error: unknown): void
}

/** An adapter whose answers the test gives, one call at a time. */
function adapter<Request, Response>() {
	const calls: Call<Request, Response>[] = []
	const fn = (request: Request, context: AdapterContext): Promise<Response> =>
		new Promise<Response>((resolve, reject) => calls.push({ request, context, resolve, reject }))

	return { fn, calls }
}

function setup(options: { rows?: number; history?: boolean } = {}) {
	let next = 0
	const store = new RowStore({
		createRowId: () => `row_${++next}`,
		rows: Array.from({ length: options.rows ?? 3 }, (_, index) => ({
			values: {
				product: { id: index + 1, label: `Ürün ${index + 1}` },
				sku: `SKU-${index + 1}`,
				price: `${(index + 1) * 10}`
			}
		}))
	})
	const preflight = adapter<SheetRequest, CheckResponse>()
	const process = adapter<ProcessRequest, ProcessResponse>()
	const status = adapter<StatusQuery, ProcessResponse>()
	const cancel = adapter<StatusQuery, void>()
	const adapters: SheetAdapters = {
		preflight: preflight.fn,
		process: process.fn,
		processStatus: status.fn,
		cancelProcess: cancel.fn
	}
	const history = options.history ? new UndoHistory(store) : undefined
	let requests = 0
	const session = new SheetSession({
		schema,
		store,
		adapters,
		history,
		pollInterval: 0,
		createRequestId: () => `req_${++requests}`
	})

	return { store, session, history, preflight, process, status, cancel }
}

function at<Request, Response>(calls: readonly Call<Request, Response>[], index: number): Call<Request, Response> {
	const call = calls[index]

	if (call === undefined) {
		throw new Error(`There is no call ${index}.`)
	}

	return call
}

function codes(session: SheetSession, rowId: RowId, field: string): string[] {
	return session.issues.issuesAt(rowId, field).map(issue => `${issue.source}:${issue.code}${issue.stale ? "*" : ""}`)
}

describe("SheetSession", () => {
	describe("pre-flight checks", () => {
		it("sends the submitted fields of every row with something to send, a lookup as its id", async () => {
			const { store, session, preflight } = setup({ rows: 1 })

			// Only a column shown for reference: nothing to send.
			store.appendRows([{ values: { sku: "SKU-9" } }])
			store.appendRows([{ values: { product: "Bilinmeyen ürün", price: "5" } }])

			const checking = session.check()
			const call = at(preflight.calls, 0)

			expect(call.request).toEqual({
				requestId: "req_1",
				module: "product.price_update",
				schemaVersion: 3,
				sheetId: "product.price_update",
				revision: 2,
				rows: [
					{ rowId: "row_1", values: { product: 1, price: "10", note: null } },
					{ rowId: "row_3", values: { product: { label: "Bilinmeyen ürün" }, price: "5", note: null } }
				]
			})
			expect(call.context.requestId).toBe("req_1")
			expect(session.state.phase).toBe("checking")

			call.resolve({ issues: [] })

			await expect(checking).resolves.toEqual({ status: "valid", issues: 0 })
			expect(session.state).toMatchObject({ phase: "idle", check: { requestId: "req_1", outcome: "valid" } })
		})

		it("shows the backend's issues beside the local ones, on cells, rows and the sheet", async () => {
			const { store, session, preflight } = setup()

			store.setCell("row_2", "price", "-1")

			const checking = session.check()

			at(preflight.calls, 0).resolve({
				requestId: "req_1",
				issues: [
					{
						rowId: "row_2",
						field: "price",
						code: "below_cost",
						message: "Maliyetin altında.",
						params: { cost: 12 }
					},
					{ rowId: "row_3", code: "no_permission" },
					{ code: "budget_exceeded", severity: "warning" },
					{ rowId: "row_1", field: "warehouse", code: "warehouse_closed" },
					{ sheetId: "another_sheet", rowId: "row_1", field: "price", code: "elsewhere" },
					{ rowId: "row_99", field: "price", code: "deleted_row" }
				]
			} as never)

			await expect(checking).resolves.toEqual({ status: "invalid", issues: 4 })

			expect(codes(session, "row_2", "price")).toEqual(["local:min_value", "preflight:below_cost"])
			expect(session.issues.issuesAt("row_2", "price")[1]).toMatchObject({
				scope: "cell",
				severity: "error",
				blocking: true,
				stale: false,
				message: "Maliyetin altında.",
				params: { cost: "12" }
			})
			expect(session.issues.rowIssues("row_3").map(issue => issue.code)).toEqual(["no_permission"])
			// A field the schema does not have: kept as the row's, with the key in its params.
			expect(session.issues.rowIssues("row_1")[0]).toMatchObject({
				scope: "row",
				field: null,
				params: { field: "warehouse" }
			})
			expect(session.issues.issues().map(issue => issue.code)).toEqual([
				"budget_exceeded",
				"warehouse_closed",
				"min_value",
				"below_cost",
				"no_permission"
			])
			expect(session.issues.summary()).toEqual({ errors: 4, warnings: 1, stale: 0, rows: 3 })
		})

		it("marks an issue stale once a cell it is about changes, and lets it block nothing", async () => {
			const { store, session, preflight } = setup()
			const checking = session.check()

			at(preflight.calls, 0).resolve({
				issues: [
					{ rowId: "row_1", field: "price", code: "below_cost" },
					{ rowId: "row_2", field: "price", code: "differs", targets: [{ rowId: "row_3", field: "price" }] },
					{ rowId: "row_3", code: "row_rule" },
					{ code: "sheet_rule" }
				]
			})
			await checking

			store.setCell("row_1", "note", "only a note")

			expect(codes(session, "row_1", "price")).toEqual(["preflight:below_cost"])
			expect(session.issues.issues().find(issue => issue.code === "sheet_rule")?.stale).toBe(true)

			store.setCell("row_3", "price", "31")

			expect(codes(session, "row_2", "price")).toEqual(["preflight:differs*"])
			expect(session.issues.rowIssues("row_3")[0]?.stale).toBe(true)

			store.setCell("row_1", "price", "11")

			expect(codes(session, "row_1", "price")).toEqual(["preflight:below_cost*"])
			expect(session.issues.summary()).toMatchObject({ errors: 0, stale: 4 })
		})

		it("marks stale on arrival what changed while the backend was checking", async () => {
			const { store, session, preflight } = setup()
			const checking = session.check()

			store.setCell("row_1", "price", "15")
			at(preflight.calls, 0).resolve({
				issues: [
					{ rowId: "row_1", field: "price", code: "below_cost" },
					{ rowId: "row_2", field: "price", code: "below_cost" }
				]
			})

			await expect(checking).resolves.toEqual({ status: "invalid", issues: 2 })
			expect(codes(session, "row_1", "price")).toEqual(["preflight:below_cost*"])
			expect(codes(session, "row_2", "price")).toEqual(["preflight:below_cost"])
		})

		it("passes over the answer to a check a newer one replaced", async () => {
			const { session, preflight } = setup()
			const first = session.check()
			const second = session.check()

			expect(at(preflight.calls, 0).context.signal.aborted).toBe(true)

			at(preflight.calls, 1).resolve({ issues: [] })
			at(preflight.calls, 0).resolve({ issues: [{ rowId: "row_1", field: "price", code: "old_news" }] })

			await expect(first).resolves.toMatchObject({ status: "cancelled" })
			await expect(second).resolves.toMatchObject({ status: "valid" })
			expect(session.issues.issues()).toEqual([])
		})

		it("keeps a failed request apart from the issues of the data, which stay as they were", async () => {
			const { session, preflight } = setup()
			const first = session.check()

			at(preflight.calls, 0).resolve({ issues: [{ rowId: "row_1", field: "price", code: "below_cost" }] })
			await first

			const offline = session.check()

			at(preflight.calls, 1).reject(new TypeError("Failed to fetch"))

			await expect(offline).resolves.toEqual({ status: "failed", issues: 0 })
			expect(session.state.failure).toMatchObject({
				stage: "preflight",
				code: "request_failed",
				message: "Failed to fetch"
			})
			expect(codes(session, "row_1", "price")).toEqual(["preflight:below_cost"])

			const garbled = session.check()

			at(preflight.calls, 2).resolve({ issues: [{ rowId: "row_1", severity: "fatal" }] } as never)

			await expect(garbled).resolves.toMatchObject({ status: "failed" })
			expect(session.state.failure?.code).toBe("invalid_response")
			expect(session.state.failure?.message).toContain("issues[0].code")
			expect(session.state.failure?.message).toContain("issues[0].severity")

			const misdirected = session.check()

			at(preflight.calls, 3).resolve({ requestId: "req_somebody_else", issues: [] })

			await expect(misdirected).resolves.toMatchObject({ status: "failed" })
			expect(session.state.failure?.code).toBe("invalid_response")
		})

		it("stops a check on request", async () => {
			const { session, preflight } = setup()
			const checking = session.check()

			await session.cancel()

			expect(at(preflight.calls, 0).context.signal.aborted).toBe(true)
			await expect(checking).resolves.toMatchObject({ status: "cancelled" })
			expect(session.state).toMatchObject({ phase: "idle", check: { outcome: "cancelled" } })
		})
	})

	describe("processing", () => {
		it("holds the run back while an error stands, local or the backend's, but not a stale one", async () => {
			const { store, session, preflight, process } = setup()

			store.setCell("row_2", "price", null)

			await expect(session.process()).resolves.toMatchObject({ status: "blocked", blocked: 1 })

			store.setCell("row_2", "price", "20")

			const checking = session.check()

			at(preflight.calls, 0).resolve({ issues: [{ rowId: "row_3", field: "price", code: "below_cost" }] })
			await checking

			await expect(session.process()).resolves.toMatchObject({ status: "blocked", blocked: 1 })
			expect(process.calls).toHaveLength(0)

			store.setCell("row_3", "price", "35")
			void session.process()

			expect(process.calls).toHaveLength(1)
		})

		it("processes the unfinished rows, locks those that went through, and sends only the rest next time", async () => {
			const { store, session, process } = setup()
			const running = session.process()
			const first = at(process.calls, 0)

			expect(first.request.rows.map(row => row.rowId)).toEqual(["row_1", "row_2", "row_3"])
			expect(first.request.idempotencyKey).toMatch(/^product\.price_update:0:[0-9a-z]{7}$/)
			expect(session.results.isLocked("row_2")).toBe(true)
			expect(session.state.run).toMatchObject({ status: "sending", rows: 3 })

			first.resolve({
				operationId: "op_1",
				status: "partial",
				rows: [
					{ rowId: "row_1", result: "succeeded", data: { priceListId: 501 } },
					{ rowId: "row_2", result: "succeeded" },
					{ rowId: "row_3", result: "failed", issues: [{ field: "price", code: "price_locked" }] }
				]
			})

			await expect(running).resolves.toEqual({
				status: "partial",
				succeeded: 2,
				failed: 1,
				skipped: 0,
				blocked: 0
			})
			expect(session.results.resultOf("row_1")).toMatchObject({
				outcome: "succeeded",
				data: { priceListId: 501 }
			})
			expect(session.results.isLocked("row_1")).toBe(true)
			expect(session.results.isLocked("row_3")).toBe(false)
			expect(codes(session, "row_3", "price")).toEqual(["process:price_locked"])
			expect(session.state).toMatchObject({ phase: "idle", run: { status: "partial", operationId: "op_1" } })
			expect(session.unfinishedRows()).toEqual(["row_3"])

			store.setCell("row_3", "price", "32")
			void session.process()

			const second = at(process.calls, 1)

			expect(second.request.rows.map(row => row.rowId)).toEqual(["row_3"])
			expect(second.request.idempotencyKey).not.toBe(first.request.idempotencyKey)
		})

		it("takes a row the answer left out as not processed, unless the whole run succeeded", async () => {
			const { session, process } = setup()
			const partial = session.process()

			at(process.calls, 0).resolve({ status: "failed", rows: [{ rowId: "row_1", result: "failed" }] })

			await expect(partial).resolves.toMatchObject({ failed: 1, skipped: 2 })
			expect(session.results.resultOf("row_2")?.outcome).toBe("skipped")

			const whole = session.process()

			at(process.calls, 1).resolve({ status: "succeeded" })

			await expect(whole).resolves.toMatchObject({ status: "succeeded", succeeded: 3 })
			await expect(session.process()).resolves.toMatchObject({ status: "nothing" })
		})

		it("clears the undo history once rows are sent", async () => {
			const { store, session, history } = setup({ history: true })

			store.setCell("row_1", "note", "x")
			expect(history?.canUndo).toBe(true)

			void session.process()

			expect(history?.canUndo).toBe(false)
		})

		it("sends the same request again under the same key when no answer came", async () => {
			const { store, session, process } = setup()
			const lost = session.process()

			at(process.calls, 0).reject(new TypeError("Failed to fetch"))

			await expect(lost).resolves.toMatchObject({ status: "unknown" })
			expect(session.state).toMatchObject({
				phase: "unknown",
				run: { status: "unknown" },
				failure: { stage: "process", code: "request_failed" }
			})
			expect(session.results.isLocked("row_1")).toBe(true)
			await expect(session.check()).resolves.toMatchObject({ status: "busy" })

			store.setCell("row_1", "note", "edited while unknown")

			const again = session.process()
			const [first, second] = process.calls

			// The very same request: same id, same key, and the rows as they were sent.
			expect(second?.request).toBe(first?.request)

			second?.resolve({ status: "succeeded" })

			await expect(again).resolves.toMatchObject({ status: "succeeded", succeeded: 3 })
			expect(session.state.phase).toBe("idle")
		})

		it("asks how a run went when no answer came", async () => {
			const { session, process, status } = setup()
			const lost = session.process()

			at(process.calls, 0).reject(new TypeError("Failed to fetch"))
			await lost

			const asking = session.refresh()
			const query = at(status.calls, 0)

			expect(query.request).toEqual({
				requestId: "req_1",
				idempotencyKey: expect.stringMatching(/^product\.price_update:0:/),
				operationId: null
			})

			query.resolve({ status: "succeeded", operationId: "op_9" })

			await expect(asking).resolves.toMatchObject({ status: "succeeded", succeeded: 3 })
			expect(session.state.run).toMatchObject({ status: "succeeded", operationId: "op_9" })
		})

		it("follows a pending run to its end, keeping each row's result as it comes", async () => {
			const { session, process, status } = setup()
			const running = session.process()

			at(process.calls, 0).resolve({ status: "pending", operationId: "op_7", progress: { done: 0, total: 3 } })

			await vi.waitFor(() => expect(status.calls).toHaveLength(1))
			expect(session.state.run).toMatchObject({
				status: "pending",
				operationId: "op_7",
				progress: { done: 0, total: 3 }
			})
			expect(at(status.calls, 0).request).toMatchObject({ operationId: "op_7", requestId: "req_1" })

			at(status.calls, 0).resolve({
				status: "pending",
				progress: { done: 1, total: 3 },
				rows: [{ rowId: "row_1", result: "succeeded" }]
			})

			await vi.waitFor(() => expect(status.calls).toHaveLength(2))
			expect(session.results.resultOf("row_1")?.outcome).toBe("succeeded")
			expect(session.state.run?.progress).toEqual({ done: 1, total: 3 })

			at(status.calls, 1).resolve({
				status: "partial",
				rows: [
					{ rowId: "row_2", result: "succeeded" },
					{ rowId: "row_3", result: "failed" }
				]
			})

			await expect(running).resolves.toEqual({
				status: "partial",
				succeeded: 2,
				failed: 1,
				skipped: 0,
				blocked: 0
			})
		})

		it("asks the backend to cancel a run it can name, and takes nothing back", async () => {
			const { session, process, status, cancel } = setup()
			const running = session.process()

			at(process.calls, 0).resolve({ status: "pending", operationId: "op_7" })
			await vi.waitFor(() => expect(status.calls).toHaveLength(1))

			const cancelling = session.cancel()

			expect(at(cancel.calls, 0).request).toMatchObject({ operationId: "op_7" })
			at(cancel.calls, 0).resolve(undefined as never)
			await cancelling

			at(status.calls, 0).resolve({ status: "cancelled", rows: [{ rowId: "row_1", result: "succeeded" }] })

			await expect(running).resolves.toMatchObject({ status: "cancelled", succeeded: 1, skipped: 2 })
			expect(session.results.isLocked("row_1")).toBe(true)
		})

		it("stops waiting for a run it cannot name, and calls its outcome unknown", async () => {
			const { session, process } = setup()
			const running = session.process()

			await session.cancel()

			expect(at(process.calls, 0).context.signal.aborted).toBe(true)
			await expect(running).resolves.toMatchObject({ status: "unknown" })
			expect(session.state.phase).toBe("unknown")
		})

		it("takes the rows that went through out of the sheet, as one change an undo brings back locked", async () => {
			const { store, session, history, process } = setup({ history: true })
			const running = session.process()

			at(process.calls, 0).resolve({
				status: "partial",
				rows: [
					{ rowId: "row_1", result: "succeeded" },
					{ rowId: "row_2", result: "failed" },
					{ rowId: "row_3", result: "succeeded" }
				]
			})
			await running

			expect(session.removeSucceeded()).toBe(2)
			expect(store.rowIds()).toEqual(["row_2"])

			history?.undo()

			expect(store.rowIds()).toEqual(["row_1", "row_2", "row_3"])
			expect(session.results.isLocked("row_3")).toBe(true)
		})

		it("forgets the issues of a row that is removed", async () => {
			const { store, session, preflight } = setup()
			const checking = session.check()

			at(preflight.calls, 0).resolve({ issues: [{ rowId: "row_2", field: "price", code: "below_cost" }] })
			await checking

			store.removeRows(["row_2"])

			expect(session.issues.summary()).toEqual({ errors: 0, warnings: 0, stale: 0, rows: 0 })
		})

		it("says when it cannot do what is asked", async () => {
			const store = new RowStore({ rows: [{ values: { product: { id: 1, label: "x" }, price: "1" } }] })
			const bare = new SheetSession({ schema, store, adapters: {} })

			await expect(bare.check()).resolves.toMatchObject({ status: "unavailable" })
			await expect(bare.process()).resolves.toMatchObject({ status: "unavailable" })
			bare.dispose()

			const { session } = setup()

			void session.check()
			await expect(session.process()).resolves.toMatchObject({ status: "busy" })
		})

		it("goes unknown when a pending run has no processStatus adapter to follow it", async () => {
			const store = new RowStore({ rows: [{ values: { product: { id: 1, label: "x" }, price: "1" } }] })
			const process = adapter<ProcessRequest, ProcessResponse>()
			const session = new SheetSession({ schema, store, adapters: { process: process.fn } })
			const running = session.process()

			at(process.calls, 0).resolve({ status: "pending", operationId: "op_1" })

			await expect(running).resolves.toMatchObject({ status: "unknown" })
			expect(session.state.failure).toMatchObject({ stage: "status", code: "unavailable" })
		})
	})
})
