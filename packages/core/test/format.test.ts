import { describe, expect, it } from "vitest"
import {
	applyTemplate,
	CellMarks,
	createDraft,
	DraftSaver,
	findCells,
	formatCell,
	ModuleSchema,
	openDraft,
	readColumnLayout,
	readDraft,
	readMarks,
	readTemplate,
	readViewState,
	replaceCells,
	rowsMarked,
	rowStyles,
	rowsStyled,
	RowStore,
	sameView,
	SchemaError,
	TabulaError,
	templateProblems,
	UndoHistory,
	VALUE_SETTINGS,
	viewFor,
	withColumnFormat,
	type ModuleSchemaInput,
	type StyleRuleInput
} from "../src/index"

const input: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 1,
	customization: "controlled",
	fields: [
		{ key: "name", type: "string", label: "Ürün", editable: false },
		{ key: "currentPrice", type: "money", label: "Mevcut fiyat", editable: false, decimals: 2 },
		{ key: "newPrice", type: "money", label: "Yeni fiyat", decimals: 2 },
		{ key: "currency", type: "options", label: "Para birimi", options: [{ value: "TRY" }, { value: "USD" }] },
		{ key: "channels", type: "string", label: "Kanallar" }
	]
}
const schema = ModuleSchema.from(input)
const settings = VALUE_SETTINGS.tr

function sheet(): RowStore {
	return new RowStore({
		rows: [
			{
				rowId: "a",
				values: {
					name: "Ürün 1",
					currentPrice: "1496.66",
					newPrice: "1533.8",
					currency: "TRY",
					channels: "Mağaza, Web"
				}
			},
			{
				rowId: "b",
				values: {
					name: "Ürün 2",
					currentPrice: "85.33",
					newPrice: "82.6",
					currency: "USD",
					channels: "Web, Pazar yeri"
				}
			},
			{
				rowId: "c",
				values: { name: "Ürün 3", currentPrice: "517.7", newPrice: "607.3", currency: "TRY", channels: "web" }
			}
		]
	})
}

describe("column formats", () => {
	it("sets, changes and takes off a column's alignment and decimals", () => {
		let layout = withColumnFormat({ hidden: ["name"] }, "newPrice", { align: "center", decimals: 0 })

		expect(layout).toEqual({ hidden: ["name"], formats: { newPrice: { align: "center", decimals: 0 } } })

		layout = withColumnFormat(layout, "newPrice", { decimals: undefined })
		expect(layout.formats).toEqual({ newPrice: { align: "center" } })

		layout = withColumnFormat(layout, "newPrice", null)
		expect(layout).toEqual({ hidden: ["name"] })
		expect(Object.isFrozen(layout)).toBe(true)

		expect(() => withColumnFormat({}, "newPrice", { decimals: 7 })).toThrow(TabulaError)
		expect(() => withColumnFormat({}, "newPrice", { align: "middle" as never })).toThrow(TabulaError)
	})

	it("shows a number with the decimals a column asks for, keeping every digit of the value", () => {
		const field = schema.field("newPrice")

		expect(formatCell(field, "1533.8", settings)).toBe("1.533,80")
		expect(formatCell(field, "1533.8", settings, { decimals: 0 })).toBe("1.534")
		expect(formatCell(field, "1533.8", settings, { decimals: 3 })).toBe("1.533,800")
	})

	it("reads formats back from JSON, and says what is wrong with one", () => {
		const problems: string[] = []
		const layout = readColumnLayout(
			{
				formats: {
					newPrice: { align: "right", decimals: 1 },
					name: { align: "middle" },
					currency: { decimals: 9 }
				}
			},
			"columns",
			(path, message) => problems.push(`${path}: ${message}`)
		)

		expect(layout?.formats).toEqual({ newPrice: { align: "right", decimals: 1 } })
		expect(problems).toEqual([
			"columns.formats.name.align: must be one of left, center, right.",
			"columns.formats.currency.decimals: must be a whole number from 0 to 6."
		])
	})

	it("keeps formats in a view, drops those of columns gone, and tells views apart by them", () => {
		const state = readViewState(
			{ columns: { formats: { newPrice: { align: "center" }, gone: { decimals: 1 } } } },
			"view",
			() => {}
		)

		expect(viewFor(state, schema).columns.formats).toEqual({ newPrice: { align: "center" } })
		expect(sameView(schema, state, { ...state, columns: {} })).toBe(false)
		expect(
			sameView(
				schema,
				state,
				readViewState({ columns: { formats: { newPrice: { align: "center" } } } }, "v", () => {})
			)
		).toBe(true)
	})

	it("keeps formats in a draft, following a renamed field", () => {
		const store = sheet()
		const draft = createDraft({
			id: "d",
			schema,
			store,
			view: { columnWidths: {}, columns: { formats: { channels: { align: "center" } } } }
		})
		const read = readDraft(JSON.parse(JSON.stringify(draft)))

		expect(read.view.columns?.formats).toEqual({ channels: { align: "center" } })

		const renamed = ModuleSchema.from({
			...input,
			schemaVersion: 2,
			fields: [...input.fields.slice(0, 4), { key: "salesChannels", type: "string", label: "Kanallar" }]
		})
		const opening = openDraft(read, renamed, { accept: true, rename: { channels: "salesChannels" } })

		expect(opening.status === "opened" && opening.view.columns?.formats).toEqual({
			salesChannels: { align: "center" }
		})
	})
})

