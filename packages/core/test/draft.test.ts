import { afterEach, describe, expect, it, vi } from "vitest"
import {
	createDraft,
	DraftSaver,
	mapDraft,
	ModuleSchema,
	openDraft,
	readDraft,
	RowStore,
	SheetSession,
	suggestRenames,
	TabulaError,
	type Draft,
	type ModuleSchemaInput,
	type ProcessRequest,
	type ProcessResponse,
	type SheetAdapters
} from "../src/index"

const INPUT: ModuleSchemaInput = {
	module: "inventory.count",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", lookup: "product", required: true },
		{ key: "counted", type: "integer", required: true },
		{ key: "shelf", type: "string" }
	]
}

const schema = ModuleSchema.from(INPUT)
const NOW = new Date("2026-11-17T09:30:00.000Z")

function storeOf(): RowStore {
	let next = 0

	return new RowStore({
		createRowId: () => `row_${++next}`,
		rows: [
			{ values: { product: { id: 7, label: "Çelik Termos" }, counted: "12", shelf: "A-1" } },
			{ values: { product: { id: 8, label: "Kupa" }, counted: "3" } },
			{ values: { product: { id: 9, label: "Matara" }, counted: "40", shelf: "B-4" } }
		]
	})
}

/** A process adapter that answers each run as the test says. */
function backend() {
	const runs: { request: ProcessRequest; resolve: (response: ProcessResponse) => void }[] = []
	const adapters: SheetAdapters = {
		process: request => new Promise(resolve => runs.push({ request, resolve }))
	}

	return { adapters, runs }
}

function codeOf(fn: () => unknown): string | undefined {
	try {
		fn()
	} catch (error) {
		if (error instanceof TabulaError) {
			return error.code
		}

		throw error
	}

	return undefined
}

/** A draft as storage gives it back: through JSON and out again. */
function stored(draft: Draft): unknown {
	return JSON.parse(JSON.stringify(draft))
}

afterEach(() => {
	vi.useRealTimers()
})

