/**
 * Cell addresses as a spreadsheet writes them: a column's letters, then the row's number, "D9".
 *
 * The letters follow the columns as they are on screen, the pinned ones first, and the number is
 * the row's number in the sheet, as the row headers show it.
 */

/** A column's letters for its place on screen, from 0: A … Z, AA … AZ, BA … */
export function columnName(index: number): string {
	let name = ""

	for (let n = Math.floor(index) + 1; n > 0; n = Math.floor((n - 1) / 26)) {
		name = String.fromCharCode(65 + ((n - 1) % 26)) + name
	}

	return name
}

/** "D9" or "d 9" as a column's place on screen, from 0, and a row's number, from 1; null for anything else. */
export function parseAddress(text: string): { readonly col: number; readonly row: number } | null {
	const match = /^\s*([A-Za-z]{1,3})\s*(\d{1,9})\s*$/.exec(text)
	const letters = match?.[1]
	const digits = match?.[2]

	if (letters === undefined || digits === undefined) {
		return null
	}

	let col = 0

	for (const letter of letters.toUpperCase()) {
		col = col * 26 + (letter.charCodeAt(0) - 64)
	}

	const row = Number(digits)

	return row > 0 ? { col: col - 1, row } : null
}
