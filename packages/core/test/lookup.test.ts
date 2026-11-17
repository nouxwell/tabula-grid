import { describe, expect, it } from "vitest"
import {
	LookupResolver,
	ModuleSchema,
	RowStore,
	SheetValidator,
	TabulaError,
	UndoHistory,
	type LookupItem,
	type LookupResolveRequest,
	type LookupSearchRequest,
	type StoreChange
} from "../src/index"

const schema = ModuleSchema.from({
	module: "sales.order_lines",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", lookup: "product", required: true },
		{ key: "warehouse", type: "lookup", lookup: "warehouse" },
		{ key: "quantity", type: "integer" }
	]
})

/** A catalog: two records named "Termos", one inactive product, and a warehouse. */
const CATALOG: Readonly<Record<string, readonly LookupItem[]>> = {
	product: [
		{ id: 1, label: "Çelik Termos", description: "TRM-500" },
		{ id: 2, label: "Termos" },
		{ id: 3, label: "Termos" },
		{ id: 4, label: "Kupa" },
		{ id: 5, label: "Eski Matara", disabled: true }
	],
	warehouse: [{ id: "W1", label: "Merkez Depo" }]
}

function setup(options: { batchSize?: number; failing?: boolean } = {}) {
	let next = 0
	let clock = 0
	const store = new RowStore({ createRowId: () => `row_${++next}`, rows: [{}, {}, {}, {}] })
	const resolves: LookupResolveRequest[] = []
	const searches: LookupSearchRequest[] = []
	let failing = options.failing ?? false
	const resolver = new LookupResolver({
		schema,
		store,
		batchSize: options.batchSize ?? 200,
		now: () => clock,
		adapters: {
			search: async request => {
				searches.push(request)

				const items = (CATALOG[request.lookup] ?? []).filter(item =>
					item.label.toLocaleLowerCase("tr").includes(request.query.toLocaleLowerCase("tr"))
				)

				return { items: items.slice(0, request.limit), more: items.length > request.limit }
			},
			resolve: async request => {
				resolves.push(request)

				if (failing) {
					throw new TypeError("Failed to fetch")
				}

				return {
					matches: request.labels.map(label => ({
						label,
						items: (CATALOG[request.lookup] ?? []).filter(
							item => item.label.toLocaleLowerCase("tr") === label.toLocaleLowerCase("tr")
						)
					}))
				}
			}
		}
	})

	return {
		store,
		resolver,
		resolves,
		searches,
		tick: (ms: number) => (clock += ms),
		recover: () => (failing = false)
	}
}

function paste(store: RowStore, field: string, values: readonly string[]): void {
	store.setCells(
		values.map((value, index) => ({ rowId: `row_${index + 1}`, field, value })),
		{ origin: "paste" }
	)
}