describe("cell marks", () => {
	const cells = [
		{ rowId: "a", field: "newPrice" },
		{ rowId: "b", field: "newPrice" }
	]

	it("puts colours, bold and italic on cells, and takes them off", () => {
		const marks = new CellMarks()
		let told = 0

		marks.subscribe(() => told++)
		marks.mark(cells, { fill: "yellow" })
		marks.mark([cells[0]!], { color: "red", bold: true })

		expect(marks.get("a", "newPrice")).toEqual({ fill: "yellow", color: "red", bold: true })
		expect(marks.get("b", "newPrice")).toEqual({ fill: "yellow" })
		expect(marks.size).toBe(2)
		expect(marks.rows()).toEqual(["a", "b"])

		marks.mark(cells, { fill: null })
		expect(marks.get("b", "newPrice")).toBeNull()
		expect(marks.hasRow("b")).toBe(false)

		marks.clear(cells)
		expect(marks.size).toBe(0)
		expect(told).toBe(4)

		// Nothing changed, nothing said.
		marks.clear(cells)
		expect(told).toBe(4)
		expect(() => marks.mark(cells, { fill: "teal" as never })).toThrow(TabulaError)
	})

	it("turns bold on for every cell, or off when every one has it", () => {
		const marks = new CellMarks()

		marks.mark([cells[0]!], { bold: true })
		marks.toggle(cells, "bold")
		expect(marks.get("b", "newPrice")).toEqual({ bold: true })

		marks.toggle(cells, "bold")
		expect(marks.size).toBe(0)
	})

	it("takes a mark back with Ctrl+Z, in its turn with the rows' changes", () => {
		const store = sheet()
		const history = new UndoHistory(store)
		const marks = new CellMarks({ history })

		store.setCell("a", "newPrice", "1600")
		marks.mark(cells, { fill: "green" })

		expect(history.undo()).toBeNull()
		expect(marks.size).toBe(0)
		expect(store.get("a", "newPrice")).toBe("1600")

		history.undo()
		expect(store.get("a", "newPrice")).toBe("1533.8")

		history.redo()
		history.redo()
		expect(marks.get("a", "newPrice")).toEqual({ fill: "green" })
		expect(store.get("a", "newPrice")).toBe("1600")
	})

	it("filters the rows with a mark", () => {
		const marks = new CellMarks({ marks: { c: { name: { italic: true } } } })
		const marked = rowsMarked(marks)

		expect(["a", "b", "c"].filter(marked)).toEqual(["c"])
	})

	it("keeps marks with the draft for the rows the sheet has, and opens them with it", () => {
		const store = sheet()
		const marks = new CellMarks({ marks: { a: { newPrice: { fill: "yellow" } }, gone: { name: { bold: true } } } })
		const draft = readDraft(JSON.parse(JSON.stringify(createDraft({ id: "d", schema, store, marks }))))

		expect(draft.marks).toEqual({ a: { newPrice: { fill: "yellow" } } })

		const opening = openDraft(draft, schema)

		expect(opening.status === "opened" && opening.marks).toEqual({ a: { newPrice: { fill: "yellow" } } })
		expect(createDraft({ id: "d", schema, store }).marks).toBeUndefined()
	})

	it("says what is wrong with marks read back", () => {
		const problems: string[] = []

		expect(
			readMarks({ a: { newPrice: { fill: "teal", bold: "yes" }, note: "red" } }, "marks", (path, message) =>
				problems.push(`${path}: ${message}`)
			)
		).toEqual({})
		expect(problems).toEqual([
			"marks.a.newPrice.fill: must be one of yellow, green, blue, purple, pink, orange, grey, red.",
			"marks.a.newPrice.bold: must be true or false.",
			'marks.a.note: must be an object such as { fill: "yellow", bold: true }.'
		])
	})

	it("saves the draft when a mark changes", async () => {
		const store = sheet()
		const marks = new CellMarks()
		const saved: unknown[] = []
		const saver = new DraftSaver({ schema, store, marks, delay: 0, save: async draft => void saved.push(draft) })

		marks.mark(cells, { fill: "blue" })
		expect(saver.dirty).toBe(true)
		await saver.save()
		expect((saved[0] as { marks?: unknown }).marks).toEqual({
			a: { newPrice: { fill: "blue" } },
			b: { newPrice: { fill: "blue" } }
		})
		saver.dispose()
	})
})

