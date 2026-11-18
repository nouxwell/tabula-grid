import { describe, expect, it } from "vitest"
import {
	addView,
	emptyViews,
	ModuleSchema,
	PLAIN_VIEW,
	readViews,
	removeView,
	renameView,
	sameView,
	setDefaultView,
	TabulaError,
	updateView,
	viewFor,
	viewNameProblem,
	type ViewState
} from "../src/index"

const schema = ModuleSchema.from({
	module: "prices",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string" },
		{ key: "price", type: "money", decimals: 2 },
		{ key: "day", type: "date" },
		{ key: "note", type: "string" }
	]
})

const weekly: ViewState = {
	columns: { order: ["price", "name"], hidden: ["note"], pinned: ["price"] },
	columnWidths: { price: 140 },
	filters: { price: { kind: "range", from: "100", to: null } },
	sort: { key: "day", direction: "desc" }
}

function withWeekly() {
	return addView(emptyViews("prices"), { id: "v1", name: "Haftalık", ...weekly })
}

describe("saved views", () => {
	it("adds, updates, renames and removes views, keeping each id", () => {
		let views = withWeekly()

		expect(views.views.map(view => [view.id, view.name])).toEqual([["v1", "Haftalık"]])
		expect(views.views[0]?.sort).toEqual({ key: "day", direction: "desc" })

		views = updateView(views, "v1", PLAIN_VIEW)
		expect(views.views[0]).toMatchObject({ id: "v1", name: "Haftalık", filters: {}, sort: null })

		views = renameView(views, "v1", "  Aylık  ")
		expect(views.views[0]?.name).toBe("Aylık")

		views = removeView(views, "v1")
		expect(views.views).toEqual([])
	})

	it("returns new documents and leaves the old ones as they were", () => {
		const before = withWeekly()
		const after = renameView(before, "v1", "Aylık")

		expect(before.views[0]?.name).toBe("Haftalık")
		expect(after.views[0]?.name).toBe("Aylık")
		expect(Object.isFrozen(after.views[0]?.columns)).toBe(true)
	})

	it("refuses an empty name, a long one and one another view has, in any case", () => {
		const views = withWeekly()

		expect(viewNameProblem(views, "   ")).toBe("empty")
		expect(viewNameProblem(views, "x".repeat(61))).toBe("too_long")
		expect(viewNameProblem(views, "haftalık")).toBe("taken")
		// A view keeps its own name when renamed to it.
		expect(viewNameProblem(views, "Haftalık", "v1")).toBeNull()
		expect(() => addView(views, { id: "v2", name: "HAFTALIK", ...PLAIN_VIEW })).toThrow(TabulaError)
		expect(() => addView(views, { id: "v1", name: "Başka", ...PLAIN_VIEW })).toThrow(TabulaError)
	})

	it("opens in the default view until that view is removed", () => {
		let views = setDefaultView(withWeekly(), "v1")

		expect(views.defaultId).toBe("v1")

		views = removeView(views, "v1")
		expect(views.defaultId).toBeNull()
		expect(() => setDefaultView(views, "v9")).toThrow(TabulaError)
	})

	it("applies a view to the schema as it is now, passing over columns it no longer has", () => {
		const old: ViewState = {
			columns: { order: ["gone", "price"], hidden: ["gone"] },
			columnWidths: { gone: 90, price: 120 },
			filters: { gone: { kind: "values", keys: ["x"] }, name: { kind: "range", from: "1", to: "2" } },
			sort: { key: "gone", direction: "asc" }
		}

		expect(viewFor(old, schema)).toEqual({
			columns: { order: ["price"], hidden: [] },
			columnWidths: { price: 120 },
			// A range on a column of text cannot be kept.
			filters: {},
			sort: null
		})
	})

	it("tells views apart by what they show, not by how they are written", () => {
		const written: ViewState = {
			columns: { order: ["name", "price", "day", "note"] },
			columnWidths: {},
			filters: { name: { kind: "values", keys: ["text:b", "text:a"] } },
			sort: null
		}
		const left: ViewState = { ...PLAIN_VIEW, filters: { name: { kind: "values", keys: ["text:a", "text:b"] } } }

		expect(sameView(schema, written, left)).toBe(true)
		expect(sameView(schema, PLAIN_VIEW, { ...PLAIN_VIEW, columnWidths: { price: 130 } })).toBe(false)
		expect(sameView(schema, PLAIN_VIEW, { ...PLAIN_VIEW, sort: { key: "name", direction: "asc" } })).toBe(false)
		expect(sameView(schema, weekly, { ...weekly, columns: { ...weekly.columns, pinned: [] } })).toBe(false)
	})

	it("reads back what it wrote, through JSON", () => {
		const views = setDefaultView(withWeekly(), "v1")

		expect(readViews(JSON.parse(JSON.stringify(views)), "prices")).toEqual(views)
	})

	it("refuses views of another module or format, with every problem at once", () => {
		const views = JSON.parse(JSON.stringify(withWeekly()))

		expect(() => readViews(views, "stock")).toThrow(/module/)

		try {
			readViews(
				{
					...views,
					format: "other",
					views: [{ id: "v1", name: "", sort: { key: "day", direction: "up" } }],
					defaultId: "v9"
				},
				"prices"
			)
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(TabulaError)
			expect((error as TabulaError).code).toBe("invalid_views")
			expect((error as TabulaError).message).toContain("format")
			expect((error as TabulaError).message).toContain("views[0].name")
			expect((error as TabulaError).message).toContain("views[0].sort")
			expect((error as TabulaError).message).toContain("defaultId")
		}
	})
})