describe("drafts", () => {
	it("writes a sheet as JSON that reads back to the same draft", async () => {
		const store = storeOf()
		const { adapters, runs } = backend()
		const session = new SheetSession({ schema, store, adapters })
		const running = session.process()

		runs[0]?.resolve({ status: "partial", rows: [{ rowId: "row_1", result: "succeeded", data: { countId: 81 } }] })
		await running

		const draft = createDraft({
			id: "d_1",
			name: "Depo A sayımı",
			schema,
			store,
			session,
			view: { columnWidths: { shelf: 180 } },
			now: () => NOW
		})

		expect(draft).toMatchObject({
			format: "tabula-grid.draft",
			version: 1,
			id: "d_1",
			name: "Depo A sayımı",
			module: "inventory.count",
			schemaVersion: 1,
			sheetId: "inventory.count",
			savedAt: "2026-11-17T09:30:00.000Z",
			fields: [
				{ key: "product", type: "lookup" },
				{ key: "counted", type: "integer" },
				{ key: "shelf", type: "string" }
			]
		})
		expect(draft.session.results.map(result => `${result.rowId}:${result.outcome}`)).toEqual([
			"row_1:succeeded",
			"row_2:skipped",
			"row_3:skipped"
		])
		expect(readDraft(stored(draft))).toEqual(draft)
	})

	it("refuses what is not a draft, with every problem at once", () => {
		const draft = createDraft({ id: "d_1", schema, store: storeOf(), now: () => NOW })
		const broken = {
			...(stored(draft) as Record<string, unknown>),
			version: 2,
			fields: [{ key: "counted", type: "number" }],
			rows: [{ rowId: "row_1" }],
			view: { columnWidths: { shelf: "wide" } }
		}

		expect(codeOf(() => readDraft(broken))).toBe("invalid_draft")
		expect(() => readDraft(broken)).toThrow(
			/version[\s\S]*fields\[0\][\s\S]*rows\[0\][\s\S]*view\.columnWidths\.shelf/
		)
		expect(codeOf(() => readDraft("not a draft"))).toBe("invalid_draft")
	})

	it("opens a draft of the same schema version as it was", () => {
		const store = storeOf()
		const draft = readDraft(
			stored(createDraft({ id: "d_1", schema, store, view: { columnWidths: { shelf: 150 } } }))
		)
		const opening = openDraft(draft, schema)

		expect(opening).toMatchObject({ status: "opened", changes: null, view: { columnWidths: { shelf: 150 } } })

		if (opening.status === "opened") {
			expect(new RowStore({ rows: opening.rows }).snapshot()).toEqual(store.snapshot())
		}
	})

	it("refuses a draft of another module", () => {
		const draft = createDraft({ id: "d_1", schema, store: storeOf() })
		const other = ModuleSchema.from({ ...INPUT, module: "product.price_update" })

		expect(openDraft(draft, other)).toEqual({ status: "wrong_module", module: "inventory.count" })
	})

	it("does not open a draft the schema has moved on from until that is accepted, then drops only what is gone", () => {
		const draft = createDraft({
			id: "d_1",
			schema,
			store: storeOf(),
			view: { columnWidths: { shelf: 150, counted: 90 } }
		})
		const moved = ModuleSchema.from({
			...INPUT,
			schemaVersion: 2,
			fields: [
				{ key: "product", type: "lookup", lookup: "product", required: true },
				{ key: "counted", type: "decimal", required: true },
				{ key: "unit", type: "options", options: [{ value: "adet" }, { value: "koli" }] }
			]
		})

		const review = openDraft(draft, moved)

		expect(review).toEqual({
			status: "review",
			changes: {
				fromVersion: 1,
				toVersion: 2,
				added: ["unit"],
				removed: ["shelf"],
				retyped: [{ key: "counted", from: "integer", to: "decimal" }],
				renamed: [],
				losing: 2
			}
		})

		const opened = openDraft(draft, moved, { accept: true })

		expect(opened.status).toBe("opened")

		if (opened.status === "opened") {
			expect(opened.rows[0]).toEqual({
				rowId: "row_1",
				values: { product: { id: 7, label: "Çelik Termos" }, counted: "12" }
			})
			expect(opened.view.columnWidths).toEqual({ counted: 90 })
			expect(opened.changes?.removed).toEqual(["shelf"])
		}
	})

	it("carries a renamed field's values to its new key", () => {
		const draft = createDraft({ id: "d_1", schema, store: storeOf() })
		const renamed = ModuleSchema.from({
			...INPUT,
			schemaVersion: 2,
			fields: [
				{ key: "product", type: "lookup", lookup: "product", required: true },
				{ key: "counted", type: "integer", required: true },
				{ key: "location", type: "string" }
			]
		})

		const opening = openDraft(draft, renamed, { rename: { shelf: "location" }, accept: true })

		expect(opening).toMatchObject({
			status: "opened",
			changes: { added: [], removed: [], renamed: [{ from: "shelf", to: "location" }], losing: 0 }
		})

		if (opening.status === "opened") {
			expect(opening.rows[2]?.values).toMatchObject({ location: "B-4" })
		}

		// The column layout follows the rename too.
		const laidOut = createDraft({
			id: "d_2",
			schema,
			store: storeOf(),
			view: { columnWidths: {}, columns: { hidden: ["counted"], pinned: ["shelf"], order: ["shelf", "product"] } }
		})
		const reopened = openDraft(readDraft(stored(laidOut)), renamed, { rename: { shelf: "location" }, accept: true })

		expect(reopened).toMatchObject({
			status: "opened",
			view: { columns: { hidden: ["counted"], pinned: ["location"], order: ["location", "product"] } }
		})

		expect(codeOf(() => openDraft(draft, renamed, { rename: { aisle: "location" } }))).toBe("invalid_argument")
		expect(codeOf(() => openDraft(draft, renamed, { rename: { shelf: "bin" } }))).toBe("unknown_field")
	})

	describe("mapping a draft's fields before it opens", () => {
		const before = ModuleSchema.from({
			module: "inventory.count",
			schemaVersion: 1,
			fields: [
				{ key: "product", type: "lookup", lookup: "product", label: "Ürün" },
				{ key: "counted", type: "decimal", label: "Sayılan adet" },
				{ key: "shelf", type: "string", label: "Raf" },
				{ key: "note", type: "string", label: "Not" }
			]
		})
		const after = ModuleSchema.from({
			module: "inventory.count",
			schemaVersion: 2,
			fields: [
				{ key: "product", type: "lookup", lookup: "product", label: "Ürün" },
				{ key: "counted", type: "integer", label: "Sayılan adet" },
				{ key: "location", type: "string", label: "Raf yeri" },
				{ key: "comment", type: "string", label: "Açıklama" }
			]
		})
		const draft = createDraft({
			id: "d_1",
			schema: before,
			store: new RowStore({
				createRowId: (() => {
					let next = 0

					return () => `row_${++next}`
				})(),
				rows: [
					{ values: { product: { id: 7, label: "Termos" }, counted: "12", shelf: "A-1", note: "kırık" } },
					{ values: { product: { id: 8, label: "Kupa" }, counted: "2.5", shelf: "B-2" } },
					{ values: { product: { id: 9, label: "Matara" }, counted: "40" } }
				]
			})
		})

		it("keeps each field's label, and reads a draft saved before labels were kept", () => {
			expect(draft.fields[2]).toEqual({ key: "shelf", type: "string", label: "Raf" })

			const old = stored(draft) as { fields: { label?: string }[] }

			old.fields.forEach(field => delete field.label)

			expect(mapDraft(readDraft(old), after).fields[2]).toMatchObject({ key: "shelf", label: null })
		})

		it("suggests a rename only to a field of the same type whose name shares a word", () => {
			// "Raf" and "Raf yeri" share a word; "Not" and "Açıklama" share none, so nothing is guessed.
			expect(suggestRenames(draft, after)).toEqual({ shelf: "location" })
		})

		it("says where each field goes, what it holds, what the new type cannot read and what is lost", () => {
			const mapping = mapDraft(draft, after, { rename: { shelf: "location" } })

			expect(mapping.fields.map(field => [field.key, field.target, field.filled, field.unreadable])).toEqual([
				["product", "product", 3, 0],
				// Now whole numbers: 2.5 is not one, and opens marked.
				["counted", "counted", 3, 1],
				["shelf", "location", 2, 0],
				["note", null, 1, 0]
			])
			expect(mapping.fields[2]?.samples).toEqual(["A-1", "B-2"])
			expect(mapping.added).toEqual(["comment"])
			expect(mapping.losing).toBe(1)

			// Without the rename the shelf is dropped too.
			expect(mapDraft(draft, after).losing).toBe(2)
			expect(codeOf(() => mapDraft(draft, after, { rename: { shelf: "bin" } }))).toBe("unknown_field")
		})
	})

	it("opens a processed row locked, and a run that never answered still unknown, to be sent again as it was", async () => {
		const store = storeOf()
		const first = backend()
		const session = new SheetSession({ schema, store, adapters: first.adapters })

		void session.process()

		const sent = first.runs[0]?.request
		const draft = readDraft(stored(createDraft({ id: "d_1", schema, store, session })))

		session.dispose()

		const opening = openDraft(draft, schema)

		if (opening.status !== "opened") {
			throw new Error("The draft did not open.")
		}

		const second = backend()
		const reopened = new SheetSession({
			schema,
			store: new RowStore({ rows: opening.rows }),
			adapters: second.adapters,
			restore: opening.session
		})

		expect(reopened.state).toMatchObject({ phase: "unknown", run: { status: "unknown", rows: 3 } })
		expect(reopened.results.isLocked("row_2")).toBe(true)

		const again = reopened.process()

		expect(second.runs[0]?.request).toEqual(sent)

		second.runs[0]?.resolve({ status: "partial", rows: [{ rowId: "row_1", result: "succeeded" }] })

		await expect(again).resolves.toMatchObject({ succeeded: 1, skipped: 2 })

		// And a draft of that keeps row_1 locked and out of the next run.
		const later = openDraft(
			readDraft(stored(createDraft({ id: "d_1", schema, store: reopened.store, session: reopened }))),
			schema
		)

		if (later.status === "opened") {
			const third = new SheetSession({
				schema,
				store: new RowStore({ rows: later.rows }),
				adapters: {},
				restore: later.session
			})

			expect(third.state.phase).toBe("idle")
			expect(third.results.isLocked("row_1")).toBe(true)
			expect(third.unfinishedRows()).toEqual(["row_2", "row_3"])
		}
	})
})