describe("colour rules", () => {
	const cheap: StyleRuleInput = {
		id: "cheap",
		when: [{ field: "newPrice", op: "<", value: 100 }],
		field: "newPrice",
		fill: "orange"
	}
	const foreign: StyleRuleInput = {
		id: "foreign",
		when: [{ field: "currency", op: "!=", value: "TRY" }],
		color: "blue",
		bold: true
	}

	it("colours a cell or the whole row where every condition holds", () => {
		const styled = ModuleSchema.from({ ...input, styles: [cheap, foreign] })
		const store = sheet()
		const field = (key: string) => styled.field(key)
		const of = (rowId: string) => rowStyles(styled.styles, field, key => store.get(rowId, key), settings)

		expect(of("a").size).toBe(0)
		expect(Object.fromEntries(of("b"))).toEqual({
			newPrice: { fill: "orange", color: null, bold: false },
			null: { fill: null, color: "blue", bold: true }
		})
		expect(rowsStyled(styled, store, styled.styles[0]!, settings)).toEqual(["b"])
		expect(ModuleSchema.from(styled.toJSON()).styles).toEqual(styled.styles)
	})

	it("draws a later rule over an earlier one on the same cell", () => {
		const styled = ModuleSchema.from({
			...input,
			styles: [
				cheap,
				{ id: "very-cheap", when: [{ field: "newPrice", op: "<", value: 90 }], field: "newPrice", fill: "red" }
			]
		})
		const store = sheet()
		const styles = rowStyles(
			styled.styles,
			key => styled.field(key),
			key => store.get("b", key),
			settings
		)

		expect(styles.get("newPrice")?.fill).toBe("red")
	})

	it("refuses a rule that colours nothing, names a field it does not have, or a colour that is not one", () => {
		try {
			ModuleSchema.from({
				...input,
				styles: [
					{ id: "none", when: [{ field: "newPrice", op: "filled" }] },
					{ id: "x", when: [{ field: "price", op: "filled" }], field: "price", fill: "teal" as never },
					{ id: "y", when: [] as never, fill: "red" }
				]
			})
			expect.unreachable()
		} catch (error) {
			expect((error as SchemaError).problems.map(problem => `${problem.path}: ${problem.message}`)).toEqual([
				"styles[0]: colours nothing: give a fill, a colour or bold",
				'styles[1].when[0].field: "price" is not a field of this schema',
				'styles[1].field: "price" is not a field of this schema',
				"styles[1].fill: must be one of yellow, green, blue, purple, pink, orange, grey, red",
				"styles[2].when: must be an array of one condition or more, every one of which must hold"
			])
		}
	})

	it("takes a template's rules after the schema's, and names a broken one by its place in the template", () => {
		const template = readTemplate(
			{
				format: "tabula-grid.template",
				version: 1,
				module: "product.price_update",
				id: "march",
				name: "Mart",
				styles: [cheap, { id: "bad", when: [{ field: "newPrice", op: "<", value: 1 }], fill: "teal" }]
			},
			"product.price_update"
		)

		expect(templateProblems(ModuleSchema.from({ ...input, styles: [foreign] }), template)).toEqual([
			{ path: "styles[1].fill", message: "must be one of yellow, green, blue, purple, pink, orange, grey, red" }
		])

		const good = readTemplate({ ...JSON.parse(JSON.stringify(template)), styles: [cheap] }, "product.price_update")

		expect(
			applyTemplate(ModuleSchema.from({ ...input, styles: [foreign] }), good).styles.map(rule => rule.id)
		).toEqual(["foreign", "cheap"])
	})
})

