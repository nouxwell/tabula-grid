import { describe, expect, it } from "vitest"
import {
	arrangeColumns,
	autoColumnWidth,
	clampColumnWidth,
	DEFAULT_COLUMN_SIZING,
	headerDisplayText,
	resolveColumnSizing,
	TabulaError,
	withColumn
} from "../src/index"

describe("column sizing", () => {
	it("starts from 100 to 320 pixels for automatic widths and 100 characters of header", () => {
		expect(DEFAULT_COLUMN_SIZING).toEqual({
			minWidth: 100,
			maxAutoWidth: 320,
			maxWidth: 1000,
			headerDisplayMaxLength: 100,
			resizable: true
		})
	})

	it("lays the module's settings and then the column's own over the defaults", () => {
		const sizing = resolveColumnSizing({ maxAutoWidth: 400, resizable: false }, { minWidth: 60 }, undefined)

		expect(sizing).toEqual({
			minWidth: 60,
			maxAutoWidth: 400,
			maxWidth: 1000,
			headerDisplayMaxLength: 100,
			resizable: false
		})
		expect(Object.isFrozen(sizing)).toBe(true)
	})

	it("refuses limits that cannot all hold", () => {
		expect(() => resolveColumnSizing({ minWidth: 400 })).toThrowError(
			new TabulaError("invalid_argument", "Column sizing minWidth 400 is above maxAutoWidth 320.")
		)
		expect(() => resolveColumnSizing({ maxWidth: 50 })).toThrow(/minWidth 100 is above maxWidth 50/)
		expect(() => resolveColumnSizing({ headerDisplayMaxLength: 0 })).toThrow(TabulaError)
		expect(() => resolveColumnSizing({ minWidth: Number.NaN })).toThrow(TabulaError)
	})

	it("sizes a column from its content between the minimum and the automatic maximum", () => {
		const sizing = resolveColumnSizing()

		expect(autoColumnWidth(42, sizing)).toBe(100)
		expect(autoColumnWidth(180.2, sizing)).toBe(181)
		expect(autoColumnWidth(900, sizing)).toBe(320)
		expect(autoColumnWidth(900, resolveColumnSizing({ maxAutoWidth: 600, maxWidth: 500 }))).toBe(500)
	})

	it("lets the user go past the automatic maximum, up to maxWidth", () => {
		const sizing = resolveColumnSizing()

		expect(clampColumnWidth(640, sizing)).toBe(640)
		expect(clampColumnWidth(5000, sizing)).toBe(1000)
		expect(clampColumnWidth(20, sizing)).toBe(100)
	})
})

describe("headerDisplayText", () => {
	it("keeps a header within the limit whole", () => {
		expect(headerDisplayText("Yeni fiyat", 100)).toBe("Yeni fiyat")
		expect(headerDisplayText("x".repeat(100), 100)).toBe("x".repeat(100))
	})

	it("cuts a longer one and ends it with an ellipsis", () => {
		expect(headerDisplayText("x".repeat(101), 100)).toBe(`${"x".repeat(100)}…`)
		expect(headerDisplayText("Geçerlilik başlangıç tarihi", 10)).toBe("Geçerlilik…")
	})

	it("counts characters, so a cut never splits one", () => {
		expect(headerDisplayText("📦📦📦", 2)).toBe("📦📦…")
	})
})

describe("column layout", () => {
	const fields = ["product", "sku", "price", "change", "note"].map(key => ({ key }))
	const keys = (layout: Parameters<typeof arrangeColumns>[1]) => {
		const arranged = arrangeColumns(fields, layout)

		return `${arranged.fields.map(field => field.key).join(",")} | ${arranged.pinned}`
	}

	it("shows every column in the schema's order when there is no layout", () => {
		expect(keys({})).toBe("product,sku,price,change,note | 0")
	})

	it("hides, orders and pins, the pinned columns first", () => {
		expect(keys({ hidden: ["sku"] })).toBe("product,price,change,note | 0")
		expect(keys({ order: ["note", "price"] })).toBe("note,price,product,sku,change | 0")
		expect(keys({ pinned: ["price", "product"] })).toBe("product,price,sku,change,note | 2")
		expect(keys({ order: ["price"], pinned: ["product", "price"], hidden: ["price"] })).toBe(
			"product,sku,change,note | 1"
		)
	})

	it("passes over keys the schema does not have, as a layout saved before a column went", () => {
		expect(keys({ order: ["gone", "note"], hidden: ["gone"], pinned: ["gone"] })).toBe(
			"note,product,sku,price,change | 0"
		)
	})

	it("hides and shows, pins and lets go of, one column at a time", () => {
		const hidden = withColumn({}, "sku", { hidden: true })
		const pinned = withColumn(hidden, "note", { pinned: true })

		expect(pinned).toEqual({ hidden: ["sku"], pinned: ["note"] })
		expect(withColumn(pinned, "sku", { hidden: false })).toEqual({ hidden: [], pinned: ["note"] })
		expect(withColumn(pinned, "note", { pinned: false })).toEqual({ hidden: ["sku"], pinned: [] })
		expect(keys(pinned)).toBe("note,product,price,change | 1")
	})
})
