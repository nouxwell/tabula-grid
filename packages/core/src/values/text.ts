/**
 * The text rules every reader shares, written as nouxwell/tabula's `StringParser` writes them, so
 * the two sides call the same cell empty and compare the same two words as equal.
 */

const INVISIBLE_SPACES = /[\u00A0\u202F\u2009\uFEFF]/g

// PHP's trim(): space, tab, line breaks, NUL and vertical tab. JavaScript's own trim() also takes
// every other Unicode space, and the two sides would then disagree on what a cell holds.
// eslint-disable-next-line no-control-regex
const PHP_TRIM = /^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g

export function phpTrim(text: string): string {
	return text.replace(PHP_TRIM, "")
}

/** Invisible spaces become ordinary ones, then the ends are trimmed: what a cell really holds. */
export function clean(text: string): string {
	return phpTrim(text.replace(INVISIBLE_SPACES, " "))
}

/**
 * The form two words are compared in: cleaned and lower-cased.
 *
 * Lower-cased without a locale, as `mb_strtolower()` does. That keeps the comparison the same on
 * every machine, and it also means "AÇIK" does not meet "açık": the I's lower case is "i", not "ı".
 */
export function fold(text: string): string {
	return clean(text).toLowerCase()
}

export function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")
}
