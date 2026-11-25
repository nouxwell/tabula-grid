/**
 * What "=" typed into a cell, or into the formula bar, needs: the suggestions as it is written, the
 * call's help, the fields it reads to colour, and its result for the cell's row in words. The
 * formula is written with the fields' labels in brackets or their columns' letters, as the user sees
 * them; it is read with their keys.
 */
import {
	FORMULA_FUNCTIONS,
	formatCell,
	formulaCaret,
	formulaFromAddresses,
	formulaParts,
	formulaWithKeys,
	workOutCell,
	type CellFormulaOptions,
	type CellValue,
	type FieldSchema
} from "@nouxwell/tabula-core"
import { fieldKindWord, formulaReason, functionHelp, GRID_TEXT, valueProblemText, type GridLocale } from "./messages.js"

/** A column as it stands on screen: what an address names, and what a suggestion offers. */
export interface EntryColumn {
	readonly key: string
	readonly label: string
	readonly type: FieldSchema["type"]
	/** Its letter, A first. */
	readonly letter: string
}

export interface EntrySuggestion {
	readonly label: string
	readonly detail: string
	/** A column's letter; null for a function. */
	readonly letter: string | null
	/** What is put in place of `start`..`end`. */
	readonly insert: string
}

export interface EntryHint {
	/** The call as "ROUND(sayı; basamak)" in pieces, the argument being written `current`. */
	readonly parts: readonly { readonly text: string; readonly current: boolean }[]
	readonly text: string
}

export interface EntryHelp {
	readonly title: string
	readonly items: readonly EntrySuggestion[]
	/** The stretch of the text a suggestion replaces. */
	readonly start: number
	readonly end: number
	readonly hint: EntryHint | null
}

const LIMIT = 8

/** Whether text typed into a cell is a formula: it starts with "=", with something after it. */
export function isEntryFormula(text: string): boolean {
	return text.startsWith("=")
}

/** Folded as a reader of the sheet's language folds: "I" is "ı" in Turkish. */
function fold(text: string, locale: GridLocale): string {
	return text.toLocaleLowerCase(locale)
}

/** Suggestions and the call's help for a formula being written, the caret at `caret`. */
export function entryHelp(
	text: string,
	caret: number,
	columns: readonly EntryColumn[],
	locale: GridLocale,
	comma: boolean
): EntryHelp {
	const words = GRID_TEXT[locale]
	const context = formulaCaret(text, caret, { decimalSeparator: comma ? "," : "." })
	const token = context.token
	const hint = hintFor(context.call, locale, comma)
	let items: EntrySuggestion[] = []
	let title = ""

	if (token?.kind === "field") {
		const needle = fold(token.query.trim(), locale)

		title = words.formulaFields ?? ""
		items = columns
			.filter(column => needle === "" || fold(column.label, locale).includes(needle))
			// Those whose label starts with what is typed first.
			.sort(
				(a, b) =>
					Number(!fold(a.label, locale).startsWith(needle)) -
					Number(!fold(b.label, locale).startsWith(needle))
			)
			.slice(0, LIMIT)
			.map(column => ({
				label: column.label,
				detail: fieldKindWord(column.type, locale),
				letter: column.letter,
				insert: `[${column.label}]`
			}))
	} else if (token?.kind === "function") {
		const prefix = token.query.toUpperCase()
		// "C" or "C5": the field of that column, in this row, before the functions.
		const address = /^([A-Z]{1,3})[0-9]*$/.exec(prefix)
		const column = address ? columns.find(each => each.letter === address[1]) : undefined
		const functions = FORMULA_FUNCTIONS.filter(name => name.startsWith(prefix) && name !== prefix)
			.slice(0, column ? LIMIT - 1 : LIMIT)
			.map(name => ({
				label: name,
				detail: functionHelp(name, locale)?.short ?? "",
				letter: null,
				insert: `${name}(`
			}))

		title = (column ? words.formulaColumnsAndFunctions : words.formulaFunctions) ?? ""
		items = column
			? [
					{
						label: column.label,
						detail: words.formulaThisRow ?? "",
						letter: column.letter,
						insert: `[${column.label}]`
					},
					...functions
				]
			: functions
	}

	return { title, items, start: token?.start ?? caret, end: token?.end ?? caret, hint }
}

