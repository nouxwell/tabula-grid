import type { RowId, RowInit, RowStore, StoreOperation } from "../rows.js"
import type { FieldSchema, ModuleSchema } from "../schema.js"
import { sameValue, type CellValue } from "../value.js"
import { decimalText } from "../values/number.js"
import { describeValue, isLookupValue } from "../values/read.js"
import { decimalToText, parseDecimal, round } from "./decimal.js"
import { formulaErrorValue, isFormulaError } from "./error.js"
import {
	boolValue,
	EMPTY,
	evaluate,
	numberValue,
	textValue,
	toBool,
	toNumber,
	toText,
	type FormulaFunction,
	type FormulaValue
} from "./evaluate.js"
import { formulaFields, parseFormula, type FormulaNode } from "./parse.js"

/**
 * The origin of the change that works out, as an engine starts, the formulas of rows a store was
 * given as they were, where they differ. Every later formula value goes in with the change that
 * called for it.
 */
export const FORMULA_ORIGIN = "formula"

export interface FormulaEngineOptions {
	readonly schema: ModuleSchema
	readonly store: RowStore
	/**
	 * The application's own functions, by name. They work a value out of their arguments and do
	 * nothing else; the built-in ones cannot be replaced.
	 */
	readonly functions?: Readonly<Record<string, FormulaFunction>>
}

interface Compiled {
	readonly field: FieldSchema
	readonly tree: FormulaNode
}

/**
 * Keeps a sheet's formula fields worked out. Every change to the store works out again, inside that
 * very change, the formulas that read what it changed, for the rows it changed, each after the
 * formulas it reads: an edit and what follows from it are one change, one revision, one step to undo.
 *
 * The values are written into the store like any other, so the validator checks them, a draft keeps
 * them and the backend receives them. The backend works them out again: a value the browser worked
 * out is never to be trusted on its own. A formula that cannot be worked out leaves its error in the
 * cell, such as `#DIV/0!`, and that is an issue.
 */
export class FormulaEngine {
	readonly #schema: ModuleSchema
	readonly #store: RowStore
	readonly #functions: Readonly<Record<string, FormulaFunction>>
	readonly #order: readonly Compiled[]
	/** By field: the formulas to work out again when it changes, in order. */
	readonly #affected: ReadonlyMap<string, readonly Compiled[]>
	readonly #stop: () => void

	constructor(options: FormulaEngineOptions) {
		this.#schema = options.schema
		this.#store = options.store
		this.#functions = upperKeys(options.functions ?? {})
		this.#order = compile(options.schema)
		this.#affected = affected(this.#order)
		this.#stop = this.#store.derive(operations => this.#derive(operations))

		// Rows the store was given as they were: what differs is written now, as a change of its own.
		// `applyFormulas` before the store is made leaves nothing to write.
		this.#store.transact(
			() => {
				for (const rowId of this.#store.rowIds()) {
					this.#write(rowId, this.#order)
				}
			},
			{ origin: FORMULA_ORIGIN }
		)
	}

	/** What a formula field works out to for a row as it stands now. */
	compute(rowId: RowId, key: string): CellValue {
		const formula = this.#order.find(compiled => compiled.field.key === key)

		if (!formula) {
			return this.#store.get(rowId, key)
		}

		return this.#workOut(rowId, this.#order.slice(0, this.#order.indexOf(formula) + 1)).get(key) ?? null
	}

	/** Stops working formulas out. */
	dispose(): void {
		this.#stop()
	}

	/** Inside a change: the formulas its writes reach, for each row it wrote to or added. */
	#derive(operations: readonly StoreOperation[]): void {
		const rows = new Map<RowId, Set<string> | "all">()

		for (const operation of operations) {
			if (operation.kind === "set") {
				if (this.#affected.has(operation.field)) {
					const changed = rows.get(operation.rowId)

					if (changed !== "all") {
						rows.set(operation.rowId, (changed ?? new Set()).add(operation.field))
					}
				}
			} else if (operation.kind === "insert") {
				for (const row of operation.rows) {
					rows.set(row.rowId, "all")
				}
			}
		}

		for (const [rowId, changed] of rows) {
			if (this.#store.has(rowId)) {
				this.#write(rowId, changed === "all" ? this.#order : this.#formulasFor(changed))
			}
		}
	}

	/** Writes what the formulas work out to where it differs from what the row holds. */
	#write(rowId: RowId, formulas: readonly Compiled[]): void {
		for (const [key, value] of this.#workOut(rowId, formulas)) {
			if (!sameValue(this.#store.get(rowId, key), value)) {
				this.#store.setCell(rowId, key, value)
			}
		}
	}

	#formulasFor(changed: ReadonlySet<string>): Compiled[] {
		const keys = new Set<string>()

		for (const field of changed) {
			for (const formula of this.#affected.get(field) ?? []) {
				keys.add(formula.field.key)
			}
		}

		return this.#order.filter(formula => keys.has(formula.field.key))
	}

	/** The formulas' values for a row, each seeing the ones worked out before it. */
	#workOut(rowId: RowId, formulas: readonly Compiled[]): Map<string, CellValue> {
		const values = new Map<string, CellValue>()
		const read = (key: string): CellValue =>
			values.has(key) ? (values.get(key) as CellValue) : this.#store.get(rowId, key)

		for (const formula of formulas) {
			values.set(formula.field.key, workOut(formula, this.#schema, read, this.#functions))
		}

		return values
	}
}

