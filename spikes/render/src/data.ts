export interface SpikeColumn {
	key: string
	title: string
	width: number
	numeric: boolean
	readonly: boolean
}

export interface SpikeData {
	columns: SpikeColumn[]
	/** What each cell shows, row first: `rows[r][c]`. */
	rows: string[][]
	/** The cells drawn as errors, each as `r * columns.length + c`. */
	errors: Set<number>
}

/** The price-update sheet; any column past these is filler, alternating numbers and text. */
const BASE: Omit<SpikeColumn, "key">[] = [
	{ title: "Ürün", width: 220, numeric: false, readonly: false },
	{ title: "SKU", width: 110, numeric: false, readonly: true },
	{ title: "Mevcut fiyat", width: 120, numeric: true, readonly: true },
	{ title: "Yeni fiyat", width: 120, numeric: true, readonly: false },
	{ title: "Değişim %", width: 100, numeric: true, readonly: false },
	{ title: "Para birimi", width: 90, numeric: false, readonly: false },
	{ title: "Geçerlilik", width: 120, numeric: false, readonly: false },
	{ title: "Not", width: 200, numeric: false, readonly: false }
]

const CURRENCIES = ["TRY", "USD", "EUR"]
const NOTES = ["", "", "", "Kampanya sonrası fiyat", "Tedarikçi zammı", "Kur farkı"]

/** Share of cells drawn as errors. */
const ERROR_RATE = 0.01

/** A small seeded generator, so both pages and every run see exactly the same sheet. */
export function mulberry32(seed: number): () => number {
	let state = seed

	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** `1234.5` as `1.234,50`. */
function money(value: number): string {
	const fixed = value.toFixed(2)
	const dot = fixed.length - 3

	return `${fixed.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fixed.slice(dot + 1)}`
}

function pad(value: number, length: number): string {
	return String(value).padStart(length, "0")
}

/** The text in the first column of a row. It is unique, so finding it proves that row is on screen. */
export function rowMarker(row: number): string {
	return `Ürün ${pad(row + 1, 6)}`
}

function columnsFor(count: number): SpikeColumn[] {
	const columns: SpikeColumn[] = []

	for (let index = 0; index < count; index++) {
		const base = BASE[index]

		if (base) {
			columns.push({ key: `c${index}`, ...base })
		} else if (index % 2 === 0) {
			columns.push({ key: `c${index}`, title: `Sayı ${index + 1}`, width: 110, numeric: true, readonly: false })
		} else {
			columns.push({ key: `c${index}`, title: `Metin ${index + 1}`, width: 150, numeric: false, readonly: false })
		}
	}

	return columns
}

export function generate(rowCount: number, columnCount: number, seed = 1): SpikeData {
	const random = mulberry32(seed)
	const columns = columnsFor(columnCount)
	const rows: string[][] = []
	const errors = new Set<number>()

	for (let r = 0; r < rowCount; r++) {
		const current = 10 + random() * 2490
		const next = current * (0.95 + random() * 0.25)
		const row: string[] = []

		for (let c = 0; c < columnCount; c++) {
			switch (c) {
				case 0:
					row.push(rowMarker(r))
					break
				case 1:
					row.push(`SKU-${pad(r + 1, 6)}`)
					break
				case 2:
					row.push(money(current))
					break
				case 3:
					row.push(money(next))
					break
				case 4:
					row.push((((next - current) / current) * 100).toFixed(1).replace(".", ","))
					break
				case 5:
					row.push(CURRENCIES[Math.floor(random() * CURRENCIES.length)] ?? "TRY")
					break
				case 6:
					row.push(`${pad(1 + Math.floor(random() * 28), 2)}.${pad(1 + Math.floor(random() * 12), 2)}.2026`)
					break
				case 7:
					row.push(NOTES[Math.floor(random() * NOTES.length)] ?? "")
					break
				default:
					row.push(c % 2 === 0 ? money(random() * 100000) : `Değer ${Math.floor(random() * 100000)}`)
			}

			if (random() < ERROR_RATE) {
				errors.add(r * columnCount + c)
			}
		}

		rows.push(row)
	}

	return { columns, rows, errors }
}
