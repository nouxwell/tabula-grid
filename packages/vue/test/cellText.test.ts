import { ModuleSchema } from "@nouxwell/tabula-core"
import { describe, expect, it } from "vitest"
import { alignmentOf, cellText } from "../src/cellText"

const schema = ModuleSchema.from({
	module: "test",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string" },
		{ key: "price", type: "money" },
		{ key: "active", type: "bool" },
		{ key: "date", type: "date" },
		{
			key: "currency",
			type: "options",
			multiple: true,
			options: [
				{ value: "TRY", label: "Türk lirası" },
				{ value: 2, label: "İki" }
			]
		},
		{ key: "product", type: "lookup", lookup: "product" }
	]
})

describe("cellText", () => {
	it("shows an empty cell as nothing", () => {
		expect(cellText(schema.field("name"), null)).toBe("")
	})

	it("shows an option's label, not its value, and a value it does not know as it is", () => {
		expect(cellText(schema.field("currency"), "TRY")).toBe("Türk lirası")
		expect(cellText(schema.field("currency"), "2")).toBe("İki")
		expect(cellText(schema.field("currency"), ["TRY", 2])).toBe("Türk lirası, İki")
		expect(cellText(schema.field("currency"), "EUR")).toBe("EUR")
	})

	it("shows a lookup's label rather than its id", () => {
		expect(cellText(schema.field("product"), { id: 1842, label: "Çelik Termos" })).toBe("Çelik Termos")
		expect(cellText(schema.field("product"), { id: 1842 })).toBe("#1842")
		expect(cellText(schema.field("product"), "Çelik")).toBe("Çelik")
	})

	it("shows numbers and yes or no plainly until values are formatted", () => {
		expect(cellText(schema.field("price"), 1249.5)).toBe("1249.5")
		expect(cellText(schema.field("active"), true)).toBe("✓")
		expect(cellText(schema.field("active"), false)).toBe("✗")
	})
})

describe("alignmentOf", () => {
	it("puts numbers right, yes or no and dates in the middle, the rest left", () => {
		expect(alignmentOf(schema.field("price"))).toBe("right")
		expect(alignmentOf(schema.field("active"))).toBe("center")
		expect(alignmentOf(schema.field("date"))).toBe("center")
		expect(alignmentOf(schema.field("name"))).toBe("left")
		expect(alignmentOf(schema.field("product"))).toBe("left")
	})
})
