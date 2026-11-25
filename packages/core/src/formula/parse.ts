import { TabulaError } from "../errors.js"

/**
 * The formula language: what a spreadsheet user already writes, minus cell addresses. A formula
 * reads the fields of its own row by key, in brackets, and never runs code: it is parsed into a tree
 * and that tree is evaluated, so no text a user writes is ever executed.
 *
 *     ROUND(([newPrice] - [currentPrice]) / [currentPrice] * 100, 1)
 *     IF([quantity] > 0, [price] * [quantity], "")
 *
 * Numbers use a point, function names are English, arguments are separated by commas or by
 * semicolons, as a Turkish Excel separates them. A leading `=` is allowed and means nothing.
 */

export type BinaryOperator = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">="

export type FormulaNode =
	| { readonly kind: "number"; readonly value: string }
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "bool"; readonly value: boolean }
	| { readonly kind: "field"; readonly key: string }
	| { readonly kind: "call"; readonly name: string; readonly args: readonly FormulaNode[] }
	| { readonly kind: "negate"; readonly operand: FormulaNode }
	| { readonly kind: "percent"; readonly operand: FormulaNode }
	| { readonly kind: "binary"; readonly op: BinaryOperator; readonly left: FormulaNode; readonly right: FormulaNode }

type Token =
	| { readonly kind: "number" | "text" | "field" | "name"; readonly text: string; readonly at: number }
	| { readonly kind: "op"; readonly text: string; readonly at: number }
	| { readonly kind: "end"; readonly text: ""; readonly at: number }

/** Lowest first. Exponents are left to right, and a minus sign binds tighter than them, as in Excel. */
const LEVELS: readonly (readonly string[])[] = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]]

/**
 * Parses a formula.
 *
 * @throws TabulaError `invalid_formula`, saying where the text stopped making sense
 */
export function parseFormula(source: string): FormulaNode {
	const tokens = tokenize(source)
	let at = 0
	const peek = (): Token => tokens[at] as Token
	const next = (): Token => tokens[at++] as Token
	const fail = (token: Token, message: string): never => {
		throw new TabulaError("invalid_formula", `${message} at character ${token.at + 1} of "${source}".`)
	}

	const binary = (level: number): FormulaNode => {
		if (level >= LEVELS.length) {
			return unary()
		}

		let left = binary(level + 1)

		while (peek().kind === "op" && (LEVELS[level] as readonly string[]).includes(peek().text)) {
			const op = next().text as BinaryOperator

			left = Object.freeze({ kind: "binary", op, left, right: binary(level + 1) })
		}

		return left
	}

	const unary = (): FormulaNode => {
		const token = peek()

		if (token.kind === "op" && (token.text === "-" || token.text === "+")) {
			next()

			const operand = unary()

			return token.text === "-" ? Object.freeze({ kind: "negate", operand }) : operand
		}

		return postfix()
	}

	const postfix = (): FormulaNode => {
		let node = primary()

		while (peek().kind === "op" && peek().text === "%") {
			next()
			node = Object.freeze({ kind: "percent", operand: node })
		}

		return node
	}

	const primary = (): FormulaNode => {
		const token = next()

		switch (token.kind) {
			case "number":
				return Object.freeze({ kind: "number", value: token.text })
			case "text":
				return Object.freeze({ kind: "text", value: token.text })
			case "field":
				return Object.freeze({ kind: "field", key: token.text })
			case "name": {
				const name = token.text.toUpperCase()

				if (peek().kind === "op" && peek().text === "(") {
					next()

					return Object.freeze({ kind: "call", name, args: Object.freeze(callArgs()) })
				}

				if (name === "TRUE" || name === "FALSE") {
					return Object.freeze({ kind: "bool", value: name === "TRUE" })
				}

				return fail(
					token,
					`"${token.text}" is neither a function, which takes parentheses, nor TRUE or FALSE; a field is written in brackets, [${token.text}]`
				)
			}
			case "op":
				if (token.text === "(") {
					const inner = binary(0)

					if (next().text !== ")") {
						fail(tokens[at - 1] as Token, 'A ")" is missing')
					}

					return inner
				}

				return fail(token, `"${token.text}" cannot start a value`)
			case "end":
				return fail(token, "The formula ends where a value is expected")
		}
	}

	const callArgs = (): FormulaNode[] => {
		const args: FormulaNode[] = []

		if (peek().kind === "op" && peek().text === ")") {
			next()

			return args
		}

		for (;;) {
			args.push(binary(0))

			const token = next()

			if (token.kind === "op" && token.text === ")") {
				return args
			}

			if (!(token.kind === "op" && (token.text === "," || token.text === ";"))) {
				fail(token, 'A "," or a ")" is expected')
			}
		}
	}

	const tree = binary(0)

	if (peek().kind !== "end") {
		fail(peek(), `"${peek().text}" is not expected here`)
	}

	return tree
}

