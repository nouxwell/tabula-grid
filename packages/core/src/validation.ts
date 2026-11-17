import { compareDecimal } from "./decimal"
import { isFormulaError } from "./formula/error"
import { Listeners } from "./listeners"
import type { RowId, RowStore, StoreChange } from "./rows"
import type { FieldRule, FieldSchema, ModuleSchema } from "./schema"
import type { CellValue } from "./value"
import { decimalText } from "./values/number"
import { canonicalValue, isLookupValue, valueProblem, type ValueProblemCode } from "./values/read"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings"

/**
 * What is wrong in a sheet, bound to rows by id and to fields by key, never to a row number or a
 * column header: a sort or a renamed header moves nothing.
 *
 * Local issues are the schema's own rules, checked in the browser as the user types. A backend's
 * answers arrive in the same shape (see `SheetSession`). A backend still checks everything again;
 * passing here promises nothing.
 */

export type LocalIssueCode =
	| ValueProblemCode
	| "required"
	| "min_value"
	| "max_value"
	| "min_length"
	| "max_length"
	| "not_unique"
	| "formula_error"

export type IssueSeverity = "error" | "warning"

export type IssueScope = "cell" | "row" | "sheet" | "workbook"

export interface IssueTarget {
	readonly rowId: RowId
	readonly field: string
}

export interface Issue {
	/** Stable while the problem stands: the same issue on the same cell keeps its id. */
	readonly id: string
	readonly scope: IssueScope
	/** Who found it: `local` is this package, `preflight` and `process` are the backend's checks. */
	readonly source: string
	readonly rowId: RowId | null
	readonly field: string | null
	/** Other cells the issue is about, such as the rows holding the same value as this one. */
	readonly targets: readonly IssueTarget[]
	/** Never renamed: what an application words its messages from. */
	readonly code: string
	readonly severity: IssueSeverity
	/** Whether it stops the sheet from being processed. Every local error does; no warning does. */
	readonly blocking: boolean
	/**
	 * A backend found it, and a cell it is about has changed since. It is not taken as fixed: only
	 * checking again can say. A stale issue counts apart, and blocks nothing.
	 */
	readonly stale: boolean
	/** A sentence to show when an interface has no wording of its own for the code. */
	readonly message: string
	readonly params: Readonly<Record<string, string>>
}

export interface IssueSummary {
	/** Errors still standing; stale ones are counted apart. */
	readonly errors: number
	readonly warnings: number
	/** Issues waiting for the backend to check again. */
	readonly stale: number
	/** Rows with at least one issue. */
	readonly rows: number
}

/**
 * Issues a view can show: a validator's own, or those merged with a backend's answers. The grid and
 * the issue panel read either through this.
 */
export interface IssueSet {
	/** Moves on every change, for a view to redraw by. */
	readonly version: number
	/** The issues on one cell. */
	issuesAt(rowId: RowId, field: string): readonly Issue[]
	/** The issues about a row as a whole rather than one of its cells. */
	rowIssues(rowId: RowId): readonly Issue[]
	/** Whether any issue is on the row, on one of its cells or about it as a whole. */
	hasIssues(rowId: RowId): boolean
	/** Every issue: those about the whole sheet first, then by row as the rows stand, then by column. */
	issues(): Issue[]
	summary(): IssueSummary
	/** Called after each change. Returns the way to stop. */
	subscribe(listener: () => void): () => void
}

type CellIssues = Map<string, readonly Issue[]>

/**
 * How many other rows a "same value" issue points at. Its `count` param says how many there are in
 * all. Listing every one would put 49,999 targets on each of 50,000 rows after one paste.
 */
const MAX_TARGETS = 10

/**
 * Checks a sheet against its schema and keeps the result current.
 *
 * It listens to the row store and, after each change, checks only the cells the change touched.
 * A field with a `unique` rule is the one exception that looks across rows: changing one value can
 * clear or raise the issue on every other row holding it, and only those rows are touched.
 */
export class SheetValidator implements IssueSet {
	readonly #schema: ModuleSchema
	readonly #store: RowStore
	#settings: ValueSettings
	readonly #cells = new Map<RowId, CellIssues>()
	/** For each unique field: value key to the rows holding it, and each row's key. */
	readonly #groups = new Map<string, Map<string, Set<RowId>>>()
	readonly #keys = new Map<string, Map<RowId, string>>()
	/** Groups of rows holding one value, in sheet order: sorted once per change, when first asked. */
	readonly #sorted = new Map<string, readonly RowId[]>()
	readonly #listeners = new Listeners<SheetValidator>()
	readonly #unsubscribe: () => void
	#version = 0