/**
 * Rows with their formula fields worked out, before there is a store: so a sheet opens with the
 * values in place, rather than with a first change that is no user's.
 */
export function applyFormulas(
	schema: ModuleSchema,
	rows: readonly RowInit[],
	functions: Readonly<Record<string, FormulaFunction>> = {}
): RowInit[] {
	const order = compile(schema)
	const named = upperKeys(functions)

	if (order.length === 0) {
		return [...rows]
	}

	return rows.map(row => {
		const values: Record<string, CellValue | undefined> = { ...row.values }
		const read = (key: string): CellValue => values[key] ?? null

		for (const formula of order) {
			values[formula.field.key] = workOut(formula, schema, read, named)
		}

		return { ...row, values }
	})
}

// ---------------------------------------------------------------- working out

function workOut(
	formula: Compiled,
	schema: ModuleSchema,
	read: (key: string) => CellValue,
	functions: Readonly<Record<string, FormulaFunction>>
): CellValue {
	const result = evaluate(formula.tree, {
		field: key => (schema.has(key) ? fromCell(schema.field(key), read(key)) : EMPTY),
		functions
	})

	return toCell(formula.field, result)
}

/** A cell's value as a formula sees it: by its field's type, as the user does. */
export function fromCell(field: FieldSchema, value: CellValue): FormulaValue {
	if (value === null) {
		return EMPTY
	}

	if (isFormulaError(value)) {
		return { type: "error", code: value.formulaError }
	}

	switch (field.type) {
		case "integer":
		case "decimal":
		case "quantity":
		case "money":
		case "percent": {
			const text = decimalText(value)
			const number = text === null ? null : parseDecimal(text)

			// Text a user typed that is no number stays text, and a sum over it is #VALUE!.
			return number ? numberValue(number) : textValue(describeValue(value))
		}
		case "bool":
			return typeof value === "boolean" ? boolValue(value) : textValue(describeValue(value))
		case "lookup":
			return textValue(isLookupValue(value) ? value.label : describeValue(value))
		case "options": {
			if (Array.isArray(value)) {
				return textValue(value.map(describeValue).join(", "))
			}

			const number = typeof value === "number" ? parseDecimal(describeValue(value)) : null

			return number ? numberValue(number) : textValue(describeValue(value))
		}
		default:
			return textValue(describeValue(value))
	}
}

/** A formula's result as the field it fills holds it: a number to its places, an error as itself. */
function toCell(field: FieldSchema, result: FormulaValue): CellValue {
	if (result.type === "error") {
		return formulaErrorValue(result.code)
	}

	if (result.type === "empty") {
		return null
	}

	switch (field.type) {
		case "integer":
		case "decimal":
		case "quantity":
		case "money":
		case "percent": {
			const number = toNumber(result)

			if ("type" in number) {
				return formulaErrorValue(number.code)
			}

			const places = field.type === "integer" ? 0 : field.decimals

			return decimalToText(places === null ? number : round(number, places, "half"))
		}
		case "bool": {
			const truth = toBool(result)

			return typeof truth === "boolean" ? truth : formulaErrorValue(truth.code)
		}
		default: {
			const text = toText(result)

			return typeof text === "string" ? text : formulaErrorValue(text.code)
		}
	}
}

// ---------------------------------------------------------------- compiling

/** The schema's formulas, each after the formulas it reads. The schema has already refused a circle. */
function compile(schema: ModuleSchema): Compiled[] {
	const formulas = new Map<string, Compiled & { readonly reads: readonly string[] }>()

	for (const field of schema.fields) {
		if (field.formula !== null) {
			const tree = parseFormula(field.formula)

			formulas.set(field.key, { field, tree, reads: formulaFields(tree) })
		}
	}

	const order: Compiled[] = []
	const placed = new Set<string>()
	const place = (key: string): void => {
		const formula = formulas.get(key)

		if (!formula || placed.has(key)) {
			return
		}

		placed.add(key)
		formula.reads.forEach(place)
		order.push({ field: formula.field, tree: formula.tree })
	}

	for (const key of formulas.keys()) {
		place(key)
	}

	return order
}

/** For each field, every formula that reads it, directly or through another formula, in order. */
function affected(order: readonly Compiled[]): Map<string, Compiled[]> {
	const readers = new Map<string, Compiled[]>()

	for (const formula of order) {
		for (const key of formulaFields(formula.tree)) {
			const list = readers.get(key) ?? []

			list.push(formula)
			readers.set(key, list)
		}
	}

	const result = new Map<string, Compiled[]>()

	for (const key of readers.keys()) {
		const reached = new Set<string>()
		const visit = (field: string): void => {
			for (const formula of readers.get(field) ?? []) {
				if (!reached.has(formula.field.key)) {
					reached.add(formula.field.key)
					visit(formula.field.key)
				}
			}
		}

		visit(key)
		result.set(
			key,
			order.filter(formula => reached.has(formula.field.key))
		)
	}

	return result
}

function upperKeys(functions: Readonly<Record<string, FormulaFunction>>): Record<string, FormulaFunction> {
	return Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name.toUpperCase(), fn]))
}
