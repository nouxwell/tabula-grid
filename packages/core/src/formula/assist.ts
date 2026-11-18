/**
 * Help for a person writing a formula: what is being typed where the caret is, which function the
 * caret is inside and at which of its arguments, and the formula written with the fields' labels in
 * place of their keys and back. A formula editor builds its suggestions and its hints from these;
 * the formula itself, and what is saved, is unchanged.
 */

/** A field and the words a person knows it by. */
export interface NamedField {
	readonly key: string
	readonly label: string
}

/** What is being typed at the caret, to be completed: a field after "[", or a function's name. */
export interface FormulaToken {
	readonly kind: "field" | "function"
	/** What is typed so far, without the "[". */
	readonly query: string
	/** The text a completion replaces: from the "[" or the name's first letter to where it ends. */
	readonly start: number
	readonly end: number
}

/** The function call the caret is inside, by its name in capitals, and at which argument, from 0. */
export interface FormulaCall {
	readonly name: string
	readonly argument: number
}

export interface FormulaCaret {
	readonly token: FormulaToken | null
	readonly call: FormulaCall | null
}

const NAME_START = /[A-Za-z_]/
const NAME_PART = /[A-Za-z0-9_.]/

/**
 * Reads a formula up to the caret as the parser would: text in quotes and fields in brackets are
 * passed over, parentheses open and close calls, commas and semicolons move to the next argument.
 */
export function formulaCaret(text: string, caret: number): FormulaCaret {
	const end = Math.max(0, Math.min(caret, text.length))
	const calls: { name: string | null; argument: number }[] = []
	let inText = false
	let fieldAt = -1
	let name = ""

	for (let at = 0; at < end; at++) {
		const char = text.charAt(at)

		if (inText) {
			if (char === '"') {
				if (text.charAt(at + 1) === '"' && at + 1 < end) {
					at++
				} else {
					inText = false
				}
			}

			continue
		}

		if (fieldAt >= 0) {
			if (char === "]") {
				fieldAt = -1
			}

			continue
		}

		if (char === '"') {
			inText = true
			name = ""
		} else if (char === "[") {
			fieldAt = at
			name = ""
		} else if (char === "(") {
			calls.push({ name: name === "" ? null : name.toUpperCase(), argument: 0 })
			name = ""
		} else if (char === ")") {
			calls.pop()
			name = ""
		} else if (char === "," || char === ";") {
			const innermost = calls[calls.length - 1]

			if (innermost) {
				innermost.argument++
			}

			name = ""
		} else if (name === "" ? NAME_START.test(char) : NAME_PART.test(char)) {
			name += char
		} else {
			name = ""
		}
	}

	return { token: tokenAt(text, end, inText, fieldAt, name), call: callOf(calls) }
}

/** The formula with each field it reads written by its label: "[Aralık fiyatı] * 1.2". */
export function formulaWithLabels(formula: string, fields: readonly NamedField[]): string {
	const labels = new Map(fields.map(field => [field.key, field.label]))

	return mapFields(formula, name => labels.get(name) ?? name)
}

/**
 * The formula with each field written by its key again, as it is saved. A name that is a key stays
 * one; a label names the field only when no other field has it, and is left as written otherwise,
 * for the formula to say it reads a field the schema does not have.
 */
export function formulaWithKeys(text: string, fields: readonly NamedField[]): string {
	const keys = new Set(fields.map(field => field.key))
	const byLabel = new Map<string, string | null>()

	for (const field of fields) {
		byLabel.set(field.label, byLabel.has(field.label) ? null : field.key)
	}

	return mapFields(text, name => (keys.has(name) ? name : (byLabel.get(name) ?? name)))
}

// ---------------------------------------------------------------- inside

function tokenAt(text: string, caret: number, inText: boolean, fieldAt: number, name: string): FormulaToken | null {
	if (inText) {
		return null
	}

	if (fieldAt >= 0) {
		// Editing inside "[Mevcut fi|yat]": the completion replaces the whole reference.
		const close = text.indexOf("]", caret)
		const open = text.indexOf("[", caret)
		const end = close >= 0 && (open < 0 || close < open) ? close + 1 : caret

		return { kind: "field", query: text.slice(fieldAt + 1, caret), start: fieldAt, end }
	}

	if (name === "" || /^[0-9.]/.test(name)) {
		return null
	}

	let end = caret

	while (end < text.length && NAME_PART.test(text.charAt(end))) {
		end++
	}

	return { kind: "function", query: name, start: caret - name.length, end }
}

/** The innermost call with a name: inside "ROUND((a - b) / c" it is ROUND, at its first argument. */
function callOf(calls: readonly { name: string | null; argument: number }[]): FormulaCall | null {
	for (let index = calls.length - 1; index >= 0; index--) {
		const call = calls[index]

		if (call?.name) {
			return { name: call.name, argument: call.argument }
		}
	}

	return null
}

/** Rewrites every field reference outside quotes; text in quotes is left as it is. */
function mapFields(formula: string, map: (name: string) => string): string {
	let result = ""
	let inText = false

	for (let at = 0; at < formula.length; at++) {
		const char = formula.charAt(at)

		if (inText) {
			result += char

			if (char === '"') {
				if (formula.charAt(at + 1) === '"') {
					result += '"'
					at++
				} else {
					inText = false
				}
			}

			continue
		}

		if (char === '"') {
			inText = true
			result += char
			continue
		}

		if (char === "[") {
			const close = formula.indexOf("]", at + 1)

			if (close < 0) {
				result += formula.slice(at)
				break
			}

			result += `[${map(formula.slice(at + 1, close))}]`
			at = close
			continue
		}

		result += char
	}

	return result
}
