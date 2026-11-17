import { compareDecimal } from "./decimal"
import { Listeners } from "./listeners"
import type { RowId, RowStore, StoreChange } from "./rows"
import type { FieldRule, FieldSchema, ModuleSchema } from "./schema"
import type { CellValue } from "./value"
import { decimalText } from "./values/number"
import { isLookupValue, valueProblem, type ValueProblemCode } from "./values/read"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings"

/**
 * What is wrong in a sheet, bound to rows by id and to fields by key, never to a row number or a
 * column header: a sort or a renamed header moves nothing.
 *
 * The shape is the one a backend's answers will take too. For now the issues are local: the
 * schema's own rules, checked in the browser as the user types. A backend still checks everything
 * again; passing here promises nothing.
 */

export type LocalIssueCode =
	ValueProblemCode | "required" | "min_value" | "max_value" | "min_length" | "max_length" | "not_unique"

export type IssueSeverity = "error" | "warning"

export interface IssueTarget {
	readonly rowId: RowId
	readonly field: string
}

export interface Issue {
	/** Stable while the problem stands: the same issue on the same cell keeps its id. */
	readonly id: string
	readonly scope: "cell" | "row" | "sheet" | "workbook"
	/** Who found it. `local` is this package; a backend's answers will carry their own. */
	readonly source: string
	readonly rowId: RowId | null
	readonly field: string | null
	/** Other cells the issue is about, such as the rows holding the same value as this one. */
	readonly targets: readonly IssueTarget[]
	/** Never renamed: what an application words its messages from. */
	readonly code: string
	readonly severity: IssueSeverity
	/** English, for a developer or as a last resort. An interface words its own from code and params. */
	readonly message: string
	readonly params: Readonly<Record<string, string>>
}

export interface IssueSummary {
	readonly errors: number
	readonly warnings: number
	/** Rows with at least one issue. */
	readonly rows: number
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
export class SheetValidator {
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
		const rows = new Set<RowId>()

		for (const [rowId, cells] of this.#cells) {
			for (const issues of cells.values()) {
				for (const issue of issues) {
					if (issue.severity === "error") {
						errors++
					} else {
						warnings++
					}
				}
			}

			rows.add(rowId)
		}

		for (const groups of this.#groups.values()) {
			for (const group of groups.values()) {
				if (group.size > 1) {
					errors += group.size

					for (const rowId of group) {
						rows.add(rowId)
					}
				}
			}
		}

		return { errors, warnings, rows: rows.size }
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
			// not the same number as anything.
			this.#regroup(rowId, field.key, issues.length === 0 ? uniqueKey(value) : null)
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
			message: `"${value}" appears ${group.size} times in this column; it may appear once.`,
			params
		})
	}
}

/** The issues of one value, apart from uniqueness, which needs the other rows. */
export function checkValue(rowId: RowId, field: FieldSchema, value: CellValue, settings: ValueSettings): Issue[] {
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

	for (const rule of field.rules) {
		const issue = checkRule(rowId, field, rule, value)

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