/** The field keys a formula reads, each once, in the order they first appear. */
export function formulaFields(node: FormulaNode): string[] {
	const keys = new Set<string>()
	const walk = (current: FormulaNode): void => {
		switch (current.kind) {
			case "field":
				keys.add(current.key)
				break
			case "call":
				// SHEET's second argument names a field of another sheet: this row's is not read.
				current.args.forEach((arg, at) => {
					if (!(current.name === "SHEET" && at === 1)) {
						walk(arg)
					}
				})
				break
			case "negate":
			case "percent":
				walk(current.operand)
				break
			case "binary":
				walk(current.left)
				walk(current.right)
				break
		}
	}

	walk(node)

	return [...keys]
}

/** The sheets a formula's SHEET calls name, as written: "Mart" in SHEET("Mart"; [Yeni fiyat]). */
export function formulaSheets(node: FormulaNode): string[] {
	const names = new Set<string>()
	const walk = (current: FormulaNode): void => {
		switch (current.kind) {
			case "call":
				if (current.name === "SHEET" && current.args[0]?.kind === "text") {
					names.add(current.args[0].value)
				}

				current.args.forEach(walk)
				break
			case "negate":
			case "percent":
				walk(current.operand)
				break
			case "binary":
				walk(current.left)
				walk(current.right)
				break
		}
	}

	walk(node)

	return [...names]
}

/**
 * A formula with a sheet's new name in its SHEET calls, the rest as it was written: when a tab is
 * renamed, the formulas that name it follow. Only a name written as text in SHEET's first place
 * changes; `"Mart"` elsewhere in the formula stays.
 */
export function withSheetRenamed(source: string, from: string, to: string): string {
	const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`
	const call = new RegExp(`(SHEET\\s*\\(\\s*)${escapeRegExp(quoted(from))}(?=\\s*[;,)])`, "gi")

	return source.replace(call, (_, opening: string) => `${opening}${quoted(to)}`)
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whether a formula reads another sheet. */
export function readsSheets(node: FormulaNode): boolean {
	let found = false
	const walk = (current: FormulaNode): void => {
		if (current.kind === "call") {
			found ||= current.name === "SHEET"
			current.args.forEach(walk)
		} else if (current.kind === "negate" || current.kind === "percent") {
			walk(current.operand)
		} else if (current.kind === "binary") {
			walk(current.left)
			walk(current.right)
		}
	}

	walk(node)

	return found
}

const TWO_CHARACTER = ["<>", "<=", ">="]
const ONE_CHARACTER = "+-*/^&=<>(),;%"

function tokenize(source: string): Token[] {
	const tokens: Token[] = []
	let at = source.trimStart().startsWith("=") ? source.indexOf("=") + 1 : 0

	const fail = (where: number, message: string): never => {
		throw new TabulaError("invalid_formula", `${message} at character ${where + 1} of "${source}".`)
	}

	while (at < source.length) {
		const char = source.charAt(at)

		if (/\s/.test(char)) {
			at++
			continue
		}

		const start = at

		if (/\d/.test(char) || (char === "." && /\d/.test(source.charAt(at + 1)))) {
			const match = /^\d*(?:\.\d+)?/.exec(source.slice(at)) as RegExpExecArray

			at += match[0].length
			tokens.push({ kind: "number", text: match[0].startsWith(".") ? `0${match[0]}` : match[0], at: start })
		} else if (char === '"') {
			let text = ""

			at++

			for (;;) {
				if (at >= source.length) {
					fail(start, "A text is not closed with a quote")
				}

				const next = source.charAt(at)

				if (next === '"') {
					if (source.charAt(at + 1) === '"') {
						text += '"'
						at += 2
						continue
					}

					at++
					break
				}

				text += next
				at++
			}

			tokens.push({ kind: "text", text, at: start })
		} else if (char === "[") {
			const close = source.indexOf("]", at)

			if (close < 0) {
				fail(start, 'A field is not closed with "]"')
			}

			const key = source.slice(at + 1, close).trim()

			if (key === "") {
				fail(start, "A field has no key between its brackets")
			}

			tokens.push({ kind: "field", text: key, at: start })
			at = close + 1
		} else if (/[A-Za-z_]/.test(char)) {
			const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(at)) as RegExpExecArray

			at += match[0].length
			tokens.push({ kind: "name", text: match[0], at: start })
		} else if (TWO_CHARACTER.includes(source.slice(at, at + 2))) {
			tokens.push({ kind: "op", text: source.slice(at, at + 2), at: start })
			at += 2
		} else if (ONE_CHARACTER.includes(char)) {
			tokens.push({ kind: "op", text: char, at: start })
			at++
		} else {
			fail(start, `"${char}" has no meaning in a formula`)
		}
	}

	tokens.push({ kind: "end", text: "", at: source.length })

	return tokens
}