describe("DraftSaver", () => {
	function saverOf(options: { delay?: number; fail?: boolean } = {}) {
		const store = storeOf()
		const saved: Draft[] = []
		const pending: { resolve: () => void; reject: (error: unknown) => void }[] = []
		let manual = false
		const saver = new DraftSaver({
			schema,
			store,
			delay: options.delay ?? 1000,
			createId: () => "d_new",
			now: () => NOW,
			save: draft =>
				new Promise<void>((resolve, reject) => {
					if (manual) {
						pending.push({ resolve: () => (saved.push(draft), resolve()), reject })
					} else if (options.fail) {
						reject(new TypeError("Failed to fetch"))
					} else {
						saved.push(draft)
						resolve()
					}
				})
		})

		return { store, saver, saved, pending, hold: () => (manual = true) }
	}

	it("saves a moment after the last change, once for a burst of them", async () => {
		vi.useFakeTimers()

		const { store, saver, saved } = saverOf()

		store.setCell("row_1", "counted", "13")
		store.setCell("row_2", "counted", "4")
		expect(saver.state.status).toBe("unsaved")

		await vi.advanceTimersByTimeAsync(999)
		expect(saved).toHaveLength(0)

		store.setCell("row_3", "counted", "41")
		await vi.advanceTimersByTimeAsync(1000)

		expect(saved).toHaveLength(1)
		expect(saved[0]?.revision).toBe(3)
		expect(saved[0]?.id).toBe("d_new")
		expect(saver.state).toEqual({ status: "saved", savedAt: "2026-11-17T09:30:00.000Z", failure: null })
		expect(saver.dirty).toBe(false)
	})

	it("saves only when asked when its delay is 0", async () => {
		vi.useFakeTimers()

		const { store, saver, saved } = saverOf({ delay: 0 })

		store.setCell("row_1", "counted", "13")
		await vi.advanceTimersByTimeAsync(60_000)
		expect(saved).toHaveLength(0)

		await expect(saver.save()).resolves.toBe(true)
		expect(saved).toHaveLength(1)
		await expect(saver.flush()).resolves.toBe(true)
		expect(saved).toHaveLength(1)
	})

	it("saves what changed during a save with the next one", async () => {
		vi.useFakeTimers()

		const { store, saver, saved, pending, hold } = saverOf()

		hold()
		store.setCell("row_1", "counted", "13")
		await vi.advanceTimersByTimeAsync(1000)
		expect(saver.state.status).toBe("saving")

		store.setCell("row_1", "counted", "14")
		pending[0]?.resolve()
		await vi.advanceTimersByTimeAsync(0)

		expect(saver.state.status).toBe("unsaved")

		await vi.advanceTimersByTimeAsync(1000)
		pending[1]?.resolve()
		await vi.advanceTimersByTimeAsync(0)

		expect(saved.map(draft => draft.rows[0]?.values.counted)).toEqual(["13", "14"])
		expect(saver.state.status).toBe("saved")
	})

	it("says so when a save fails, and tries again on the next change", async () => {
		const { store, saver } = saverOf({ delay: 0, fail: true })

		store.setCell("row_1", "counted", "13")

		await expect(saver.save()).resolves.toBe(false)
		expect(saver.state).toMatchObject({ status: "failed", failure: { message: "Failed to fetch" } })
		expect(saver.dirty).toBe(true)
	})

	it("keeps the session's results and a run under way in the draft", async () => {
		const store = storeOf()
		const { adapters, runs } = backend()
		const session = new SheetSession({ schema, store, adapters })
		const saved: Draft[] = []
		const saver = new DraftSaver({ schema, store, session, delay: 0, save: async draft => void saved.push(draft) })

		void session.process()
		expect(saver.dirty).toBe(true)
		await saver.save()

		expect(saved[0]?.session.pending?.request.idempotencyKey).toBe(runs[0]?.request.idempotencyKey)

		runs[0]?.resolve({ status: "succeeded" })
		await vi.waitFor(() => expect(session.state.phase).toBe("idle"))
		await saver.save()

		expect(saved[1]?.session.pending).toBeNull()
		expect(saved[1]?.session.results).toHaveLength(3)
		expect(saved[1]?.id).toBe(saved[0]?.id)
	})

	it("stops saving on its own once disposed", async () => {
		vi.useFakeTimers()

		const { store, saver, saved } = saverOf()

		saver.dispose()
		store.setCell("row_1", "counted", "13")
		await vi.advanceTimersByTimeAsync(5000)

		expect(saved).toHaveLength(0)
	})
})
