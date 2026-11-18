import type {
	IssueInput,
	LookupAdapters,
	LookupItem,
	PayloadRow,
	ProcessRequest,
	ProcessResponse,
	RowPlanInput,
	RowResultInput,
	SheetAdapters,
	SheetRequest
} from "@nouxwell/tabula-core"

interface Run {
	readonly final: ProcessResponse
	polls: number
	cancelled: boolean
}

/**
 * A pretend backend for the playground and its browser tests: a few business rules, a delay, and
 * failures on demand. A real one sits behind the application's own HTTP client; the adapters are
 * where its answers are turned into the package's contract.
 *
 * The rules: a product whose id divides by 9 is inactive, a price over 5,000 needs approval (a
 * warning), and a note with "red" in it is refused, which only a run finds out.
 *
 * Its price list, as a check tells what a run would do to it: a product whose id leaves 3 over 4
 * has no line yet, one whose id divides by 5 already holds the price, and the rest change from a
 * price a tenth lower.
 */
export class FakeBackend {
	/** Milliseconds each answer takes. */
	delay = 120
	/** Each run first answers `pending`, and is then followed with status questions. */
	slow = false
	/** The next run is done, but its answer never arrives, as when a connection drops. */
	loseNextAnswer = false
	/** How many times each run was done, by key: a resend under the same key is answered, not done again. */
	readonly done = new Map<string, number>()
	/** Every lookup request, as `search:query` or `resolve:name|name`, for the tests to count. */
	readonly lookupCalls: string[] = []
	readonly #runs = new Map<string, Run>()
	#operations = 0
	#lines = 50_000

