import { describe, expect, it } from "vitest"
import {
	csvDelimiterFor,
	decodeText,
	detectDelimiter,
	exportTable,
	importTable,
	ModuleSchema,
	parseCsv,
	RowStore,
	toCsv,
	VALUE_SETTINGS
} from "../src/index"

describe("CSV", () => {
	it("reads quoted cells, doubled quotes and line breaks inside a cell", () => {
		const text = 'Ürün;Not\r\n"Termos; 500 ml";"iki\r\nsatır"\r\n"""Kupa""";\r\n'

		expect(parseCsv(text)).toEqual([
			["Ürün", "Not"],
			["Termos; 500 ml", "iki\nsatır"],
			['"Kupa"', ""]
		])
	})

	it("drops a byte order mark, reads \\n line ends, and keeps a last line without one", () => {
		expect(parseCsv("\uFEFFa,b\nc,d")).toEqual([
			["a", "b"],
			["c", "d"]
		])
		expect(parseCsv('a\n""')).toEqual([["a"], [""]])
		expect(parseCsv("")).toEqual([])
	})

	it("tells the delimiter from the first line, as Excel writes it in Turkish or in English", () => {
		expect(detectDelimiter("Ürün;Yeni fiyat;Not\n1;2,5;x")).toBe(";")
		expect(detectDelimiter("Product,New price\n1,2.5")).toBe(",")
		expect(detectDelimiter("a\tb\tc")).toBe("\t")
		expect(detectDelimiter('"a;b",c')).toBe(",")
		expect(parseCsv("a,b;c", { delimiter: ";" })).toEqual([["a,b", "c"]])
	})

	it("writes what it reads back, with a byte order mark Excel needs and \\r\\n line ends", () => {
		const rows = [
			["Ürün", "Not"],
			["Termos; 500 ml", 'iki\n"satır"'],
			["Kupa", ""]
		]
		const text = toCsv(rows, { delimiter: ";" })

		expect(text).toBe('\uFEFFÜrün;Not\r\n"Termos; 500 ml";"iki\n""satır"""\r\nKupa;\r\n')
		expect(parseCsv(text)).toEqual(rows)
		expect(toCsv([["a"]], { bom: false })).toBe("a\r\n")
	})

	it("decodes UTF-8, and falls back to Windows-1254 as Excel saves a Turkish CSV", () => {
		// "Ürün;Çelik" in UTF-8: Ü = C3 9C, ü = C3 BC, Ç = C3 87.
		const utf8 = new Uint8Array([0xc3, 0x9c, 0x72, 0xc3, 0xbc, 0x6e, 0x3b, 0xc3, 0x87, 0x65, 0x6c, 0x69, 0x6b])
		// "Ürün;Çelik" in Windows-1254: Ü = 0xDC, ü = 0xFC, Ç = 0xC7.
		const windows = new Uint8Array([0xdc, 0x72, 0xfc, 0x6e, 0x3b, 0xc7, 0x65, 0x6c, 0x69, 0x6b])

		expect(decodeText(utf8)).toBe("Ürün;Çelik")
		expect(decodeText(windows)).toBe("Ürün;Çelik")
	})
})

const schema = ModuleSchema.from({
	module: "product.price_update",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", label: "Ürün", lookup: "product", required: true },
		{ key: "sku", type: "string", label: "SKU", editable: false, submit: false },
		{ key: "price", type: "money", label: "Yeni fiyat", decimals: 2, required: true },
		{ key: "validFrom", type: "date", label: "Geçerlilik" },
		{ key: "active", type: "bool", label: "Aktif" },
		{ key: "note", type: "string", label: "Not" },
		{ key: "doubled", type: "money", label: "İki katı", formula: "[price] * 2" }
	]
})

