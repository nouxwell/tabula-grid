import { describe, expect, it } from "vitest"
import { adjustValue, isAdjustable, ModuleSchema, VALUE_SETTINGS } from "../src/index"

const schema = ModuleSchema.from({
	module: "adjust",
	schemaVersion: 1,
	fields: [
		{ key: "price", type: "money", decimals: 2 },
		{ key: "count", type: "integer" },
		{ key: "name", type: "string" }
	]
})

const price = schema.field("price")
const count = schema.field("count")

describe("adjustValue", () => {
	it("raises and lowers by a percentage exactly, to the field's digits", () => {
		expect(adjustValue(price, "1496.66", { kind: "percent", by: "5" })).toBe("1571.49")
		expect(adjustValue(price, "100", { kind: "percent", by: "-10" })).toBe("90")
		// 0.1 + 0.2 stays 0.3: no float in between.
		expect(adjustValue(price, "0.1", { kind: "add", by: "0.2" })).toBe("0.3")
		expect(adjustValue(count, "7", { kind: "percent", by: "50" })).toBe("11")
	})

	it("rounds to a step: the nearest, the one above or the one below", () => {
		expect(adjustValue(price, "1533.83", { kind: "round", step: "0.05" })).toBe("1533.85")
		expect(adjustValue(price, "1533.12", { kind: "round", step: "1", mode: "up" })).toBe("1534")
		expect(adjustValue(price, "1538", { kind: "round", step: "10", mode: "down" })).toBe("1530")
		expect(adjustValue(price, "1535", { kind: "round", step: "10" })).toBe("1540")
	})

	it("reads a number written the sheet's way, and leaves alone what holds no number", () => {
		expect(adjustValue(price, "1.234,50", { kind: "add", by: "10" }, VALUE_SETTINGS.tr)).toBe("1244.5")
		expect(adjustValue(price, null, { kind: "add", by: "10" })).toBeNull()
		expect(adjustValue(price, "on iki", { kind: "add", by: "10" })).toBeNull()
		expect(adjustValue(schema.field("name"), "12", { kind: "add", by: "10" })).toBeNull()
		// Already a multiple of the step: nothing to change.
		expect(adjustValue(price, "1530", { kind: "round", step: "10" })).toBeNull()
		expect(isAdjustable(count)).toBe(true)
		expect(isAdjustable(schema.field("name"))).toBe(false)
	})

	it("refuses an amount that is not decimal text and a step that is not above zero", () => {
		expect(() => adjustValue(price, "1", { kind: "add", by: "5%" })).toThrow(/decimal text/)
		expect(() => adjustValue(price, "1", { kind: "round", step: "0" })).toThrow(/above zero/)
	})
})