describe("LookupResolver", () => {
	it("matches the names of one paste in one request, and puts each record in place of its name", async () => {
		const { store, resolver, resolves } = setup()
		const validator = new SheetValidator(schema, store)
		const changes: StoreChange[] = []

		store.subscribe(change => changes.push(change))
		paste(store, "product", ["çelik termos", "Kupa", "ÇELİK TERMOS", "Bilinmeyen"])
		await resolver.settled()

		expect(resolves).toEqual([
			{ lookup: "product", labels: ["çelik termos", "Kupa", "ÇELİK TERMOS", "Bilinmeyen"] }
		])
		expect(store.get("row_1", "product")).toEqual({ id: 1, label: "Çelik Termos" })
		expect(store.get("row_3", "product")).toEqual({ id: 1, label: "Çelik Termos" })
		expect(store.get("row_2", "product")).toEqual({ id: 4, label: "Kupa" })
		// Matched to nothing: it stays as typed, and says so.
		expect(store.get("row_4", "product")).toBe("Bilinmeyen")
		expect(validator.issuesAt("row_4", "product").map(issue => issue.code)).toEqual(["not_matched"])
		expect(changes.map(change => change.origin)).toEqual(["paste", "lookup"])
	})

	it("leaves a name that means several records, or only one that cannot be picked, to the user", async () => {
		const { store, resolver } = setup()

		paste(store, "product", ["Termos", "Eski Matara"])
		await resolver.settled()

		expect(store.get("row_1", "product")).toBe("Termos")
		expect(store.get("row_2", "product")).toBe("Eski Matara")
	})

	it("asks once for a name it was answered about a moment ago, and again once that has gone stale", async () => {
		const { store, resolver, resolves, tick } = setup()

		paste(store, "product", ["Kupa"])
		await resolver.settled()

		store.setCell("row_2", "product", "Kupa")
		await resolver.settled()

		expect(store.get("row_2", "product")).toEqual({ id: 4, label: "Kupa" })
		expect(resolves).toHaveLength(1)

		tick(60_000)
		store.setCell("row_3", "product", "Kupa")
		await resolver.settled()

		expect(resolves).toHaveLength(2)
	})

	it("does not write over what the user typed while the answer was on its way", async () => {
		const { store, resolver } = setup()

		paste(store, "product", ["Kupa"])
		store.setCell("row_1", "product", "Termos")
		await resolver.settled()

		expect(store.get("row_1", "product")).toBe("Termos")
	})

	it("sends thousands of names in batches, each lookup on its own", async () => {
		const { store, resolver, resolves } = setup({ batchSize: 2 })

		paste(store, "product", ["a", "b", "c"])
		store.setCell("row_1", "warehouse", "Merkez Depo")
		await resolver.settled()

		expect(resolves.map(request => `${request.lookup}:${request.labels.join(",")}`)).toEqual([
			"product:a,b",
			"product:c",
			"warehouse:Merkez Depo"
		])
		expect(store.get("row_1", "warehouse")).toEqual({ id: "W1", label: "Merkez Depo" })
	})

	it("is taken back with the paste it matched, in one step, and is not asked again on the way back or forward", async () => {
		const { store, resolver, resolves } = setup()
		const history = new UndoHistory(store)

		paste(store, "product", ["Kupa", "Bilinmeyen"])
		await resolver.settled()

		expect(history.nextUndo?.origin).toBe("paste")

		history.undo()
		await resolver.settled()

		expect(store.get("row_1", "product")).toBeNull()
		expect(store.get("row_2", "product")).toBeNull()
		expect(history.canUndo).toBe(false)

		history.redo()
		await resolver.settled()

		expect(store.get("row_1", "product")).toEqual({ id: 4, label: "Kupa" })
		expect(store.get("row_2", "product")).toBe("Bilinmeyen")
		expect(resolves).toHaveLength(1)
	})

	it("matches every name in the sheet when asked, such as after a draft is opened", async () => {
		const store = new RowStore({
			rows: [{ values: { product: "Kupa" } }, { values: { product: { id: 1, label: "Çelik Termos" } } }]
		})
		const resolves: LookupResolveRequest[] = []
		const resolver = new LookupResolver({
			schema,
			store,
			adapters: {
				search: async () => ({ items: [] }),
				resolve: async request => {
					resolves.push(request)

					return { matches: [{ label: "Kupa", items: [{ id: 4, label: "Kupa" }] }] }
				}
			}
		})

		await resolver.resolveAll()

		expect(resolves).toEqual([{ lookup: "product", labels: ["Kupa"] }])
		expect(store.snapshot()[0]?.values.product).toEqual({ id: 4, label: "Kupa" })
	})

	it("keeps names as they are when the backend cannot be reached, says so, and tries again on the next change", async () => {
		const { store, resolver, resolves, recover } = setup({ failing: true })
		const pending: number[] = []

		resolver.subscribe(() => pending.push(resolver.pending))
		paste(store, "product", ["Kupa"])
		await resolver.settled()

		expect(store.get("row_1", "product")).toBe("Kupa")
		expect(resolver.failure?.message).toBe("Failed to fetch")
		expect(pending).toContain(1)
		expect(resolver.pending).toBe(0)

		recover()
		store.setCell("row_2", "product", "Kupa")
		await resolver.settled()

		expect(resolves).toHaveLength(2)
		expect(store.get("row_2", "product")).toEqual({ id: 4, label: "Kupa" })
		expect(resolver.failure).toBeNull()
	})

	it("searches the records for the editor's list, and asks once for the same query", async () => {
		const { resolver, searches } = setup()

		await expect(resolver.search("product", "term", undefined, 1)).resolves.toEqual({
			items: [{ id: 1, label: "Çelik Termos", description: "TRM-500" }],
			more: true
		})
		await resolver.search("product", "term", undefined, 1)

		expect(searches).toEqual([{ lookup: "product", field: "product", query: "term", limit: 1 }])

		const controller = new AbortController()
		const searching = resolver.search("product", "kupa", controller.signal)

		controller.abort()

		await expect(searching).rejects.toMatchObject({ name: "AbortError" })
		await expect(resolver.search("quantity", "1")).rejects.toBeInstanceOf(TabulaError)
	})
})
