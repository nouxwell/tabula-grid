import { describe, expect, it } from "vitest"
import {
	applyFormulas,
	FormulaEngine,
	formulaError,
	formulaFields,
	formulaNumber,
	ModuleSchema,
	numberArgument,
	parseFormula,
	RowStore,
	SchemaError,
	SheetSession,
	SheetValidator,
	TabulaError,
	UndoHistory,
	type FormulaFunction,
	type ModuleSchemaInput,
	type ProcessRequest
} from "../src/index"
import { add, decimalToText, divide, multiply, parseDecimal, round, subtract } from "../src/formula/decimal"
import { evaluate, type FormulaValue } from "../src/formula/evaluate"

const d = (text: string) => parseDecimal(text)!

describe("decimal arithmetic", () => {
	it("adds, subtracts and multiplies exactly, where floats do not", () => {
		expect(decimalToText(add(d("0.1"), d("0.2")))).toBe("0.3")
		expect(decimalToText(subtract(d("389.90"), d("355.94")))).toBe("33.96")
		expect(decimalToText(multiply(d("19.99"), d("3")))).toBe("59.97")
		expect(decimalToText(multiply(d("-0.5"), d("0.5")))).toBe("-0.25")
	})

	it("divides to twenty places, rounded half away from zero, and refuses zero", () => {
		expect(decimalToText(divide(d("1"), d("3"))!)).toBe("0.33333333333333333333")
		expect(decimalToText(divide(d("2"), d("3"))!)).toBe("0.66666666666666666667")
		expect(decimalToText(divide(d("10"), d("4"))!)).toBe("2.5")
		expect(divide(d("1"), d("0"))).toBeNull()
	})

	it("rounds half away from zero, up and down, and to tens", () => {
		expect(decimalToText(round(d("2.345"), 2, "half"))).toBe("2.35")
		expect(decimalToText(round(d("-2.345"), 2, "half"))).toBe("-2.35")
		expect(decimalToText(round(d("2.341"), 2, "up"))).toBe("2.35")
		expect(decimalToText(round(d("-2.349"), 2, "down"))).toBe("-2.34")
		expect(decimalToText(round(d("1250"), -2, "half"))).toBe("1300")
	})
})

/** Works a formula out over a row given as plain values. */
function calc(
	source: string,
	row: Readonly<Record<string, FormulaValue>> = {},
	functions: Readonly<Record<string, FormulaFunction>> = {}
): string {
	const value = evaluate(parseFormula(source), {
		field: key => row[key] ?? { type: "empty" },
		functions
	})

	switch (value.type) {
		case "number":
			return decimalToText(value.value)
		case "text":
			return `"${value.value}"`
		case "bool":
			return value.value ? "TRUE" : "FALSE"
		case "empty":
			return "(empty)"
		case "error":
			return value.code
	}
}

const num = (text: string): FormulaValue => ({ type: "number", value: d(text) })
const txt = (value: string): FormulaValue => ({ type: "text", value })