function hintFor(
	call: { name: string; argument: number } | null,
	locale: GridLocale,
	comma: boolean
): EntryHint | null {
	const help = call ? functionHelp(call.name, locale) : null

	if (!call || !help) {
		return null
	}

	const current = Math.min(call.argument, help.params.length - 1)
	const parts = [{ text: `${call.name}(`, current: false }]

	help.params.forEach((param, index) => {
		if (index > 0) {
			parts.push({ text: comma ? "; " : ", ", current: false })
		}

		parts.push({ text: param, current: index === current })
	})
	parts.push({ text: ")", current: false })

	return { parts, text: help.text }
}

/** The formula with its fields by key, as it is worked out: letters and labels read as the columns stand. */
export function entryWithKeys(text: string, columns: readonly EntryColumn[]): string {
	return formulaWithKeys(formulaFromAddresses(text, columns), columns)
}

/** The fields a formula being written reads, each once, in order: the columns to colour. */
export function entryReferences(text: string, columns: readonly EntryColumn[]): string[] {
	const keys = new Set(columns.map(column => column.key))
	const read = formulaParts(entryWithKeys(text, columns), columns)
		.filter(part => part.field !== null && part.sheet === undefined && keys.has(part.field))
		.map(part => part.field as string)

	return [...new Set(read)]
}

/**
 * Whether a click on a cell, with the caret here, writes that cell's column into the formula, as
 * pointing does in Excel: where a value is expected, after "=", an operator, "(" or a separator.
 */
export function entryPoints(text: string, caret: number, comma: boolean): boolean {
	const before = text.slice(0, caret).trimEnd()
	const last = before.charAt(before.length - 1)

	return isEntryFormula(text) && (comma ? "=+-*/^&(;<>" : "=+-*/^&(;,<>").includes(last)
}

/** A formula with the parentheses it leaves open closed at its end; text in quotes and fields passed over. */
function closed(formula: string): string {
	let open = 0
	let quote = false
	let field = false

	for (const char of formula) {
		if (quote) {
			quote = char !== '"'
		} else if (field) {
			field = char !== "]"
		} else if (char === '"') {
			quote = true
		} else if (char === "[") {
			field = true
		} else if (char === "(") {
			open++
		} else if (char === ")") {
			open--
		}
	}

	return quote || field || open <= 0 ? formula : `${formula}${")".repeat(open)}`
}

/** A formula's result for its cell, in words: the value it writes, or why it writes none. */
export interface EntryResult {
	readonly ok: boolean
	/** The value to write, when `ok`. */
	readonly value: CellValue
	readonly text: string
}

export function entryResult(
	text: string,
	columns: readonly EntryColumn[],
	options: CellFormulaOptions,
	locale: GridLocale
): EntryResult {
	const words = GRID_TEXT[locale]
	// As Excel does on Enter, the parentheses left open are closed.
	const formula = closed(entryWithKeys(text, columns))
	const result = workOutCell(formula, options)
	const fail = (reason: string): EntryResult => ({ ok: false, value: null, text: reason })

	switch (result.status) {
		case "value": {
			const shown = formatCell(options.schema.field(options.field), result.value, options.settings)

			return { ok: true, value: result.value, text: shown === "" ? (words.formulaEmpty ?? "") : shown }
		}
		case "invalid": {
			const char = formula.charAt(result.at)
			const rest = formula.slice(result.at)
			const comma = options.settings.decimalSeparator === ","

			// Still being written: nothing more, a name with no "(" yet, a field or a text not closed.
			if (
				char === "" ||
				/^[A-Za-z_][A-Za-z0-9_.]*\s*$/.test(rest) ||
				(char === "[" && !rest.includes("]")) ||
				(char === '"' && !rest.slice(1).includes('"'))
			) {
				return fail(words.formulaUnfinished ?? "")
			}

			// The usual slip: a separator or a decimal point of the other language.
			if (comma && char === ",") {
				return fail(words.formulaUseSemicolon ?? "")
			}

			if (comma && char === ".") {
				return fail(words.formulaUseComma ?? "")
			}

			return fail((words.formulaUnexpected ?? "").replace("{char}", char))
		}
		case "unknown":
			return fail((words.formulaUnknown ?? "").replace("{name}", result.name))
		case "error": {
			const reason = formulaReason(result.error, locale)

			return fail(reason ? `${result.error} · ${reason}` : result.error)
		}
		case "unfit":
			return fail(valueProblemText(result.problem, locale, options.settings))
	}
}
