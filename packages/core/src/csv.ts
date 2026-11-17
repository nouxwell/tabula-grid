/**
 * CSV as spreadsheets write it (RFC 4180): cells separated by a delimiter, rows by line breaks, a
 * cell holding the delimiter, a quote or a line break wrapped in quotes, its own quotes doubled.
 *
 * Which delimiter depends on who wrote the file. Excel uses the list separator of the machine's
 * language, and in Turkish, where the comma is the decimal separator, that is a semicolon.
 */

export type CsvDelimiter = "," | ";" | "\t"

const DELIMITERS: readonly CsvDelimiter[] = [";", ",", "\t"]

export interface CsvReadOptions {
	/** Left out, it is told from the first line: whichever of `;`, `,` and tab splits it most. */
	readonly delimiter?: CsvDelimiter
}

/**
 * The rows and cells of CSV text. A byte order mark at the start is dropped, line breaks are
 * `\r\n` or `\n`, a line break inside a quoted cell is kept as `\n`, and the line break that ends the
 * last row starts no other. Empty lines are rows with one empty cell, as in the file.
 */
export function parseCsv(text: string, options: CsvReadOptions = {}): string[][] {
	const source = text.startsWith("\uFEFF") ? text.slice(1) : text

	if (source === "") {
		return []
	}

	const delimiter = options.delimiter ?? detectDelimiter(source)
	const rows: string[][] = []
	let row: string[] = []
	let cell = ""
	let quoted = false
	// Whether the row has begun: a last row of one empty quoted cell is still a row.
	let started = false
	let index = 0

	const endCell = (): void => {
		row.push(cell)
		cell = ""
	}

	const endRow = (): void => {
		endCell()
		rows.push(row)
		row = []
		started = false
	}

	while (index < source.length) {
		const char = source.charAt(index)

		started = true

		if (quoted) {
			if (char === '"') {
				if (source.charAt(index + 1) === '"') {
					cell += '"'
					index += 2
				} else {
					quoted = false
					index++
				}
			} else if (char === "\r") {
				cell += "\n"
				index += source.charAt(index + 1) === "\n" ? 2 : 1
			} else {
				cell += char
				index++
			}

			continue
		}

		if (char === '"' && cell === "") {
			quoted = true
			index++
		} else if (char === delimiter) {
			endCell()
			index++
		} else if (char === "\r" || char === "\n") {
			endRow()
			index += char === "\r" && source.charAt(index + 1) === "\n" ? 2 : 1
		} else {
			cell += char
			index++
		}
	}

	// The last row, unless the text ended with its line break.
	if (started) {
		endRow()
	}

	return rows
}

/** The delimiter that splits the first line into the most cells, quotes respected. A semicolon wins a tie. */
export function detectDelimiter(text: string): CsvDelimiter {
	const counts = new Map<CsvDelimiter, number>(DELIMITERS.map(delimiter => [delimiter, 0]))
	let quoted = false

	for (const char of text) {
		if (char === '"') {
			quoted = !quoted
		} else if (!quoted && (char === "\n" || char === "\r")) {
			break
		} else if (!quoted && counts.has(char as CsvDelimiter)) {
			counts.set(char as CsvDelimiter, (counts.get(char as CsvDelimiter) ?? 0) + 1)
		}
	}

	let best: CsvDelimiter = ";"

	for (const delimiter of DELIMITERS) {
		if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) {
			best = delimiter
		}
	}

	return best
}

export interface CsvWriteOptions {
	readonly delimiter?: CsvDelimiter
	/** A byte order mark at the start, which Excel needs to read the text as UTF-8. True by default. */
	readonly bom?: boolean
}

/** CSV text for rows of cells, lines ending in `\r\n` as RFC 4180 and Excel have them. */
export function toCsv(rows: readonly (readonly string[])[], options: CsvWriteOptions = {}): string {
	const delimiter = options.delimiter ?? ","
	const special = new RegExp(`["\\r\\n${delimiter === "\t" ? "\\t" : delimiter}]`)
	const text = rows
		.map(row => row.map(cell => (special.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(delimiter))
		.join("\r\n")

	return `${options.bom === false ? "" : "\uFEFF"}${text}\r\n`
}

/**
 * The text in a file's bytes: UTF-8 when they are UTF-8, otherwise the code page given, Windows-1254
 * by default, which is what Excel writes a Turkish "CSV" in.
 */
export function decodeText(bytes: Uint8Array, fallback = "windows-1254"): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
	} catch {
		return new TextDecoder(fallback).decode(bytes)
	}
}