describe("formulas", () => {
	it("follows Excel's order: powers before products before sums before comparisons", () => {
		expect(calc("1 + 2 * 3")).toBe("7")
		expect(calc("(1 + 2) * 3")).toBe("9")
		expect(calc("2 ^ 3 ^ 2")).toBe("64")
		expect(calc("-2 ^ 2")).toBe("4")
		expect(calc("=10 - 2 - 3")).toBe("5")
		expect(calc("1 + 1 = 2")).toBe("TRUE")
		expect(calc("50%")).toBe("0.5")
		expect(calc('"a" & 1 + 1')).toBe('"a2"')
	})

	it("reads the fields of its row by key", () => {
		const row = { newPrice: num("389.90"), currentPrice: num("355.94") }

		expect(calc("ROUND(([newPrice] - [currentPrice]) / [currentPrice] * 100, 1)", row)).toBe("9.5")
		expect(formulaFields(parseFormula("[a] + SUM([b], [a])"))).toEqual(["a", "b"])
	})

	it("treats an empty field as 0 in a sum, and as nothing in an average", () => {
		expect(calc("[a] + 1")).toBe("1")
		expect(calc("SUM([a], 2, [b])", { b: num("3") })).toBe("5")
		expect(calc("AVERAGE([a], 2, 4)")).toBe("3")
		expect(calc("AVERAGE([a])")).toBe("#DIV/0!")
		expect(calc("MIN(5, [a], 3)")).toBe("3")
		expect(calc("MAX()")).toBe("0")
	})

	it("gives an error for what cannot be worked out, and carries it through", () => {
		expect(calc("1 / 0")).toBe("#DIV/0!")
		expect(calc("[price] * 2", { price: txt("on iki") })).toBe("#VALUE!")
		expect(calc("NOSUCH(1)")).toBe("#NAME?")
		expect(calc("2 ^ 0.5")).toBe("#NUM!")
		expect(calc("ROUND(1 / 0, 2) + 1")).toBe("#DIV/0!")
		expect(calc('"5" * 2')).toBe("10")
	})

	it("works out only the branch it needs, so a guard keeps an error away", () => {
		expect(calc("IF([qty] > 0, 100 / [qty], 0)", { qty: num("0") })).toBe("0")
		expect(calc("IF(FALSE, 1)")).toBe("FALSE")
		expect(calc("IFERROR(1 / 0, -1)")).toBe("-1")
		expect(calc("ISBLANK([note])")).toBe("TRUE")
		expect(calc("AND(TRUE, 1, NOT(FALSE))")).toBe("TRUE")
		expect(calc("OR([a], 0)")).toBe("FALSE")
	})

	it("compares text regardless of case, and across kinds as Excel does", () => {
		expect(calc('"Termos" = "TERMOS"')).toBe("TRUE")
		expect(calc('1 < "1"')).toBe("TRUE")
		expect(calc("[empty] = 0")).toBe("TRUE")
		expect(calc('[empty] = ""')).toBe("TRUE")
		expect(calc('LEN("Çelik") & CONCAT("-", TRUE)')).toBe('"5-TRUE"')
	})

	it("takes arguments separated by semicolons too, as a Turkish Excel writes them", () => {
		expect(calc("ROUND(2.345; 2)")).toBe("2.35")
		expect(calc("ROUNDUP(2.341, 2) + ROUNDDOWN(-2.349, 2)")).toBe("0.01")
	})

	it("runs an application's own function, and turns what it throws into #VALUE!", () => {
		const functions: Record<string, FormulaFunction> = {
			MARGIN: ([price, cost]) => {
				const p = numberArgument(price ?? { type: "empty" })
				const c = numberArgument(cost ?? { type: "empty" })

				return p === null || c === null
					? formulaError("#VALUE!")
					: formulaNumber(((Number(p) - Number(c)) / Number(p)).toFixed(4))
			},
			BROKEN: () => {
				throw new Error("oops")
			}
		}

		expect(calc("margin(200, 150)", {}, functions)).toBe("0.25")
		expect(calc("BROKEN()", {}, functions)).toBe("#VALUE!")
	})

	it("says where a formula stops making sense", () => {
		const message = (source: string): string => {
			try {
				parseFormula(source)
			} catch (error) {
				return error instanceof TabulaError ? `${error.code}: ${error.message}` : String(error)
			}

			return "parsed"
		}

		expect(message("1 +")).toBe(
			'invalid_formula: The formula ends where a value is expected at character 4 of "1 +".'
		)
		expect(message("SUM(1 2)")).toBe('invalid_formula: A "," or a ")" is expected at character 7 of "SUM(1 2)".')
		expect(message("price * 2")).toMatch(/a field is written in brackets, \[price\]/)
		expect(message('"open')).toMatch(/A text is not closed with a quote at character 1/)
		expect(message("[a] # 2")).toMatch(/"#" has no meaning in a formula at character 5/)
	})
})

const INPUT: ModuleSchemaInput = {
	module: "sales.order_lines",
	schemaVersion: 1,
	fields: [
		{ key: "price", type: "money", decimals: 2 },
		{ key: "quantity", type: "integer" },
		{ key: "total", type: "money", decimals: 2, formula: "[price] * [quantity]" },
		{ key: "vat", type: "money", decimals: 2, formula: "[total] * 0.2" },
		{ key: "big", type: "bool", formula: "[total] > 1000" },
		{ key: "unit", type: "decimal", formula: "[total] / [quantity]", submit: false }
	]
}

describe("formula fields", () => {
	it("are never editable, whatever the schema says", () => {
		const schema = ModuleSchema.from({
			...INPUT,
			fields: [
				...INPUT.fields.slice(0, 2),
				{ key: "total", type: "money", formula: "[price] * [quantity]", editable: true }
			]
		})

		expect(schema.field("total")).toMatchObject({ editable: false, formula: "[price] * [quantity]" })
	})

	it("are refused for a formula that does not parse, reads what is not there, or goes round in a circle", () => {
		const problems = (fields: ModuleSchemaInput["fields"]): string[] => {
			try {
				ModuleSchema.from({ ...INPUT, fields })
			} catch (error) {
				if (error instanceof SchemaError) {
					return error.problems.map(problem => `${problem.path}: ${problem.message}`)
				}
			}

			return []
		}

		expect(
			problems([
				{ key: "a", type: "decimal", formula: "[b] +" },
				{ key: "b", type: "decimal", formula: "[nope] * 2" },
				{ key: "c", type: "decimal", formula: "[c] + 1" },
				{ key: "d", type: "lookup", lookup: "product", formula: "1" }
			])
		).toEqual([
			"fields[3].formula: cannot fill a lookup field; a formula works out a text, a number, a date or yes and no",
			'fields[0].formula: The formula ends where a value is expected at character 6 of "[b] +".',
			"fields[1].formula: reads [nope], which is not a field of this schema",
			"fields[2].formula: reads [c], the field it fills"
		])
		expect(
			problems([
				{ key: "a", type: "decimal", formula: "[b] + 1" },
				{ key: "b", type: "decimal", formula: "[c] + 1" },
				{ key: "c", type: "decimal", formula: "[a] + 1" }
			])
		).toEqual(["fields[0].formula: is part of a circle of formulas: [a] → [b] → [c] → [a]"])
	})
})

