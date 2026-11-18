import type {
	CellValue,
	IssueInput,
	LookupItem,
	ModuleSchemaInput,
	PayloadRow,
	ProcessResponse,
	RowInit,
	RowPlanInput,
	RowResultInput,
	SheetRequest
} from "@nouxwell/tabula-core"

/**
 * The backend of the example: the module schema, the rows to start from, the product catalogue and
 * the business rules only a server knows. A PHP backend writes the schema with nouxwell/tabula's
 * Tabula::gridSchema() and checks the rows with Tabula::checkRows() before rules like these.
 */

export const PRICE_UPDATE: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 1,
	title: "Toplu fiyat güncelleme",
	// A template may narrow the sheet for a task, never loosen it.
	customization: "controlled",
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
			key: "difference",
			type: "money",
			label: "Fark",
			decimals: 2,
			// A rise in green with its plus, a fall in red.
			tone: "sign",
			submit: false,
			formula: "[newPrice] - [currentPrice]"
		},
		{
			key: "currency",
			type: "options",
			label: "Para birimi",
			options: [{ value: "TRY" }, { value: "USD" }, { value: "EUR" }]
		},
		{ key: "validFrom", type: "date", label: "Geçerlilik" },
		{ key: "active", type: "bool", label: "Aktif" },
		{ key: "note", type: "string", label: "Not", rules: [{ rule: "maxLength", value: 60 }] },
		// Several at once: ticked in a list in the cell, filtered by each.
		{
			key: "channels",
			type: "options",
			label: "Kanallar",
			multiple: true,
			options: [
				{ value: "store", label: "Mağaza" },
				{ value: "web", label: "Web" },
				{ value: "market", label: "Pazar yeri" }
			]
		}
	]
}

/**
 * The templates an authorized user prepared for the module, as the backend keeps and sends them. One
 * here: December's price rise, with its header, its stricter minimum, its date and currency for new
 * rows, the price with tax worked out, a note column of its own that is never sent, and two row
 * checks: a warning on a price cut, and the note required for a price that starts early.
 */
export const PRICE_TEMPLATES = [
	{
		format: "tabula-grid.template",
		version: 1,
		module: "product.price_update",
		id: "december-rise",
		name: "Aralık zam listesi",
		fields: {
			newPrice: { label: "Aralık fiyatı", rules: [{ rule: "min", value: "1" }] },
			validFrom: { required: true, default: "2026-12-01" },
			currency: { default: "TRY" },
			active: { editable: false }
		},
		columns: [
			{ key: "withTax", type: "money", label: "KDV dahil", decimals: 2, formula: "ROUND([newPrice] * 1.2, 2)" },
			{ key: "internalNote", type: "string", label: "İç not", rules: [{ rule: "maxLength", value: 80 }] }
		],
		checks: [
			// A price cut is allowed, only pointed out.
			{
				id: "not-below-current",
				assert: { field: "newPrice", op: ">=", other: "currentPrice" },
				severity: "warning"
			},
			// A price that starts before the rise needs the reason written down.
			{
				id: "early-start-note",
				assert: { field: "internalNote", op: "filled" },
				when: [{ field: "validFrom", op: "<", value: "2026-12-01" }],
				message: {
					tr: "1 Aralık'tan önce başlayan fiyata iç not yazın.",
					en: "Write an internal note for a price that starts before 1 December."
				}
			}
		],
		view: { columns: { hidden: ["sku"], pinned: ["productId"] }, columnWidths: {}, filters: {}, sort: null }
	}
] as const

const ROWS = 1_000
const FIRST_ID = 1000

/** Every ninth product is no longer sold: listed, never picked, and refused by the checks. */
function isInactive(id: number): boolean {
	return id % 9 === 0
}

export const CATALOG: readonly LookupItem[] = [
	...Array.from({ length: ROWS * 2 }, (_, index) => {
		const id = FIRST_ID + index
		const code = `SKU-${String(index + 1).padStart(6, "0")}`
		const label = `Ürün ${String(index + 1).padStart(6, "0")}`

		return isInactive(id)
			? { id, label, description: `${code} · pasif`, disabled: true }
			: { id, label, description: code }
	}),
	{ id: 90_001, label: "Çelik Termos 500 ml", description: "TRM-500" },
	{ id: 90_002, label: "Termos", description: "TRM-750" },
	{ id: 90_003, label: "Termos", description: "TRM-1000" }
]

/** The channels each product starts with, by its place: most are sold in the store and online. */
const CHANNELS = [["store", "web"], ["store"], ["web", "market"], ["store", "web", "market"], ["web"]]

/**
 * The products the sheet opens with: those still sold, and the first three that are not, for the
 * server to refuse. A few, so they can be put right by hand before a run.
 */
function startingProducts(): LookupItem[] {
	let refused = 0

	return CATALOG.filter(item => !item.disabled || refused++ < 3).slice(0, ROWS)
}

/** The same rows on every load. */
export function startingRows(): RowInit[] {
	const random = seeded(7)
	const currencies = ["TRY", "TRY", "TRY", "USD", "EUR"]
	const products = startingProducts()

	return Array.from({ length: ROWS }, (_, index) => {
		const item = products[index]!
		const current = 10 + Math.floor(random() * 249_000) / 100
		const next = Math.round(current * (95 + random() * 25)) / 100

		return {
			values: {
				productId: { id: item.id, label: item.label },
				sku: item.description?.split(" · ")[0] ?? null,
				currentPrice: current.toFixed(2),
				newPrice: next.toFixed(2),
				currency: currencies[Math.floor(random() * currencies.length)] ?? "TRY",
				validFrom: "2026-12-01",
				active: true,
				channels: CHANNELS[index % CHANNELS.length]
			}
		}
	})
}