describe("find and replace", () => {
	it("finds text as the cells show it, in any case, or only whole cells", () => {
		const store = sheet()
		const all = ["a", "b", "c"]

		expect(findCells(store, schema, all, ["channels"], "WEB", { settings, locale: "tr" })).toEqual([
			{ rowId: "a", field: "channels" },
			{ rowId: "b", field: "channels" },
			{ rowId: "c", field: "channels" }
		])
		expect(findCells(store, schema, all, ["channels"], "web", { settings, whole: true })).toEqual([
			{ rowId: "c", field: "channels" }
		])
		expect(findCells(store, schema, all, ["channels"], "Web", { settings, matchCase: true })).toHaveLength(2)
		expect(findCells(store, schema, all, ["newPrice"], "1.533,80", { settings })).toEqual([
			{ rowId: "a", field: "newPrice" }
		])
		expect(findCells(store, schema, all, ["channels"], "", { settings })).toEqual([])
	})

	it("replaces as typing would, in one step, leaving columns that cannot be typed into", () => {
		const store = sheet()
		const history = new UndoHistory(store)
		const found = findCells(store, schema, ["a", "b"], ["channels", "currentPrice", "newPrice"], "5", { settings })
		const result = replaceCells(store, schema, found, "5", "9", { settings })

		expect(result.replaced).toBe(1)
		expect(result.skipped).toBe(1)
		expect(store.get("a", "newPrice")).toBe("1933.8")
		expect(store.get("a", "currentPrice")).toBe("1496.66")

		const channels = findCells(store, schema, ["a", "b"], ["channels"], "web", { settings, locale: "tr" })

		replaceCells(store, schema, channels, "web", "Online", { settings, locale: "tr" })
		expect(store.get("a", "channels")).toBe("Mağaza, Online")
		expect(store.get("b", "channels")).toBe("Online, Pazar yeri")

		history.undo()
		expect(store.get("b", "channels")).toBe("Web, Pazar yeri")
	})

	it("leaves a row the host keeps from being written", () => {
		const store = sheet()
		const found = findCells(store, schema, ["a", "b"], ["channels"], "Web", { settings })
		const result = replaceCells(store, schema, found, "Web", "W", { settings, editable: rowId => rowId !== "b" })

		expect(result).toMatchObject({ replaced: 1, skipped: 1 })
		expect(store.get("b", "channels")).toBe("Web, Pazar yeri")
	})
})