	constructor(schema: ModuleSchema, store: RowStore, settings: ValueSettings = VALUE_SETTINGS.tr) {
		this.#schema = schema
		this.#store = store
		this.#settings = settings

		for (const field of schema.fields) {
			if (hasRule(field, "unique")) {
				this.#groups.set(field.key, new Map())
				this.#keys.set(field.key, new Map())
			}
		}

		this.#checkAll()
		this.#unsubscribe = store.subscribe(change => this.#apply(change))
	}

	/** Counts changes to the issues: a view redraws when it moves. */
	get version(): number {
		return this.#version
	}

	/** The issues on one cell, in a fixed order: the cell's own first, then any across rows. */
	issuesAt(rowId: RowId, field: string): readonly Issue[] {
		const own = this.#cells.get(rowId)?.get(field) ?? []
		const shared = this.#uniqueIssue(rowId, field)

		return shared ? [...own, shared] : own
	}

	/** None: the schema's rules are all about single cells. */
	rowIssues(): readonly Issue[] {
		return []
	}

	/** Every issue, in sheet order: by row as the rows stand now, then by column. */
	issues(): Issue[] {
		const result: Issue[] = []

		for (const rowId of this.#store.rowIds()) {
			for (const field of this.#schema.fields) {
				result.push(...this.issuesAt(rowId, field.key))
			}
		}

		return result
	}

	/** Counted without building the issues, so a sheet with 50,000 of them counts as fast as one with ten. */
	summary(): IssueSummary {
		let errors = 0
		let warnings = 0

		for (const cells of this.#cells.values()) {
			for (const issues of cells.values()) {
				for (const issue of issues) {
					if (issue.severity === "error") {
						errors++
					} else {
						warnings++
					}
				}
			}
		}

		for (const groups of this.#groups.values()) {
			for (const group of groups.values()) {
				if (group.size > 1) {
					errors += group.size
				}
			}
		}

		return { errors, warnings, stale: 0, rows: this.affectedRows().size }
	}

	/** The rows with at least one issue. */
	affectedRows(): Set<RowId> {
		const rows = new Set(this.#cells.keys())

		for (const groups of this.#groups.values()) {
			for (const group of groups.values()) {
				if (group.size > 1) {
					for (const rowId of group) {
						rows.add(rowId)
					}
				}
			}
		}

		return rows
	}

	hasIssues(rowId: RowId): boolean {
		// Every local issue is an error.
		return this.hasErrors(rowId)
	}

	/** Whether any error stands on the row: such a row is not sent to be processed. */
	hasErrors(rowId: RowId): boolean {
		const cells = this.#cells.get(rowId)

		if (cells) {
			for (const issues of cells.values()) {
				if (issues.some(issue => issue.severity === "error")) {
					return true
				}
			}
		}

		for (const [field, keys] of this.#keys) {
			const key = keys.get(rowId)

			if (key !== undefined && (this.#groups.get(field)?.get(key)?.size ?? 0) > 1) {
				return true
			}
		}

		return false
	}

	/** The settings text is read with: a backend is sent what they read a host's text as. */
	get settings(): ValueSettings {
		return this.#settings
	}

	/** Settings decide which text reads as a value, so changing them checks every cell again. */
	setSettings(settings: ValueSettings): void {
		if (settings === this.#settings) {
			return
		}

		this.#settings = settings
		this.#checkAll()
		this.#changed()
	}

	/** Called after each change to the issues. Returns the way to stop. */
	subscribe(listener: (validator: SheetValidator) => void): () => void {
		return this.#listeners.add(listener)
	}

	/** Stops listening to the store. */
	dispose(): void {
		this.#unsubscribe()
	}

	// ---------------------------------------------------------------- internals

	#checkAll(): void {
		this.#cells.clear()

		for (const groups of this.#groups.values()) {
			groups.clear()
		}

		for (const keys of this.#keys.values()) {
			keys.clear()
		}

		for (const rowId of this.#store.rowIds()) {
			this.#checkRow(rowId)
		}
	}

	#apply(change: StoreChange): void {
		for (const operation of change.operations) {
			switch (operation.kind) {
				case "set":
					if (this.#store.has(operation.rowId) && this.#schema.has(operation.field)) {
						this.#checkCell(operation.rowId, this.#schema.field(operation.field))
					}
					break
				case "insert":
					for (const row of operation.rows) {
						if (this.#store.has(row.rowId)) {
							this.#checkRow(row.rowId)
						}
					}
					break
				case "remove":
					for (const row of operation.rows) {
						this.#forget(row.rowId)
					}
					break
			}
		}

		this.#changed()
	}

