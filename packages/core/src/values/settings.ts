import { TabulaError } from "../errors"
import { compilePattern } from "./date"
import { fold } from "./text"

/**
 * How values are written and read in one language: separators, digits, currency symbols, date
 * patterns and the words for yes and no.
 *
 * The same settings as nouxwell/tabula's `NumberSettings`, `DateSettings` and bool words, so a
 * value a template wrote in Turkish is read back here as the PHP side reads it.
 */
export interface ValueSettings {
	readonly decimalSeparator: string
	readonly thousandSeparator: string
	/** Digits after the point for a decimal field that does not set its own. */
	readonly decimalDigits: number
	readonly quantityDigits: number
	readonly moneyDigits: number
	readonly percentDigits: number
	/** Currency code to symbol, such as `{ TRY: "₺" }`. A code with no symbol is shown as the code. */
	readonly currencySymbols: Readonly<Record<string, string>>
	/** Where a money cell's symbol goes, or `none` for no symbol. */
	readonly symbolPosition: "before" | "after" | "none"
	/** In PHP's notation: `d.m.Y`. The tokens read are d, j, m, n, Y, y, H, G, i and s. */
	readonly datePattern: string
	readonly dateTimePattern: string
	readonly trueWord: string
	readonly falseWord: string
}

const SYMBOLS = Object.freeze({ TRY: "₺", USD: "$", EUR: "€", GBP: "£" })

export const VALUE_SETTINGS: Readonly<{ tr: ValueSettings; en: ValueSettings }> = Object.freeze({
	/** nouxwell/tabula's own defaults, with the Turkish words for yes and no. */
	tr: Object.freeze({
		decimalSeparator: ",",
		thousandSeparator: ".",
		decimalDigits: 2,
		quantityDigits: 3,
		moneyDigits: 2,
		percentDigits: 2,
		currencySymbols: SYMBOLS,
		symbolPosition: "after",
		datePattern: "d.m.Y",
		dateTimePattern: "d.m.Y H:i",
		trueWord: "Evet",
		falseWord: "Hayır"
	}),
	/** English separators, with ISO dates: "05/03" reads two ways in English, "2026-03-05" one. */
	en: Object.freeze({
		decimalSeparator: ".",
		thousandSeparator: ",",
		decimalDigits: 2,
		quantityDigits: 3,
		moneyDigits: 2,
		percentDigits: 2,
		currencySymbols: SYMBOLS,
		symbolPosition: "before",
		datePattern: "Y-m-d",
		dateTimePattern: "Y-m-d H:i",
		trueWord: "Yes",
		falseWord: "No"
	})
})

/**
 * Settings from a base with some of them changed, checked.
 *
 * @throws TabulaError when the settings would make values ambiguous, such as the same separator
 * for decimals and thousands
 */
export function defineValueSettings(
	changes: Partial<ValueSettings>,
	base: ValueSettings = VALUE_SETTINGS.tr
): ValueSettings {
	const settings: ValueSettings = { ...base, ...changes }
	const refuse = (message: string): never => {
		throw new TabulaError("invalid_argument", `Value settings: ${message}`)
	}

	if (settings.decimalSeparator === "" || /\d/.test(settings.decimalSeparator + settings.thousandSeparator)) {
		refuse("the decimal separator must be given, and neither separator may hold a digit.")
	}

	if (settings.decimalSeparator === settings.thousandSeparator) {
		refuse(`"${settings.decimalSeparator}" cannot separate both decimals and thousands.`)
	}

	for (const name of ["decimalDigits", "quantityDigits", "moneyDigits", "percentDigits"] as const) {
		if (!Number.isSafeInteger(settings[name]) || settings[name] < 0) {
			refuse(`${name} must be a whole number, 0 or more; got ${settings[name]}.`)
		}
	}

	for (const name of ["datePattern", "dateTimePattern"] as const) {
		if (compilePattern(settings[name]) === null) {
			refuse(`${name} "${settings[name]}" uses a letter that is not one of d, j, m, n, Y, y, H, G, i, s.`)
		}
	}

	if (fold(settings.trueWord) === "" || fold(settings.trueWord) === fold(settings.falseWord)) {
		refuse("the words for yes and no must be given, and must differ.")
	}

	return Object.freeze({ ...settings, currencySymbols: Object.freeze({ ...settings.currencySymbols }) })
}