describe("exportTable", () => {
	it("writes the columns given, under their labels, as the sheet writes values", () => {
		const store = new RowStore({
			rows: [
				{
					rowId: "r1",
					values: {
						product: { id: 7, label: "Çelik Termos" },
						sku: "TRM-500",
						price: "1234.5",
						validFrom: "2026-12-31",
						active: true,
						doubled: "2469"
					}
				}
			]
		})
		const table = exportTable({ store, fields: schema.fields, settings: VALUE_SETTINGS.tr })

		expect(table).toEqual([
			["Ürün", "SKU", "Yeni fiyat", "Geçerlilik", "Aktif", "Not", "İki katı"],
			["Çelik Termos", "TRM-500", "1234,5", "31.12.2026", "Evet", "", "2469"]
		])
		expect(csvDelimiterFor(VALUE_SETTINGS.tr)).toBe(";")
		expect(csvDelimiterFor(VALUE_SETTINGS.en)).toBe(",")
	})

	it("keeps text a spreadsheet would run as a formula from being run, and leaves a negative number alone", () => {
		const store = new RowStore({
			rows: [{ rowId: "r1", values: { note: '=HYPERLINK("http://x")', price: "-12", sku: "+90 555" } }]
		})
		const [, row] = exportTable({
			store,
			fields: [schema.field("note"), schema.field("price"), schema.field("sku")],
			settings: VALUE_SETTINGS.tr
		})

		expect(row).toEqual(['\'=HYPERLINK("http://x")', "-12", "'+90 555"])
	})

	it("writes only the rows given, and keys or nothing for a header when asked", () => {
		const store = new RowStore({
			rows: [
				{ rowId: "a", values: { note: "A" } },
				{ rowId: "b", values: { note: "B" } }
			]
		})

		expect(
			exportTable({
				store,
				fields: [schema.field("note")],
				rowIds: ["b"],
				settings: VALUE_SETTINGS.tr,
				header: "key"
			})
		).toEqual([["note"], ["B"]])
		expect(
			exportTable({ store, fields: [schema.field("note")], settings: VALUE_SETTINGS.tr, header: "none" })
		).toEqual([["A"], ["B"]])
	})
})

describe("importTable", () => {
	it("matches columns by label or key in any case, and reads each cell as typed into its field", () => {
		const result = importTable(
			[
				["ürün", "PRICE", "Geçerlilik", "aktif", "Not", "Renk", "SKU", "İki katı", "Not"],
				["Çelik Termos", "1.234,5", "31.12.2026", "Evet", "ilk", "mavi", "X", "9", "ikinci"],
				["", "", "", "", "", "", "", "", ""],
				["Kupa", "on iki", "31.02.2026", "", "", "", "", "", ""]
			],
			{ schema, settings: VALUE_SETTINGS.tr }
		)

		expect(result.columns.map(column => `${column.header}:${column.status}:${column.field ?? "-"}`)).toEqual([
			"ürün:matched:product",
			"PRICE:matched:price",
			"Geçerlilik:matched:validFrom",
			"aktif:matched:active",
			"Not:matched:note",
			"Renk:unknown:-",
			"SKU:read_only:-",
			"İki katı:read_only:-",
			"Not:duplicate:-"
		])
		expect(result.rows).toEqual([
			{
				values: { product: "Çelik Termos", price: "1234.5", validFrom: "2026-12-31", active: true, note: "ilk" }
			},
			{ values: { product: "Kupa", price: "on iki", validFrom: "31.02.2026" } }
		])
		// "on iki" and the 31st of February; the product names are for the lookup to match.
		expect(result.unreadable).toBe(2)
		expect(result.missing).toEqual([])
	})

	it("names the required fields no column brought, and takes a mapping over the headers", () => {
		const result = importTable(
			[
				["Ad", "Tutar", "Not"],
				["Kupa", "12", "x"]
			],
			{ schema, settings: VALUE_SETTINGS.tr, columns: { 0: "product", 2: null } }
		)

		expect(result.columns.map(column => column.status)).toEqual(["matched", "unknown", "skipped"])
		expect(result.missing).toEqual(["price"])
		expect(result.rows).toEqual([{ values: { product: "Kupa" } }])
	})
})