	#changed(): void {
		this.#sorted.clear()
		this.#version++
		this.#listeners.emit(this)
	}

	#checkRow(rowId: RowId): void {
		for (const field of this.#schema.fields) {
			this.#checkCell(rowId, field)
		}
	}

	#checkCell(rowId: RowId, field: FieldSchema): void {
		const value = this.#store.get(rowId, field.key)
		const issues = checkValue(rowId, field, value, this.#settings)
		let row = this.#cells.get(rowId)

		if (issues.length > 0) {
			if (!row) {
				row = new Map()
				this.#cells.set(rowId, row)
			}

			row.set(field.key, issues)
		} else if (row) {
			row.delete(field.key)

			if (row.size === 0) {
				this.#cells.delete(rowId)
			}
		}

		if (this.#groups.has(field.key)) {
			// A value with a problem of its own takes no part in uniqueness: "abc" in a number column is
			// not the same number as anything. The rest are compared as the backend is sent them, so a
			// host's "1.234" is the same number as 1234.
			this.#regroup(
				rowId,
				field.key,
				issues.length === 0 ? uniqueKey(canonicalValue(field, value, this.#settings)) : null
			)
		}
	}

	#forget(rowId: RowId): void {
		this.#cells.delete(rowId)

		for (const field of this.#groups.keys()) {
			this.#regroup(rowId, field, null)
		}
	}

	#regroup(rowId: RowId, field: string, key: string | null): void {
		const groups = this.#groups.get(field)
		const keys = this.#keys.get(field)

		if (!groups || !keys) {
			return
		}

		const previous = keys.get(rowId)

		if (previous !== undefined) {
			const group = groups.get(previous)

			group?.delete(rowId)

			if (group?.size === 0) {
				groups.delete(previous)
			}

			keys.delete(rowId)
		}

		if (key !== null) {
			const group = groups.get(key) ?? new Set<RowId>()

			group.add(rowId)
			groups.set(key, group)
			keys.set(rowId, key)
		}
	}

	#uniqueIssue(rowId: RowId, field: string): Issue | null {
		const key = this.#keys.get(field)?.get(rowId)
		const group = key === undefined ? undefined : this.#groups.get(field)?.get(key)

		if (!group || group.size < 2) {
			return null
		}

		// The first others in the order the sheet has them, so the list reads top to bottom. The
		// group is sorted once per change and shared by every row in it.
		const cacheKey = `${field}\u0000${key}`
		let sorted = this.#sorted.get(cacheKey)

		if (!sorted) {
			sorted = [...group].sort((a, b) => this.#store.indexOf(a) - this.#store.indexOf(b))
			this.#sorted.set(cacheKey, sorted)
		}

		const others = sorted
			.slice(0, MAX_TARGETS + 1)
			.filter(other => other !== rowId)
			.slice(0, MAX_TARGETS)
		const value = describe(this.#store.get(rowId, field))
		const params = Object.freeze({ field, value, count: String(group.size) })

		return Object.freeze({
			id: `local|not_unique|${rowId}|${field}`,
			scope: "cell",
			source: "local",
			rowId,
			field,
			targets: Object.freeze(others.map(other => Object.freeze({ rowId: other, field }))),
			code: "not_unique",
			severity: "error",
			blocking: true,
			stale: false,
			message: `"${value}" appears ${group.size} times in this column; it may appear once.`,
			params
		})
	}
}

