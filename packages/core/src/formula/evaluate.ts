import {
	absolute,
	add,
	compare,
	decimalToText,
	divide,
	isZero,
	multiply,
	ONE,
	parseDecimal,
	power,
	round,
	subtract,
	ZERO,
	type Decimal
} from "./decimal"
import type { FormulaErrorCode } from "./error"
import type { FormulaNode } from "./parse"

/** A value while a formula is worked out. */
export type FormulaValue =
	| { readonly type: "number"; readonly value: Decimal }
	| { readonly type: "text"; readonly value: string }
	| { readonly type: "bool"; readonly value: boolean }
	| { readonly type: "empty" }
	| { readonly type: "error"; readonly code: FormulaErrorCode }

/**
 * A function an application adds to the language, such as a margin rule of its own. It works out a
 * value from its arguments and nothing else: no request, no write, no side effect. Whatever it
 * throws becomes `#VALUE!`.
 */
export type FormulaFunction = (args: readonly FormulaValue[]) => FormulaValue

export interface EvaluationContext {
	/** A field of the row, by key. */
	field(key: string): FormulaValue
	/** The application's functions, by name in capitals. The built-in ones cannot be replaced. */
	readonly functions: Readonly<Record<string, FormulaFunction>>
}

export const EMPTY: FormulaValue = Object.freeze({ type: "empty" })

export function numberValue(value: Decimal): FormulaValue {
	return Object.freeze({ type: "number", value })
}

export function textValue(value: string): FormulaValue {
	return Object.freeze({ type: "text", value })
}

export function boolValue(value: boolean): FormulaValue {
	return value ? TRUE : FALSE
}

export function errorValue(code: FormulaErrorCode): FormulaValue {
	return Object.freeze({ type: "error", code })
}

// ---------------------------------------------------------------- for an application's functions

/** A number for a formula, from decimal text or a JavaScript number; `#NUM!` for one that is not finite. */
export function formulaNumber(value: string | number): FormulaValue {
	const decimal = typeof value === "number" && !Number.isFinite(value) ? null : parseDecimal(String(value))

	return decimal ? numberValue(decimal) : errorValue("#NUM!")
}

/** An argument as decimal text, as numbers are kept; null when it is no number. */
export function numberArgument(value: FormulaValue): string | null {
	const number = toNumber(value)

	return failed(number) ? null : decimalToText(number)
}

const TRUE: FormulaValue = Object.freeze({ type: "bool", value: true })
const FALSE: FormulaValue = Object.freeze({ type: "bool", value: false })
const HUNDRED = parseDecimal("100") as Decimal

type Failed = Extract<FormulaValue, { type: "error" }>

function failed(value: unknown): value is Failed {
	return typeof value === "object" && value !== null && (value as FormulaValue).type === "error"
}

// ---------------------------------------------------------------- coercions, as Excel makes them

/** Empty is 0, yes and no are 1 and 0, text that is a number is that number. */
export function toNumber(value: FormulaValue): Decimal | Failed {
	switch (value.type) {
		case "number":
			return value.value
		case "empty":
			return ZERO
		case "bool":
			return value.value ? ONE : ZERO
		case "text":
			return parseDecimal(value.value) ?? (errorValue("#VALUE!") as Failed)
		case "error":
			return value
	}
}

export function toText(value: FormulaValue): string | Failed {
	switch (value.type) {
		case "number":
			return decimalToText(value.value)
		case "empty":
			return ""
		case "bool":
			return value.value ? "TRUE" : "FALSE"
		case "text":
			return value.value
		case "error":
			return value
	}
}

export function toBool(value: FormulaValue): boolean | Failed {
	switch (value.type) {
		case "bool":
			return value.value
		case "number":
			return !isZero(value.value)
		case "empty":
			return false
		case "text": {
			const word = value.value.trim().toUpperCase()

			return word === "TRUE" ? true : word === "FALSE" ? false : (errorValue("#VALUE!") as Failed)
		}
		case "error":
			return value
	}
}

// ---------------------------------------------------------------- evaluation

