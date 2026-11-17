import { ModuleSchema } from "@nouxwell/tabula-core"
import { describe, expect, it } from "vitest"
import { alignmentOf } from "../src/alignment"

const schema = ModuleSchema.from({
	module: "test",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string" },
		{ key: "price", type: "money" },
		{ key: "share", type: "percent" },
		{ key: "active", type: "bool" },
		{ key: "date", type: "date" },
		{ key: "product", type: "lookup", lookup: "product" }
	]
})

describe("alignmentOf", () => {
	it("puts numbers right, yes or no and dates in the middle, the rest left", () => {
		expect(alignmentOf(schema.field("price"))).toBe("right")
		expect(alignmentOf(schema.field("share"))).toBe("right")
		expect(alignmentOf(schema.field("active"))).toBe("center")
		expect(alignmentOf(schema.field("date"))).toBe("center")
		expect(alignmentOf(schema.field("name"))).toBe("left")
		expect(alignmentOf(schema.field("product"))).toBe("left")
	})
})