describe("FormulaEngine", () => {
	const schema = ModuleSchema.from(INPUT)

	function setup(rows = [{ values: { price: "19.99", quantity: "3" } }]) {
		let next = 0
		const store = new RowStore({ createRowId: () => `row_${++next}`, rows })
		const history = new UndoHistory(store)
		const engine = new FormulaEngine({ schema, store })

		return { store, history, engine }
	}

	it("works the formulas out for the rows it is given, each after those it reads, to its field's places", () => {
		const { store, history } = setup()

		expect(store.values("row_1")).toEqual({
			price: "19.99",
			quantity: "3",
			total: "59.97",
			vat: "11.99",
			big: false,
			unit: "19.99"
		})
		// Worked out as the sheet opened: a change of its own, before any the user made.
		expect(store.revision).toBe(1)
		expect(history.canUndo).toBe(true)
	})

	it("works out what a change reaches inside that change: one revision, one notice, one undo", () => {
		const { store, history } = setup()
		const notices: string[] = []

		history.clear()
		store.subscribe(change =>
			notices.push(change.operations.map(op => (op.kind === "set" ? op.field : op.kind)).join(","))
		)

		const before = store.revision

		store.setCell("row_1", "quantity", "100")

		expect(store.values("row_1")).toMatchObject({ total: "1999", vat: "399.8", big: true })
		expect(store.revision).toBe(before + 1)
		// Listeners never see a quantity whose total is behind it.
		expect(notices).toEqual(["quantity,total,vat,big"])

		history.undo()

		expect(store.values("row_1")).toMatchObject({ quantity: "3", total: "59.97", big: false })
		expect(history.canUndo).toBe(false)

		history.redo()

		expect(store.values("row_1")).toMatchObject({ quantity: "100", total: "1999" })
	})

	it("works out the rows that are added", () => {
		const { store } = setup()

		store.appendRows([{ rowId: "added", values: { price: "10", quantity: "2" } }])

		expect(store.get("added", "total")).toBe("20")
	})

	it("keeps a formula's error in the cell, as an issue that holds back processing, and sends no value for it", async () => {
		const { store } = setup()
		const validator = new SheetValidator(schema, store)
		const sent: ProcessRequest[] = []
		const session = new SheetSession({
			schema,
			store,
			validator,
			adapters: { process: async request => (sent.push(request), { status: "succeeded" }) }
		})

		store.setCell("row_1", "quantity", "0")

		expect(store.get("row_1", "unit")).toEqual({ formulaError: "#DIV/0!" })
		expect(validator.issuesAt("row_1", "unit")).toMatchObject([
			{ code: "formula_error", params: { error: "#DIV/0!" }, blocking: true }
		])
		await expect(session.process()).resolves.toMatchObject({ status: "blocked" })

		store.setCell("row_1", "quantity", "3")
		expect(validator.issuesAt("row_1", "unit")).toEqual([])
	})

	it("fills rows before there is a store, so a sheet opens without a change of its own", () => {
		const rows = applyFormulas(schema, [{ values: { price: "5", quantity: "4" } }])
		const store = new RowStore({ rows })

		new FormulaEngine({ schema, store })

		expect(rows[0]?.values).toMatchObject({ total: "20", vat: "4", big: false })
		expect(store.revision).toBe(0)
	})

	it("works out an application's own functions", async () => {
		const custom = ModuleSchema.from({
			...INPUT,
			fields: [
				{ key: "price", type: "money" },
				{ key: "cost", type: "money" },
				{ key: "margin", type: "percent", decimals: 1, formula: "MARGIN([price], [cost]) * 100" }
			]
		})
		const store = new RowStore({ rows: [{ rowId: "r", values: { price: "200", cost: "150" } }] })

		new FormulaEngine({
			schema: custom,
			store,
			functions: {
				margin: ([price, cost]) => {
					const p = Number(numberArgument(price ?? { type: "empty" }))
					const c = Number(numberArgument(cost ?? { type: "empty" }))

					return formulaNumber((p - c) / p)
				}
			}
		})

		expect(store.get("r", "margin")).toBe("25")
	})
})
