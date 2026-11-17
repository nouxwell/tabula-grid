import { describe, expect, it } from "vitest"
import { RowStore, TabulaError, UndoHistory, type RowEntry, type RowId, type StoreChange } from "../src/index"

function sequentialIds(): () => RowId {
	let next = 0

	return () => `row_${++next}`
}

/** A store of `count` rows with ids row_1, row_2, … and names "Ürün 1", "Ürün 2", … */
function storeOf(count: number): RowStore {
	return new RowStore({
		createRowId: sequentialIds(),
		rows: Array.from({ length: count }, (_, index) => ({ values: { name: `Ürün ${index + 1}` } }))
	})
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

function lastChange(store: RowStore, fn: () => void): StoreChange {
	let change: StoreChange | null = null
	const stop = store.subscribe(next => (change = next))

	fn()
	stop()

	if (change === null) {
		throw new Error("The store did not change.")
	}

	return change
}

describe("RowStore.revert and replay", () => {
	it("takes a change back as a change of its own, and makes it again", () => {
		const store = storeOf(2)
		const before = store.snapshot()
		const change = lastChange(store, () =>
			store.transact(
				() => {
					store.setCell("row_1", "name", "Termos")
					store.setCell("row_2", "price", "12.50")
				},
				{ origin: "paste" }
			)
		)
		const after = store.snapshot()

		const undone = store.revert(change, { origin: "undo" })

		expect(store.snapshot()).toEqual(before)
		expect(undone).toMatchObject({ revision: 2, origin: "undo" })
		// Last first, each the other way round.
		expect(undone?.operations).toEqual([
			{ kind: "set", rowId: "row_2", field: "price", before: "12.50", after: null },
			{ kind: "set", rowId: "row_1", field: "name", before: "Termos", after: "Ürün 1" }
		])

		store.replay(change)

		expect(store.snapshot()).toEqual(after)
		expect(store.revision).toBe(3)
	})

	it("takes inserted rows out again, and puts them back under the same ids", () => {
		const store = storeOf(3)
		const change = lastChange(store, () =>
			store.insertRows(1, [{ rowId: "new_1" }, { rowId: "new_2", values: { name: "Yeni" } }])
		)

		store.revert(change)
		expect(store.rowIds()).toEqual(["row_1", "row_2", "row_3"])

		store.replay(change)
		expect(store.rowIds()).toEqual(["row_1", "new_1", "new_2", "row_2", "row_3"])
		expect(store.get("new_2", "name")).toBe("Yeni")
	})

	it("puts removed rows back exactly where each stood, however scattered", () => {
		const store = storeOf(10)
		const before = store.snapshot()
		const change = lastChange(store, () => store.removeRows(["row_8", "row_2", "row_4", "row_5", "row_10"]))

		const undone = store.revert(change)

		expect(store.snapshot()).toEqual(before)
		// One insert per run of rows that stood together, in order: replaying them gives the same sheet.
		expect(
			undone?.operations.map(operation =>
				operation.kind === "insert"
					? `${operation.index}:${operation.rows.map(row => row.rowId).join(",")}`
					: ""
			)
		).toEqual(["1:row_2", "3:row_4,row_5", "7:row_8", "9:row_10"])

		const replayed = storeOf(10)

		replayed.removeRows(["row_8", "row_2", "row_4", "row_5", "row_10"])
		replayed.replay(undone as StoreChange)
		expect(replayed.rowIds()).toEqual(before.map(row => row.rowId))
	})

	it("refuses a change the sheet has moved on from, and writes nothing", () => {
		const store = storeOf(3)
		const edit = lastChange(store, () => store.setCell("row_1", "name", "Termos"))
		const removal = lastChange(store, () => store.removeRows(["row_3"]))

		store.setCell("row_1", "name", "Kupa")
		const revision = store.revision

		expect(codeOf(() => store.revert(edit))).toBe("conflict")
		expect(codeOf(() => store.replay(removal))).toBe("conflict")
		expect(codeOf(() => store.replay(edit))).toBe("conflict")
		expect(store.get("row_1", "name")).toBe("Kupa")
		expect(store.revision).toBe(revision)
	})

	it("takes back nothing of a change when one part of it no longer fits", () => {
		const store = storeOf(3)
		const change = lastChange(store, () =>
			store.setCells([
				{ rowId: "row_1", field: "name", value: "A" },
				{ rowId: "row_2", field: "name", value: "B" }
			])
		)

		store.setCell("row_1", "name", "Başka")

		expect(codeOf(() => store.revert(change))).toBe("conflict")
		expect(store.get("row_2", "name")).toBe("B")
	})

	it("will not run inside a transaction, where it would not be a change of its own", () => {
		const store = storeOf(1)
		const change = lastChange(store, () => store.setCell("row_1", "name", "Termos"))

		expect(codeOf(() => store.transact(() => store.revert(change)))).toBe("invalid_argument")
		expect(store.get("row_1", "name")).toBe("Termos")
	})

	it("puts back half of 50,000 rows in one pass", () => {
		const store = new RowStore({ rows: Array.from({ length: 50_000 }, (_, index) => ({ values: { n: index } })) })
		const before = store.rowIds()
		const change = lastChange(store, () => store.removeRows(before.filter((_, index) => index % 2 === 0)))

		// One row at a time would be 25,000 passes over the sheet: minutes, not milliseconds.
		const started = Date.now()
		store.revert(change)
		const took = Date.now() - started

		expect(store.rowIds()).toEqual(before)
		expect(took).toBeLessThan(1000)
	})
})

describe("UndoHistory", () => {
	it("takes steps back last first, and makes them again", () => {
		const store = storeOf(2)
		const history = new UndoHistory(store)

		store.setCell("row_1", "name", "A")
		store.setCell("row_1", "name", "B")

		expect(history.undo()).toMatchObject({ origin: "undo" })
		expect(store.get("row_1", "name")).toBe("A")
		history.undo()
		expect(store.get("row_1", "name")).toBe("Ürün 1")
		expect(history.canUndo).toBe(false)
		expect(history.undo()).toBeNull()

		expect(history.redo()).toMatchObject({ origin: "redo" })
		history.redo()
		expect(store.get("row_1", "name")).toBe("B")
		expect(history.canRedo).toBe(false)
		expect(history.redo()).toBeNull()
	})

	it("takes a paste back in one step, the rows it added included", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store)

		store.transact(
			() => {
				const added = store.appendRows(2)

				for (const rowId of [...added, "row_1"]) {
					store.setCell(rowId, "name", "Termos")
				}
			},
			{ origin: "paste" }
		)

		const added = store.rowIds().slice(1)

		expect(history.nextUndo?.origin).toBe("paste")
		history.undo()
		expect(store.snapshot()).toEqual([{ rowId: "row_1", values: { name: "Ürün 1" } }])

		history.redo()
		expect(store.rowIds().slice(1)).toEqual(added)
		expect(store.snapshot().map(row => row.values.name)).toEqual(["Termos", "Termos", "Termos"])
	})

	it("forgets what was undone once something new is written", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store)

		store.setCell("row_1", "name", "A")
		history.undo()
		store.setCell("row_1", "name", "C")

		expect(history.canRedo).toBe(false)
		history.undo()
		expect(store.get("row_1", "name")).toBe("Ürün 1")
	})

	it("keeps as many steps as its limit and forgets the oldest", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store, { limit: 3 })

		for (const name of ["A", "B", "C", "D", "E"]) {
			store.setCell("row_1", "name", name)
		}

		while (history.undo() !== null) {
			// all the way back
		}

		expect(store.get("row_1", "name")).toBe("B")
		expect(codeOf(() => new UndoHistory(store, { limit: 0 }))).toBe("invalid_argument")
	})

	it("tells its listeners and moves its version on every step", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store)
		const seen: string[] = []

		history.subscribe(() => seen.push(`${history.canUndo ? "U" : "-"}${history.canRedo ? "R" : "-"}`))
		store.setCell("row_1", "name", "A")
		history.undo()
		history.redo()
		history.clear()

		expect(seen).toEqual(["U-", "-R", "U-", "--"])
		expect(history.version).toBe(4)
	})

	it("keeps the order straight when a listener writes in answer to an undo or a redo", () => {
		const store = storeOf(2)
		const history = new UndoHistory(store)

		// A host that fills a second cell whenever the first changes, as a lookup filling a price might.
		store.subscribe(change => {
			if (change.operations.some(op => op.kind === "set" && op.field === "name" && op.rowId === "row_1")) {
				store.setCell("row_2", "name", `${store.get("row_1", "name") as string} (kopya)`)
			}
		})

		store.setCell("row_1", "name", "A")
		expect(store.get("row_2", "name")).toBe("A (kopya)")

		// The copy is the last step, then the edit.
		history.undo()
		expect(store.get("row_2", "name")).toBe("Ürün 2")
		history.undo()
		expect(store.get("row_1", "name")).toBe("Ürün 1")
		// The listener answered the undo with a new copy: a new change, after which nothing is redone.
		expect(store.get("row_2", "name")).toBe("Ürün 1 (kopya)")
		expect(history.canRedo).toBe(false)

		history.undo()
		expect(store.get("row_2", "name")).toBe("Ürün 2")
	})

	it("puts a redo before whatever a listener wrote in answer to it", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store)
		let answering = false

		store.setCell("row_1", "name", "A")
		history.undo()

		store.subscribe(change => {
			if (change.origin === "redo" && !answering) {
				answering = true
				store.setCell("row_1", "note", "yinelendi")
			}
		})

		history.redo()
		expect(store.values("row_1")).toEqual({ name: "A", note: "yinelendi" })

		history.undo()
		expect(store.values("row_1")).toEqual({ name: "A" })
		history.undo()
		expect(store.values("row_1")).toEqual({ name: "Ürün 1" })
	})

	it("clears itself when the sheet no longer matches it, and writes nothing", () => {
		// A store the sheet has drifted away from, as one changed while no history listened would be.
		class DriftedStore extends RowStore {
			override revert(): StoreChange | null {
				throw new TabulaError("conflict", "The sheet has moved on.")
			}
		}

		const store = new DriftedStore({ createRowId: sequentialIds(), rows: [{}] })
		const history = new UndoHistory(store)
		let notices = 0

		store.setCell("row_1", "name", "A")
		store.setCell("row_1", "name", "B")
		history.subscribe(() => notices++)

		expect(codeOf(() => history.undo())).toBe("conflict")
		expect(history.canUndo).toBe(false)
		expect(history.canRedo).toBe(false)
		expect(notices).toBe(1)
		expect(store.get("row_1", "name")).toBe("B")
	})

	it("stops following the store once disposed", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store)

		history.dispose()
		store.setCell("row_1", "name", "A")

		expect(history.canUndo).toBe(false)
	})

	it("keeps a step it could not take when the store refused for another reason", () => {
		const store = storeOf(1)
		const history = new UndoHistory(store)

		store.setCell("row_1", "name", "A")

		expect(codeOf(() => store.transact(() => history.undo()))).toBe("invalid_argument")
		expect(history.canUndo).toBe(true)
		expect(history.undo()).not.toBeNull()
	})

	it("undoes a paste over 50,000 rows in one go", () => {
		const store = new RowStore({ rows: Array.from({ length: 50_000 }, () => ({ values: { name: "x" } })) })
		const history = new UndoHistory(store)
		const before: RowEntry[] = store.snapshot()

		store.setCells(store.rowIds().map(rowId => ({ rowId, field: "name", value: "y" })))
		history.undo()

		expect(store.snapshot()).toEqual(before)
	})
})
