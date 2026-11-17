import type { ModuleSchemaInput, RowInit } from "@nouxwell/tabula-core"

/** A header longer than the 100 characters a header shows before it is cut. */
export const LONG_LABEL =
	"Not: fiyat değişikliğinin gerekçesi, onaylayan kişi ve varsa kampanyaya ya da tedarikçi sözleşmesine ait referans numarası"

/** The price-update sheet the playground and the browser tests work on. */
export const priceUpdate: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 2,
	title: "Toplu fiyat güncelleme",
	fields: [
		{
			key: "productId",
			type: "lookup",
			label: "Ürün",
			required: true,
			lookup: "product",
			rules: [{ rule: "unique" }]
		},
		{ key: "sku", type: "string", label: "SKU", editable: false, submit: false },
		{ key: "currentPrice", type: "money", label: "Mevcut fiyat", editable: false, submit: false, decimals: 2 },
		{
			key: "newPrice",
			type: "money",
			label: "Yeni fiyat",
			required: true,
			decimals: 2,
			rules: [{ rule: "min", value: "0" }]
		},
		{
			key: "change",
			type: "percent",
			label: "Değişim %",
			decimals: 1,
			rules: [
				{ rule: "min", value: "-100" },
				{ rule: "max", value: "100" }
			]
		},
		{
			key: "currency",
			type: "options",
			label: "Para birimi",
			options: [{ value: "TRY" }, { value: "USD" }, { value: "EUR" }]
		},
		{ key: "validFrom", type: "date", label: "Geçerlilik başlangıç tarihi (fiyat listesi)" },
		{ key: "active", type: "bool", label: "Aktif" },
		{ key: "note", type: "string", label: LONG_LABEL, rules: [{ rule: "maxLength", value: 60 }] },
		// Worked out from the row, for the user's eyes: not sent, as the backend works prices out itself.
		{
			key: "difference",
			type: "money",
			label: "Fark",
			decimals: 2,
			submit: false,
			formula: "[newPrice] - [currentPrice]"
		}
	]
}

const NOTES = ["Kampanya sonrası fiyat", "Tedarikçi zammı", "Kur farkı"]
const CURRENCIES = ["TRY", "TRY", "TRY", "USD", "EUR"]

/** The same rows on every load, so a test can name what it expects. */
export function sampleRows(count: number): RowInit[] {
	const random = seeded(1)
	const rows: RowInit[] = []

	for (let index = 0; index < count; index++) {
		const number = String(index + 1).padStart(6, "0")
		const current = 10 + Math.floor(random() * 249000) / 100
		const next = Math.round(current * (95 + random() * 25)) / 100
		const note = random() < 0.25 ? NOTES[Math.floor(random() * NOTES.length)] : undefined

		rows.push({
			values: {
				productId: { id: 1000 + index, label: `Ürün ${number}` },
				sku: `SKU-${number}`,
				currentPrice: current.toFixed(2),
				newPrice: next.toFixed(2),
				change: (((next - current) / current) * 100).toFixed(1),
				currency: CURRENCIES[Math.floor(random() * CURRENCIES.length)],
				validFrom: `2026-12-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}`,
				active: random() < 0.9,
				note
			}
		})
	}

	return rows
}

function seeded(seed: number): () => number {
	let state = seed

	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