/** The issues of one value, apart from uniqueness, which needs the other rows. */
export function checkValue(rowId: RowId, field: FieldSchema, value: CellValue, settings: ValueSettings): Issue[] {
	// A formula that could not be worked out: its error is the only thing to say about the cell.
	if (isFormulaError(value)) {
		return [
			cellIssue(rowId, field, "formula_error", `The formula gives ${value.formulaError}.`, {
				error: value.formulaError
			})
		]
	}

	const problem = valueProblem(field, value, settings)

	// A value that is not of its type is only that: a minimum means nothing for "abc".
	if (problem) {
		return [cellIssue(rowId, field, problem.code, problem.message, problem.params)]
	}

	if (value === null) {
		return field.required
			? [cellIssue(rowId, field, "required", "This field is required and cannot be left empty.", {})]
			: []
	}

	const issues: Issue[] = []
	// The rules hold for the value the backend is sent: a host's "1.234,5" is 1234.5 against a maximum.
	const sent = canonicalValue(field, value, settings)

	for (const rule of field.rules) {
		const issue = checkRule(rowId, field, rule, sent)

		if (issue) {
			issues.push(issue)
		}
	}

	return issues
}

function checkRule(rowId: RowId, field: FieldSchema, rule: FieldRule, value: CellValue): Issue | null {
	switch (rule.rule) {
		case "min":
		case "max": {
			const number = decimalText(value)

			if (number === null) {
				return null
			}

			const comparison = compareDecimal(normalize(number), rule.value)

			if (rule.rule === "min" && comparison < 0) {
				return cellIssue(rowId, field, "min_value", `${number} is below the minimum of ${rule.value}.`, {
					value: number,
					min: rule.value
				})
			}

			if (rule.rule === "max" && comparison > 0) {
				return cellIssue(rowId, field, "max_value", `${number} is above the maximum of ${rule.value}.`, {
					value: number,
					max: rule.value
				})
			}

			return null
		}
		case "minLength":
		case "maxLength": {
			if (typeof value !== "string") {
				return null
			}

			// Characters a reader counts, not UTF-16 units: an emoji is one.
			const length = Array.from(value).length

			if (rule.rule === "minLength" && length < rule.value) {
				return cellIssue(rowId, field, "min_length", `"${value}" is shorter than ${rule.value} characters.`, {
					value,
					min: String(rule.value),
					length: String(length)
				})
			}

			if (rule.rule === "maxLength" && length > rule.value) {
				return cellIssue(rowId, field, "max_length", `"${value}" is longer than ${rule.value} characters.`, {
					value,
					max: String(rule.value),
					length: String(length)
				})
			}

			return null
		}
		case "unique":
			return null
	}
}

function cellIssue(
	rowId: RowId,
	field: FieldSchema,
	code: LocalIssueCode,
	message: string,
	params: Readonly<Record<string, string>>
): Issue {
	return Object.freeze({
		id: `local|${code}|${rowId}|${field.key}`,
		scope: "cell",
		source: "local",
		rowId,
		field: field.key,
		targets: Object.freeze([]),
		code,
		severity: "error",
		blocking: true,
		stale: false,
		message,
		params: Object.freeze({ field: field.key, type: field.type, ...params })
	})
}

function hasRule(field: FieldSchema, rule: FieldRule["rule"]): boolean {
	return field.rules.some(candidate => candidate.rule === rule)
}

/** What makes two values the same for uniqueness: a lookup by its id, anything else by its content. */
function uniqueKey(value: CellValue): string | null {
	if (value === null) {
		return null
	}

	if (isLookupValue(value)) {
		return `id:${typeof value.id}:${value.id}`
	}

	const number = typeof value === "number" || typeof value === "string" ? decimalText(value) : null

	// "12.50" and 12.5 are one number.
	return number !== null ? `number:${normalize(number)}` : `value:${JSON.stringify(value)}`
}

/** Decimal text in one form, so "12.50" and "12.5" compare and group as one number. */
function normalize(number: string): string {
	const negative = number.startsWith("-")
	const [whole = "0", fraction = ""] = (negative ? number.slice(1) : number).split(".")
	const trimmedWhole = whole.replace(/^0+(?=\d)/, "")
	const trimmedFraction = fraction.replace(/0+$/, "")
	const body = trimmedFraction === "" ? trimmedWhole : `${trimmedWhole}.${trimmedFraction}`

	return body === "0" || !negative ? body : `-${body}`
}

function describe(value: CellValue): string {
	if (isLookupValue(value)) {
		return value.label
	}

	return typeof value === "string" ? value : JSON.stringify(value)
}