	readonly adapters: SheetAdapters = {
		preflight: async (request: SheetRequest, { signal }) => {
			await this.#wait(signal)

			return {
				requestId: request.requestId,
				issues: request.rows.flatMap(row => this.#check(row)),
				plan: request.rows.flatMap(row => this.#plan(row))
			}
		},
		process: async (request: ProcessRequest, { signal }) => {
			await this.#wait(signal)

			const known = this.#runs.get(request.idempotencyKey)
			const run = known ?? this.#run(request)

			if (!known) {
				this.#runs.set(request.idempotencyKey, run)
				this.done.set(request.idempotencyKey, (this.done.get(request.idempotencyKey) ?? 0) + 1)
			}

			if (this.loseNextAnswer) {
				this.loseNextAnswer = false
				throw new TypeError("Failed to fetch")
			}

			return this.slow && !known
				? {
						requestId: request.requestId,
						operationId: run.final.operationId ?? null,
						status: "pending",
						progress: { done: 0, total: request.rows.length }
					}
				: run.final
		},
		processStatus: async (query, { signal }) => {
			await this.#wait(signal)

			const run = this.#runs.get(query.idempotencyKey)

			// Never seen: nothing was done, and the rows can go again under a new key.
			if (!run) {
				return { status: "failed", rows: [] }
			}

			run.polls++

			const rows = run.final.rows ?? []
			const half = rows.slice(0, Math.ceil(rows.length / 2))

			if (run.cancelled) {
				return { operationId: run.final.operationId ?? null, status: "cancelled", rows: half }
			}

			return run.polls === 1 && this.slow
				? {
						operationId: run.final.operationId ?? null,
						status: "pending",
						rows: half,
						progress: { done: half.length, total: rows.length }
					}
				: run.final
		},
		cancelProcess: async (query, { signal }) => {
			await this.#wait(signal)

			const run = this.#runs.get(query.idempotencyKey)

			if (run) {
				run.cancelled = true
			}
		}
	}

	/**
	 * The product catalog: "Ürün 000001" to "Ürün 050000" as the sample rows name them, the inactive
	 * ones (an id that divides by 9) shown but not picked, and a few named by hand, two of them alike.
	 */
	readonly catalog: readonly LookupItem[] = [
		...Array.from({ length: 50_000 }, (_, index) => {
			const number = String(index + 1).padStart(6, "0")
			const id = 1000 + index

			return id % 9 === 0
				? { id, label: `Ürün ${number}`, description: `SKU-${number} · pasif`, disabled: true }
				: { id, label: `Ürün ${number}`, description: `SKU-${number}` }
		}),
		{ id: 90_001, label: "Çelik Termos 500 ml", description: "TRM-500" },
		{ id: 90_002, label: "Termos", description: "TRM-750" },
		{ id: 90_003, label: "Termos", description: "TRM-1000" },
		{ id: 90_004, label: "Kupa", description: "KUP-300" }
	]

	/** Searches and matches the catalog, in Turkish, by name or by code. */
	readonly lookups: LookupAdapters = {
		search: async (request, { signal }) => {
			this.lookupCalls.push(`search:${request.query}`)
			await this.#wait(signal)

			const needle = request.query.trim().toLocaleLowerCase("tr")
			const found = this.catalog.filter(
				item =>
					item.label.toLocaleLowerCase("tr").includes(needle) ||
					(item.description ?? "").toLocaleLowerCase("tr").includes(needle)
			)

			return { items: found.slice(0, request.limit), more: found.length > request.limit }
		},
		resolve: async (request, { signal }) => {
			this.lookupCalls.push(`resolve:${request.labels.join("|")}`)
			await this.#wait(signal)

			return {
				matches: request.labels.map(label => {
					const needle = label.trim().toLocaleLowerCase("tr")

					return {
						label,
						items: this.catalog.filter(
							item =>
								item.label.toLocaleLowerCase("tr") === needle ||
								(item.description ?? "").split(" · ")[0]?.toLocaleLowerCase("tr") === needle
						)
					}
				})
			}
		}
	}

	#run(request: ProcessRequest): Run {
		const rows: RowResultInput[] = request.rows.map(row => {
			const issues = [...this.#check(row), ...this.#processRules(row)].filter(
				issue => (issue.severity ?? "error") === "error"
			)

			return issues.length > 0
				? { rowId: row.rowId, result: "failed", issues }
				: { rowId: row.rowId, result: "succeeded", data: { priceListLineId: ++this.#lines } }
		})
		const failed = rows.filter(row => row.result === "failed").length
		const status = failed === 0 ? "succeeded" : failed === rows.length ? "failed" : "partial"

		return {
			final: { requestId: request.requestId, operationId: `op_${++this.#operations}`, status, rows },
			polls: 0,
			cancelled: false
		}
	}

	/** What a run would do to the row's line; nothing for a product the list cannot hold. */
	#plan(row: PayloadRow): RowPlanInput[] {
		const product = row.values.productId

		if (typeof product !== "number" || product % 9 === 0) {
			return []
		}

		if (product % 4 === 3) {
			return [{ rowId: row.rowId, action: "create" }]
		}

		if (product % 5 === 0) {
			return [{ rowId: row.rowId, action: "unchanged" }]
		}

		return [
			{
				rowId: row.rowId,
				action: "update",
				previous: { newPrice: (Number(row.values.newPrice) / 1.1).toFixed(2) }
			}
		]
	}

	/** What a pre-flight check finds, and a run finds again. */
	#check(row: PayloadRow): IssueInput[] {
		const issues: IssueInput[] = []
		const product = row.values.productId
		const price = Number(row.values.newPrice)

		if (typeof product === "number" && product % 9 === 0) {
			issues.push({
				rowId: row.rowId,
				field: "productId",
				code: "product_inactive",
				message: "Ürün pasif; fiyatı güncellenemez."
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
				params: { limit: 5000 }
			})
		}

		return issues
	}

	/** What only a run finds out: passing a pre-flight check promises nothing. */
	#processRules(row: PayloadRow): IssueInput[] {
		const note = row.values.note

		return typeof note === "string" && /red/i.test(note)
			? [{ rowId: row.rowId, code: "rejected_by_rule", message: "Satır onay kuralına takıldı." }]
			: []
	}

	#wait(signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, this.delay)

			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer)
					reject(new DOMException("The request was cancelled.", "AbortError"))
				},
				{ once: true }
			)
		})
	}
}