/** What only the server knows about a row: whether the product exists and is still sold, and limits. */
export function businessIssues(row: PayloadRow): IssueInput[] {
	const issues: IssueInput[] = []
	const product = row.values.productId
	const price = Number(row.values.newPrice)

	if (typeof product === "number" && isInactive(product)) {
		issues.push({
			rowId: row.rowId,
			field: "productId",
			code: "product_inactive",
			message: "Bu ürün artık satılmıyor; fiyatı değiştirilemez."
		})
	} else if (typeof product === "object" && product !== null && "label" in product) {
		issues.push({
			rowId: row.rowId,
			field: "productId",
			code: "product_not_found",
			message: `“${String(product.label)}” adında bir ürün bulunamadı.`
		})
	}

	if (price > 5000) {
		issues.push({
			rowId: row.rowId,
			field: "newPrice",
			code: "needs_approval",
			severity: "warning",
			message: "5.000 üzerindeki fiyatlar onaya düşer.",
			params: { limit: "5000" }
		})
	}

	return issues
}

type Line = Readonly<Record<string, CellValue>>

/**
 * The price list as the server keeps it: each product's line, by product id, in the form rows are
 * sent in. Most products start with last month's line; every 50th has none yet, so its row makes a
 * new one, and every 40th already holds what the sheet sends, so its row changes nothing.
 */
const priceList = new Map<number, Line>(
	startingRows().flatMap((row, index): [number, Line][] => {
		const values = row.values ?? {}
		const product = values.productId as { readonly id: number }

		if (index % 50 === 7) {
			return []
		}

		const sent: Line = {
			newPrice: values.newPrice ?? null,
			currency: values.currency ?? null,
			validFrom: values.validFrom ?? null,
			active: values.active ?? null,
			note: null,
			channels: values.channels ?? null
		}

		return [
			[
				product.id,
				index % 40 === 13 ? sent : { ...sent, newPrice: values.currentPrice ?? null, validFrom: "2026-11-01" }
			]
		]
	})
)

/** Whether two values sent for a field are the same: numbers by value, a list of options in any order. */
function same(left: CellValue, right: CellValue): boolean {
	if (typeof left === "string" && typeof right === "string" && left !== "" && right !== "") {
		const a = Number(left)
		const b = Number(right)

		if (Number.isFinite(a) && Number.isFinite(b)) {
			return a === b
		}
	}

	const sorted = (value: CellValue): string =>
		JSON.stringify(Array.isArray(value) ? [...(value as readonly CellValue[])].map(String).sort() : (value ?? null))

	return sorted(left) === sorted(right)
}

/** The fields a row sends to its line: all but the product, which says which line it is. */
function lineOf(row: PayloadRow): Line {
	return Object.fromEntries(Object.entries(row.values).filter(([field]) => field !== "productId"))
}

/**
 * What processing each row would do to the price list: make a line, change one, or leave one as it
 * is. A row without a product the list could hold is left out; its issues say why.
 */
export function planRows(request: SheetRequest): RowPlanInput[] {
	return request.rows.flatMap((row): RowPlanInput[] => {
		const product = row.values.productId

		if (typeof product !== "number" || isInactive(product)) {
			return []
		}

		const held = priceList.get(product)

		if (!held) {
			return [{ rowId: row.rowId, action: "create" }]
		}

		const previous: Record<string, CellValue> = {}

		for (const [field, value] of Object.entries(lineOf(row))) {
			if (!same(held[field] ?? null, value)) {
				previous[field] = held[field] ?? null
			}
		}

		return Object.keys(previous).length === 0
			? [{ rowId: row.rowId, action: "unchanged" }]
			: [{ rowId: row.rowId, action: "update", previous }]
	})
}

const runs = new Map<string, ProcessResponse>()
let lines = 50_000

/**
 * A run, answered once per idempotency key: the same key asked again gets the same answer, and the
 * rows are not written twice.
 */
export function processRows(request: SheetRequest & { readonly idempotencyKey: string }): ProcessResponse {
	const known = runs.get(request.idempotencyKey)

	if (known) {
		return known
	}

	const rows: RowResultInput[] = request.rows.map(row => {
		const errors = businessIssues(row).filter(issue => (issue.severity ?? "error") === "error")

		if (errors.length > 0) {
			return { rowId: row.rowId, result: "failed", issues: errors }
		}

		priceList.set(row.values.productId as number, lineOf(row))

		return { rowId: row.rowId, result: "succeeded", data: { priceListLineId: ++lines } }
	})
	const failed = rows.filter(row => row.result === "failed").length
	const answer: ProcessResponse = {
		requestId: request.requestId,
		operationId: `op_${runs.size + 1}`,
		status: failed === 0 ? "succeeded" : failed === rows.length ? "failed" : "partial",
		rows
	}

	runs.set(request.idempotencyKey, answer)

	return answer
}

function seeded(seed: number): () => number {
	let state = seed

	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648

		return state / 2_147_483_648
	}
}
