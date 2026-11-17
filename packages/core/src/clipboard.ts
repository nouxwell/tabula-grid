/**
 * Cells as a spreadsheet puts them on the clipboard: separated by tabs, rows separated by line
 * breaks. A cell holding a tab, a line break or a quote is wrapped in quotes, its own quotes doubled.
 * Excel, Google Sheets and LibreOffice all write this and read it back.
 */

/**
 * The rows and cells in clipboard text.
 *
 * One line break at the very end ends the last row rather than starting another: Excel puts one
 * after every copied range. Rows may differ in length; nothing is padded. A line break inside a
 * quoted cell is always "\n", however it arrived.
 *
 * A quote opens a quoted cell only at the start of a cell. One that never closes was a character,
 * not a wrapper, and the cell is read again from it as plain text: otherwise a cell that merely
 * starts with `"` would swallow every row after it.
 */
export function parseTsv(text: string): string[][] {
	if (text === "") {
		return []
	}

	const rows: string[][] = []
	let row: string[] = []
	let cell = ""
	let index = 0
	let cellStart = true
	let quoteAt = -1
	let literalAt = -1

	for (;;) {
		while (index < text.length) {
			const char = text.charAt(index)

			if (quoteAt >= 0) {
				if (char === '"') {
					if (text.charAt(index + 1) === '"') {
						cell += '"'
						index += 2
					} else {
						quoteAt = -1
						index++
					}
				} else if (char === "\r") {
					// One way of writing a line break inside a cell. The Windows clipboard turns "\n" into
					// "\r\n" on the way through, so the same text would otherwise arrive two ways.
					cell += "\n"
					index += text.charAt(index + 1) === "\n" ? 2 : 1
				} else {
					cell += char
					index++
				}

				continue
			}

			if (char === '"' && cellStart && index !== literalAt) {
				quoteAt = index
				cellStart = false
				index++

				continue
			}

			if (char === "\t") {
				row.push(cell)
				cell = ""
				cellStart = true
				index++

				continue
			}

			if (char === "\n" || char === "\r") {
				row.push(cell)
				rows.push(row)
				row = []
				cell = ""
				cellStart = true
				index += char === "\r" && text.charAt(index + 1) === "\n" ? 2 : 1

				if (index >= text.length) {
					return rows
				}

				continue
			}

			cell += char
			cellStart = false
			index++
		}

		if (quoteAt < 0) {
			break
		}

		literalAt = quoteAt
		index = quoteAt
		quoteAt = -1
		cell = ""
		cellStart = true
	}

	row.push(cell)
	rows.push(row)

	return rows
}

/** Rows of cells as clipboard text, quoting the cells that need it. No line break after the last row. */
export function toTsv(rows: readonly (readonly string[])[]): string {
	return rows.map(row => row.map(quoteCell).join("\t")).join("\r\n")
}

function quoteCell(text: string): string {
	return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
