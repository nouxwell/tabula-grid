import { describe, expect, it } from "vitest"
import {
	LookupResolver,
	lookupFills,
	ModuleSchema,
	RowStore,
	SchemaError,
	suggestColumns,
	UndoHistory,
	VALUE_SETTINGS,
	type LookupItem,
	type LookupResolveRequest,
	type ModuleSchemaInput
} from "../src/index"

const input: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", lookup: "product", label: "Ürün", fills: ["sku", "currentPrice"] },
		{ key: "sku", type: "string", label: "SKU", editable: false },
		{ key: "currentPrice", type: "money", label: "Mevcut fiyat", editable: false, decimals: 2 },
		{ key: "newPrice", type: "money", label: "Yeni fiyat", decimals: 2 }
	]
}
const schema = ModuleSchema.from(input)

/** Products found by name or by code, each with its code and price. */
const PRODUCTS: readonly LookupItem[] = [
	{ id: 1, label: "Kupa", description: "SKU-1", values: { sku: "SKU-1", currentPrice: "120.50" } },
	{ id: 2, label: "Termos", description: "SKU-2", values: { sku: "SKU-2", currentPrice: "300.00" } }
]

function setup() {
	let next = 0
	const store = new RowStore({ createRowId: () => `row_${++next}`, rows: [{}, {}] })
	const history = new UndoHistory(store)
	const resolves: LookupResolveRequest[] = []
	const resolver = new LookupResolver({
		schema,
		store,
		adapters: {
			search: async () => ({ items: PRODUCTS }),
			resolve: async request => {
				resolves.push(request)

				return {
					matches: request.labels.map(label => ({
						label,
						items: PRODUCTS.filter(item => item.label === label || item.description === label)
					}))
				}
			}
		}
	})

	return { store, history, resolver, resolves }
}

describe("a lookup's fills", () => {
	it("are read with the schema and written back", () => {
		expect(schema.field("product")).toMatchObject({ fills: ["sku", "currentPrice"] })
		expect(ModuleSchema.from(schema.toJSON()).field("product")).toMatchObject({ fills: ["sku", "currentPrice"] })
	})

	it("name fields of the schema, not the lookup itself, another lookup or a formula, each filled once", () => {
		const problems = (fills: string[], extra: ModuleSchemaInput["fields"] = []) => {
			try {
				ModuleSchema.from({
					...input,
					fields: [{ ...input.fields[0]!, fills }, ...input.fields.slice(1), ...extra]
				})

				return []
			} catch (error) {
				return (error as SchemaError).problems.map(problem => problem.message)
			}
		}

		expect(problems(["price"])).toEqual(['names "price", which is not a field of this schema'])
		expect(problems(["product"])).toEqual(["names the lookup itself; its record is its own value"])
		expect(problems(["store"], [{ key: "store", type: "lookup", lookup: "store" }])).toEqual([
			'names "store", a lookup: a record is matched by its own lookup'
		])
		expect(problems(["diff"], [{ key: "diff", type: "money", formula: "[newPrice] - [currentPrice]" }])).toEqual([
			'names "diff", which a formula works out'
		])
		expect(problems(["sku"], [{ key: "store", type: "lookup", lookup: "store", fills: ["sku"] }])).toEqual([
			'names "sku", which "product" fills already'
		])
	})

	it("say what a record writes, or empty the fields with no record", () => {
		const field = schema.field("product")

		expect(lookupFills(field, "r", PRODUCTS[0]!)).toEqual([
			{ rowId: "r", field: "sku", value: "SKU-1" },
			{ rowId: "r", field: "currentPrice", value: "120.50" }
		])
		expect(lookupFills(field, "r", null)).toEqual([
			{ rowId: "r", field: "sku", value: null },
			{ rowId: "r", field: "currentPrice", value: null }
		])
		expect(lookupFills(schema.field("newPrice"), "r", PRODUCTS[0]!)).toEqual([])
	})

	it("are written with the record a name or a code is matched to, as part of the same step", async () => {
		const { store, history, resolver } = setup()

		store.transact(() => {
			store.setCell("row_1", "product", "SKU-2")
			store.setCell("row_2", "product", "Kupa")
		})
		await resolver.settled()

		expect(store.get("row_1", "product")).toEqual({ id: 2, label: "Termos" })
		expect(store.get("row_1", "sku")).toBe("SKU-2")
		expect(store.get("row_1", "currentPrice")).toBe("300.00")
		expect(store.get("row_2", "currentPrice")).toBe("120.50")

		history.undo()
		expect(store.get("row_1", "product")).toBeNull()
		expect(store.get("row_1", "sku")).toBeNull()
	})

	it("are emptied when the cell is left with no record", async () => {
		const { store, resolver } = setup()

		store.setCell("row_1", "product", "Kupa")
		await resolver.settled()
		expect(store.get("row_1", "sku")).toBe("SKU-1")

		store.setCell("row_1", "product", null)
		await Promise.resolve()
		expect(store.get("row_1", "sku")).toBeNull()
		expect(store.get("row_1", "currentPrice")).toBeNull()

		// A name nothing matches: the cell holds text, and what was filled goes.
		store.setCell("row_2", "product", "Termos")
		await resolver.settled()
		store.setCell("row_2", "product", "Yok böyle")
		await resolver.settled()
		expect(store.get("row_2", "sku")).toBeNull()
	})

	it("tell, without writing, what names would be matched to, asking once", async () => {
		const { store, resolver, resolves } = setup()

		await expect(resolver.match("product", ["SKU-1", "Yok", "SKU-1"])).resolves.toEqual([
			PRODUCTS[0],
			null,
			PRODUCTS[0]
		])
		await expect(resolver.match("product", ["SKU-1"])).resolves.toEqual([PRODUCTS[0]])
		expect(resolves).toHaveLength(1)
		expect(store.get("row_1", "product")).toBeNull()
	})

	it("make a header naming a field the lookup fills go to the lookup in an import", () => {
		const table = [
			["SKU", "Yeni fiyat"],
			["SKU-1", "130"]
		]

		expect(suggestColumns(table, { schema, settings: VALUE_SETTINGS.tr })).toEqual([
			{ field: "product", reason: "lookup" },
			{ field: "newPrice", reason: "name" }
		])
	})
})