/** Works a formula out. Never throws: what goes wrong is an error value, as in a spreadsheet. */
export function evaluate(node: FormulaNode, context: EvaluationContext): FormulaValue {
	switch (node.kind) {
		case "number":
			return numberValue(parseDecimal(node.value) ?? ZERO)
		case "text":
			return textValue(node.value)
		case "bool":
			return boolValue(node.value)
		case "field":
			return context.field(node.key)
		case "negate":
			return arithmetic(evaluate(node.operand, context), numberValue(ZERO), (a, b) => subtract(b, a))
		case "percent":
			return arithmetic(evaluate(node.operand, context), numberValue(HUNDRED), divide)
		case "binary":
			return binary(node.op, evaluate(node.left, context), evaluate(node.right, context))
		case "call":
			return call(node.name, node.args, context)
	}
}

function arithmetic(
	left: FormulaValue,
	right: FormulaValue,
	op: (a: Decimal, b: Decimal) => Decimal | null,
	nullError: FormulaErrorCode = "#DIV/0!"
): FormulaValue {
	const a = toNumber(left)

	if (failed(a)) {
		return a
	}

	const b = toNumber(right)

	if (failed(b)) {
		return b
	}

	const result = op(a, b)

	return result === null ? errorValue(nullError) : numberValue(result)
}

function binary(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
	switch (op) {
		case "+":
			return arithmetic(left, right, add)
		case "-":
			return arithmetic(left, right, subtract)
		case "*":
			return arithmetic(left, right, multiply)
		case "/":
			return arithmetic(left, right, divide)
		case "^":
			return arithmetic(left, right, power, "#NUM!")
		case "&": {
			const a = toText(left)

			if (failed(a)) {
				return a
			}

			const b = toText(right)

			return failed(b) ? b : textValue(a + b)
		}
		default: {
			const order = compareValues(left, right)

			if (failed(order)) {
				return order
			}

			return boolValue(
				op === "="
					? order === 0
					: op === "<>"
						? order !== 0
						: op === "<"
							? order < 0
							: op === ">"
								? order > 0
								: op === "<="
									? order <= 0
									: order >= 0
			)
		}
	}
}

/**
 * As Excel compares: numbers with numbers, text with text regardless of case, and across kinds
 * numbers before text before yes and no. Empty is 0, "" or FALSE, whatever the other side is.
 */
function compareValues(left: FormulaValue, right: FormulaValue): -1 | 0 | 1 | Failed {
	if (left.type === "error") {
		return left
	}

	if (right.type === "error") {
		return right
	}

	const a = left.type === "empty" ? emptyLike(right) : left
	const b = right.type === "empty" ? emptyLike(a) : right
	const rank = { number: 0, text: 1, bool: 2, empty: 0 } as const

	if (a.type !== b.type) {
		return rank[a.type as keyof typeof rank] < rank[b.type as keyof typeof rank] ? -1 : 1
	}

	if (a.type === "number" && b.type === "number") {
		return compare(a.value, b.value)
	}

	if (a.type === "text" && b.type === "text") {
		const x = a.value.toLowerCase()
		const y = b.value.toLowerCase()

		return x < y ? -1 : x > y ? 1 : 0
	}

	if (a.type === "bool" && b.type === "bool") {
		return a.value === b.value ? 0 : a.value ? 1 : -1
	}

	return 0
}

function emptyLike(other: FormulaValue): FormulaValue {
	return other.type === "text" ? textValue("") : other.type === "bool" ? FALSE : numberValue(ZERO)
}

// ---------------------------------------------------------------- functions

/** The functions every formula has. A function the application adds goes by its own name. */
export const FUNCTIONS: readonly string[] = [
	"ABS",
	"AND",
	"AVERAGE",
	"CONCAT",
	"IF",
	"IFERROR",
	"ISBLANK",
	"LEN",
	"MAX",
	"MIN",
	"NOT",
	"OR",
	"ROUND",
	"ROUNDDOWN",
	"ROUNDUP",
	"SUM"
]

