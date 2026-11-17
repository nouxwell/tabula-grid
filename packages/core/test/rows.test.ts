import { afterEach, describe, expect, it, vi } from "vitest"
import { RowStore, TabulaError, type RowId, type StoreChange } from "../src/index"

/** Ids that can be written into an expectation: row_1, row_2, … */
function sequentialIds(): () => RowId {
	let next = 0

	return () => `row_${++next}`
}

/** A store of `count` rows named "Ürün 1", "Ürün 2", …, with ids row_1, row_2, … */
function storeOf(count: number): RowStore {
	return new RowStore({
		createRowId: sequentialIds(),
		rows: Array.from({ length: count }, (_, index) => ({ values: { name: `Ürün ${index + 1}` } }))
	})
}

/** Every change the store announces from now on. */
function recordChanges(store: RowStore): StoreChange[] {
	const changes: StoreChange[] = []
	store.subscribe(change => changes.push(change))

	return changes
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

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("RowStore", () => {
	describe("row ids", () => {
		it("keeps the ids it is given and makes the missing ones", () => {
			const store = new RowStore({ createRowId: sequentialIds(), rows: [{ rowId: "a" }, {}, { rowId: "b" }] })

			expect(store.rowIds()).toEqual(["a", "row_1", "b"])
		})

		it("makes ids that differ within a store and between stores", () => {
			const first = new RowStore({ rows: [{}, {}] }).rowIds()
			const second = new RowStore({ rows: [{}, {}] }).rowIds()

			expect(new Set([...first, ...second]).size).toBe(4)
			expect(first[0]).toMatch(/^r_[0-9a-z]{7}_1$/)
		})

		it("refuses an id that is already in the sheet, and changes nothing", () => {
			const store = storeOf(2)

			expect(codeOf(() => new RowStore({ rows: [{ rowId: "a" }, { rowId: "a" }] }))).toBe("duplicate_row")
			expect(codeOf(() => store.insertRows(0, [{ rowId: "x" }, { rowId: "row_1" }]))).toBe("duplicate_row")
			expect(store.rowIds()).toEqual(["row_1", "row_2"])
			expect(store.revision).toBe(0)
		})

		it("keeps its ids while rows are inserted and removed around them", () => {
			const store = storeOf(3)

			store.insertRows(0, 1)
			store.removeRows(["row_2"])

			expect(store.rowIds()).toEqual(["row_4", "row_1", "row_3"])
			expect(store.indexOf("row_3")).toBe(2)
			expect(store.indexOf("row_2")).toBe(-1)
			expect(store.get("row_3", "name")).toBe("Ürün 3")
		})
	})

	describe("cells", () => {
		it("counts a revision for each change and says what changed", () => {
			const store = storeOf(2)
			const changes = recordChanges(store)

			store.setCell("row_1", "price", "129.90")

			expect(store.revision).toBe(1)
			expect(store.get("row_1", "price")).toBe("129.90")
			expect(changes).toEqual([
				{
					revision: 1,
					origin: null,
					operations: [{ kind: "set", rowId: "row_1", field: "price", before: null, after: "129.90" }]
				}
			])
		})

		it("does not count a write that changes nothing", () => {
			const store = storeOf(1)
			store.setCell("row_1", "tags", ["a", "b"])
			const changes = recordChanges(store)

			store.setCell("row_1", "tags", ["a", "b"])
			store.setCell("row_1", "name", "Ürün 1")
			store.setCell("row_1", "missing", null)

			expect(store.revision).toBe(1)
			expect(changes).toEqual([])
		})

		it("keeps an empty cell out of the row altogether", () => {
			const store = storeOf(1)

			store.setCell("row_1", "name", null)

			expect(store.get("row_1", "name")).toBeNull()
			expect(store.values("row_1")).toEqual({})
			expect(store.snapshot()).toEqual([{ rowId: "row_1", values: {} }])
		})

		it("keeps its own copy of every value", () => {
			const store = storeOf(1)
			const tags = ["mutfak"]

			store.setCell("row_1", "tags", tags)
			tags.push("banyo")

			expect(store.get("row_1", "tags")).toEqual(["mutfak"])
			expect(Object.isFrozen(store.get("row_1", "tags"))).toBe(true)
			expect(Object.isFrozen(store.values("row_1"))).toBe(true)
		})

		it("refuses a value JSON cannot carry, and says where it was going", () => {
			const store = storeOf(1)

			expect(() => store.setCell("row_1", "price", Number.NaN as never)).toThrowError(
				new TabulaError(
					"invalid_value",
					'The value of "price" in row "row_1" must be null, a boolean, a finite number, a string, or an array or plain object of these; got NaN.'
				)
			)
			expect(codeOf(() => store.setCell("row_1", "date", new Date() as never))).toBe("invalid_value")
			expect(store.revision).toBe(0)
		})

		it("refuses a row that does not exist and a field with no name", () => {
			const store = storeOf(1)

			expect(() => store.setCell("row_9", "price", 1)).toThrowError(
				new TabulaError("unknown_row", 'There is no row "row_9" in this sheet.')
			)
			expect(() => store.get("row_9", "price")).toThrow(TabulaError)
			expect(codeOf(() => store.setCell("row_1", "", 1))).toBe("invalid_argument")
		})
	})

	describe("transactions", () => {
		it("makes every write inside one change", () => {
			const store = storeOf(2)
			const changes = recordChanges(store)

			const change = store.transact(
				() => {
					store.setCell("row_1", "price", "10")
					store.setCell("row_2", "price", "20")
					store.appendRows([{ values: { name: "Ürün 3" } }])
				},
				{ origin: "paste" }
			)

			expect(store.revision).toBe(1)
			expect(changes).toEqual([change])
			expect(change?.origin).toBe("paste")
			expect(change?.operations.map(operation => operation.kind)).toEqual(["set", "set", "insert"])
		})

		it("joins a transaction started inside another", () => {
			const store = storeOf(1)
			let inner: StoreChange | null | undefined

			const outer = store.transact(() => {
				store.setCell("row_1", "a", 1)
				inner = store.transact(() => store.setCell("row_1", "b", 2))
			})

			expect(inner).toBeNull()
			expect(outer?.operations).toHaveLength(2)
			expect(store.revision).toBe(1)
		})

		it("takes back everything a failed transaction wrote", () => {
			const store = storeOf(5)
			store.setCell("row_2", "price", "5")
			const before = store.snapshot()
			const changes = recordChanges(store)

			expect(() =>
				store.transact(() => {
					store.setCell("row_1", "name", "Değişti")
					store.setCell("row_2", "price", null)
					store.insertRows(2, [{ rowId: "new", values: { name: "Yeni" } }])
					store.setCell("new", "name", "Yeni, değişti")
					store.removeRows(["row_1", "new", "row_4"])
					store.setCell("row_5", "price", "9")
					throw new Error("stop")
				})
			).toThrow("stop")

			expect(store.snapshot()).toEqual(before)
			expect(store.indexOf("row_4")).toBe(3)
			expect(store.has("new")).toBe(false)
			expect(store.revision).toBe(1)
			expect(changes).toEqual([])
		})

		it("writes many cells as one change", () => {
			const store = storeOf(2)

			const change = store.setCells(
				[
					{ rowId: "row_1", field: "price", value: "1" },
					{ rowId: "row_2", field: "price", value: "2" }
				],
				{ origin: "fill" }
			)

			expect(change?.operations).toHaveLength(2)
			expect(change?.origin).toBe("fill")
			expect(store.revision).toBe(1)
		})

		it("puts what a deriver writes in the same change, and takes everything back when it throws", () => {
			const store = storeOf(2)
			const changes = recordChanges(store)
			const stop = store.derive(operations => {
				if (operations.some(op => op.kind === "set" && op.field === "name")) {
					store.setCell("row_1", "copy", store.get("row_1", "name"))
				}
			})

			store.setCell("row_1", "name", "Termos")

			expect(store.get("row_1", "copy")).toBe("Termos")
			expect(changes).toHaveLength(1)
			expect(changes[0]?.operations.map(op => (op.kind === "set" ? op.field : op.kind))).toEqual(["name", "copy"])

			stop()
			store.derive(() => {
				throw new Error("refused")
			})

			expect(() => store.setCell("row_2", "name", "Kupa")).toThrow("refused")
			expect(store.get("row_2", "name")).toBe("Ürün 2")
			expect(changes).toHaveLength(1)
		})

		it("returns nothing and counts nothing for a transaction that changed nothing", () => {
			const store = storeOf(1)

			expect(store.transact(() => store.setCell("row_1", "name", "Ürün 1"))).toBeNull()
			expect(store.revision).toBe(0)
		})
	})

	describe("inserting and removing", () => {
		it("inserts rows where it is told to", () => {
			const store = storeOf(2)

			expect(store.insertRows(1, 2)).toEqual(["row_3", "row_4"])
			expect(store.appendRows([{ rowId: "last" }])).toEqual(["last"])
			expect(store.rowIds()).toEqual(["row_1", "row_3", "row_4", "row_2", "last"])
			expect(store.rowIdAt(3)).toBe("row_2")
		})

		it("refuses a place that is not in the sheet", () => {
			const store = storeOf(2)

			expect(codeOf(() => store.insertRows(-1, 1))).toBe("invalid_argument")
			expect(codeOf(() => store.insertRows(3, 1))).toBe("invalid_argument")
			expect(codeOf(() => store.insertRows(0.5, 1))).toBe("invalid_argument")
			expect(codeOf(() => store.insertRows(0, -1))).toBe("invalid_argument")
		})

		it("removes rows wherever they stand, and records where that was", () => {
			const store = storeOf(5)
			const changes = recordChanges(store)

			store.removeRows(["row_4", "row_2"])

			expect(store.rowIds()).toEqual(["row_1", "row_3", "row_5"])
			expect(changes[0]?.operations).toEqual([
				{
					kind: "remove",
					rows: [
						{ index: 1, rowId: "row_2", values: { name: "Ürün 2" } },
						{ index: 3, rowId: "row_4", values: { name: "Ürün 4" } }
					]
				}
			])
		})

		it("removes nothing when one of the rows does not exist", () => {
			const store = storeOf(3)

			expect(codeOf(() => store.removeRows(["row_1", "row_9"]))).toBe("unknown_row")
			expect(store.size).toBe(3)
			expect(store.revision).toBe(0)
		})

		it("handles sheets of tens of thousands of rows in one pass", () => {
			const store = new RowStore({ createRowId: sequentialIds() })

			store.appendRows(Array.from({ length: 50_000 }, (_, index) => ({ values: { n: index } })))
			const doomed = store.rowIds().filter((_, index) => index % 2 === 1)
			store.removeRows(doomed)

			expect(store.size).toBe(25_000)
			expect(store.get(store.rowIdAt(24_999) ?? "", "n")).toBe(49_998)

			expect(() =>
				store.transact(() => {
					store.removeRows(store.rowIds().filter((_, index) => index % 3 === 0))
					throw new Error("stop")
				})
			).toThrow("stop")

			expect(store.size).toBe(25_000)
			expect(store.get(store.rowIdAt(1) ?? "", "n")).toBe(2)
		})
	})

	describe("snapshots", () => {
		it("writes out rows that load back into the same sheet", () => {
			const store = storeOf(3)
			store.setCell("row_2", "product", { id: 1842, label: "Çelik Termos" })
			store.setCell("row_3", "tags", ["a"])

			const copy = new RowStore({ rows: JSON.parse(JSON.stringify(store.snapshot())) })

			expect(copy.snapshot()).toEqual(store.snapshot())
			expect(copy.revision).toBe(0)
		})
	})

	describe("listeners", () => {
		it("reports a listener that throws and still tells the others", () => {
			const reported: unknown[] = []
			vi.stubGlobal("reportError", (error: unknown) => reported.push(error))
			const store = storeOf(1)
			const seen: number[] = []

			store.subscribe(() => {
				throw new Error("listener broke")
			})
			store.subscribe(change => seen.push(change.revision))
			store.setCell("row_1", "price", "1")

			expect(seen).toEqual([1])
			expect(reported).toEqual([new Error("listener broke")])
			expect(store.get("row_1", "price")).toBe("1")
		})

		it("stops telling a listener once it unsubscribes", () => {
			const store = storeOf(1)
			const seen: number[] = []
			const stop = store.subscribe(change => seen.push(change.revision))

			store.setCell("row_1", "price", "1")
			stop()
			store.setCell("row_1", "price", "2")

			expect(seen).toEqual([1])
		})
	})
})