function call(name: string, args: readonly FormulaNode[], context: EvaluationContext): FormulaValue {
	// The ones that work out only what they need, so IF(x > 0, 1 / x, 0) is never a division by zero.
	switch (name) {
		case "IF": {
			if (args.length < 2 || args.length > 3) {
				return errorValue("#VALUE!")
			}

			const condition = toBool(evaluate(args[0] as FormulaNode, context))

			if (failed(condition)) {
				return condition
			}

			const branch = condition ? args[1] : args[2]

			return branch ? evaluate(branch, context) : FALSE
		}
		case "IFERROR": {
			if (args.length !== 2) {
				return errorValue("#VALUE!")
			}

			const value = evaluate(args[0] as FormulaNode, context)

			return value.type === "error" ? evaluate(args[1] as FormulaNode, context) : value
		}
		case "ISBLANK":
			return args.length === 1
				? boolValue(evaluate(args[0] as FormulaNode, context).type === "empty")
				: errorValue("#VALUE!")
	}

	const values = args.map(arg => evaluate(arg, context))
	const builtIn = BUILT_IN[name]

	if (builtIn) {
		return builtIn(values)
	}

	const custom = context.functions[name]

	if (!custom) {
		return errorValue("#NAME?")
	}

	try {
		return custom(values)
	} catch {
		return errorValue("#VALUE!")
	}
}

/** The numbers among the arguments; an empty field is passed over, an error is the answer. */
function numbers(values: readonly FormulaValue[]): Decimal[] | Failed {
	const list: Decimal[] = []

	for (const value of values) {
		if (value.type === "empty") {
			continue
		}

		const number = toNumber(value)

		if (failed(number)) {
			return number
		}

		list.push(number)
	}

	return list
}

function rounding(mode: "half" | "up" | "down"): FormulaFunction {
	return values => {
		if (values.length < 1 || values.length > 2) {
			return errorValue("#VALUE!")
		}

		const value = toNumber(values[0] as FormulaValue)
		const places = toNumber(values[1] ?? numberValue(ZERO))

		if (failed(value)) {
			return value
		}

		if (failed(places)) {
			return places
		}

		// The places are a whole number, cut towards zero as Excel cuts them.
		const whole = Number(decimalToText(round(places, 0, "down")))

		return numberValue(round(value, whole, mode))
	}
}

function logical(all: boolean): FormulaFunction {
	return values => {
		if (values.length === 0) {
			return errorValue("#VALUE!")
		}

		let result = all

		for (const value of values) {
			const truth = toBool(value)

			if (failed(truth)) {
				return truth
			}

			result = all ? result && truth : result || truth
		}

		return boolValue(result)
	}
}

const BUILT_IN: Readonly<Record<string, FormulaFunction>> = {
	SUM: values => {
		const list = numbers(values)

		return failed(list) ? list : numberValue(list.reduce(add, ZERO))
	},
	AVERAGE: values => {
		const list = numbers(values)

		if (failed(list)) {
			return list
		}

		if (list.length === 0) {
			return errorValue("#DIV/0!")
		}

		const average = divide(list.reduce(add, ZERO), parseDecimal(String(list.length)) as Decimal)

		return average === null ? errorValue("#DIV/0!") : numberValue(average)
	},
	MIN: values => {
		const list = numbers(values)

		return failed(list) ? list : numberValue(list.reduce((a, b) => (compare(a, b) <= 0 ? a : b), list[0] ?? ZERO))
	},
	MAX: values => {
		const list = numbers(values)

		return failed(list) ? list : numberValue(list.reduce((a, b) => (compare(a, b) >= 0 ? a : b), list[0] ?? ZERO))
	},
	ROUND: rounding("half"),
	ROUNDUP: rounding("up"),
	ROUNDDOWN: rounding("down"),
	ABS: values => {
		if (values.length !== 1) {
			return errorValue("#VALUE!")
		}

		const value = toNumber(values[0] as FormulaValue)

		return failed(value) ? value : numberValue(absolute(value))
	},
	AND: logical(true),
	OR: logical(false),
	NOT: values => {
		if (values.length !== 1) {
			return errorValue("#VALUE!")
		}

		const truth = toBool(values[0] as FormulaValue)

		return failed(truth) ? truth : boolValue(!truth)
	},
	LEN: values => {
		if (values.length !== 1) {
			return errorValue("#VALUE!")
		}

		const text = toText(values[0] as FormulaValue)

		return failed(text) ? text : numberValue(parseDecimal(String(Array.from(text).length)) as Decimal)
	},
	CONCAT: values => {
		let text = ""

		for (const value of values) {
			const part = toText(value)

			if (failed(part)) {
				return part
			}

			text += part
		}

		return textValue(text)
	}
}
