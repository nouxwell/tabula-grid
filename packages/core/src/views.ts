import { arrangeColumns, type ColumnLayout } from "./columns.js"
import { TabulaError } from "./errors.js"
import { hasRange, type ColumnCondition, type ColumnFilters, type ColumnSort } from "./filters.js"
import type { ModuleSchema } from "./schema.js"

/**
 * Saved views of a sheet: how a user arranged it, under a name, to come back to. A view holds what
 * the grid's models hold: the columns (order, hidden, pinned), their widths, the column filters and
 * the sort. Never rows or values: a view is how to look, not what is there.
 *
 * The views of one module are one plain JSON document, kept wherever the application keeps it: in
 * the browser, or on its server for each user. The functions here change it by returning a new one,
 * so it can sit in a Vue ref as it is.
 */

export const VIEWS_FORMAT = "tabula-grid.views"
export const VIEWS_VERSION = 1
/** The longest a view's name may be, in characters. */
export const VIEW_NAME_LIMIT = 60

/** How the sheet is arranged, as the grid's `columns`, `column-widths`, `filters` and `sort` hold it. */
export interface ViewState {
	readonly columns: ColumnLayout
	readonly columnWidths: Readonly<Record<string, number>>
	readonly filters: ColumnFilters
	readonly sort: ColumnSort | null
}

export interface SavedView extends ViewState {
	/** Made by the application, so a view keeps its id through a rename. */
	readonly id: string
	readonly name: string
}

export interface SavedViews {
	readonly format: typeof VIEWS_FORMAT
	/** The version of this format. */
	readonly version: typeof VIEWS_VERSION
	readonly module: string
	readonly views: readonly SavedView[]
	/** The view a sheet opens in; null for the sheet as its schema lays it out. */
	readonly defaultId: string | null
}

/** The sheet as its schema lays it out: every column in its place, no filter, no sort. */
export const PLAIN_VIEW: ViewState = Object.freeze({
	columns: Object.freeze({}),
	columnWidths: Object.freeze({}),
	filters: Object.freeze({}),
	sort: null
})

/** Why a name cannot be a view's: empty, longer than `VIEW_NAME_LIMIT`, or another view's. */
export type ViewNameProblem = "empty" | "too_long" | "taken"

/** A module with no views saved yet. */
export function emptyViews(module: string): SavedViews {
	return freezeViews({ module, views: [], defaultId: null })
}

/**
 * The view as it applies to the schema now. A column the schema no longer has is passed over, and
 * so is a filter or a sort on one; a range kept on a column that no longer holds numbers or dates is
 * dropped. A view saved before the schema moved on still opens.
 */
export function viewFor(state: ViewState, schema: ModuleSchema): ViewState {
	const known = (key: string): boolean => schema.has(key)
	const keys = (list: readonly string[] | undefined): readonly string[] | undefined =>
		list === undefined ? undefined : list.filter(known)
	const columns = state.columns
	const order = keys(columns.order)
	const hidden = keys(columns.hidden)
	const pinned = keys(columns.pinned)
	const filters: Record<string, ColumnCondition> = {}

	for (const [key, condition] of Object.entries(state.filters)) {
		if (known(key) && (condition.kind === "values" || hasRange(schema.field(key)))) {
			filters[key] = condition
		}
	}

	return freezeState({
		columns: { ...(order ? { order } : {}), ...(hidden ? { hidden } : {}), ...(pinned ? { pinned } : {}) },
		columnWidths: Object.fromEntries(Object.entries(state.columnWidths).filter(([key]) => known(key))),
		filters,
		sort: state.sort && known(state.sort.key) ? state.sort : null
	})
}

/**
 * Whether two states show the sheet alike, against the schema: the same columns in the same places,
 * the same widths, filters and sort. A layout that only writes out the schema's own order is the
 * same as one that leaves it out, and ticked values are the same in any order. What tells a user
 * that the view on screen is no longer the one they chose.
 */
export function sameView(schema: ModuleSchema, a: ViewState, b: ViewState): boolean {
	const left = viewFor(a, schema)
	const right = viewFor(b, schema)
	const arranged = (state: ViewState): string => {
		const { fields, pinned } = arrangeColumns(schema.fields, state.columns)

		return `${pinned}|${fields.map(field => field.key).join(",")}`
	}

	return (
		arranged(left) === arranged(right) &&
		sameRecord(left.columnWidths, right.columnWidths, (x, y) => x === y) &&
		sameRecord(left.filters, right.filters, sameCondition) &&
		(left.sort === null || right.sort === null
			? left.sort === right.sort
			: left.sort.key === right.sort.key && left.sort.direction === right.sort.direction)
	)
}

/**
 * How a view's name is checked. `except` is the view being renamed, which may keep its own name.
 * `locale` is the language names are compared in, the page's: in Turkish "HAFTALIK" is "Haftalık"
 * in capitals, in English it is not. Left out, the runtime's own, which differs from one machine to
 * the next.
 */
export interface ViewNameOptions {
	readonly except?: string | null
	readonly locale?: string
}

/** What is wrong with a name for a view, or null when it will do. */
export function viewNameProblem(
	views: SavedViews,
	name: string,
	options: ViewNameOptions = {}
): ViewNameProblem | null {
	const trimmed = name.trim()

	if (trimmed === "") {
		return "empty"
	}

	if ([...trimmed].length > VIEW_NAME_LIMIT) {
		return "too_long"
	}

	const names = collator(options.locale)
	const except = options.except ?? null

	return views.views.some(view => view.id !== except && names.compare(view.name, trimmed) === 0) ? "taken" : null
}

/**
 * A new view of the sheet as it stands, at the end of the list.
 *
 * @throws TabulaError `invalid_argument` for a name `viewNameProblem` refuses, or an id taken
 */
export function addView(
	views: SavedViews,
	view: { readonly id: string; readonly name: string } & ViewState,
	options: Pick<ViewNameOptions, "locale"> = {}
): SavedViews {
	if (view.id === "" || views.views.some(saved => saved.id === view.id)) {
		throw new TabulaError("invalid_argument", `A view's id must be new and not empty: "${view.id}".`)
	}

	const name = checkedName(views, view.name, { locale: options.locale })

	return freezeViews({ ...views, views: [...views.views, { ...view, name }] })
}

/** The view saved again with the sheet as it stands now, under its own name. */
export function updateView(views: SavedViews, id: string, state: ViewState): SavedViews {
	return change(views, id, view => ({ ...view, ...pickState(state) }))
}

/** @throws TabulaError `invalid_argument` for a name `viewNameProblem` refuses */
export function renameView(
	views: SavedViews,
	id: string,
	name: string,
	options: Pick<ViewNameOptions, "locale"> = {}
): SavedViews {
	const checked = checkedName(views, name, { except: id, locale: options.locale })

	return change(views, id, view => ({ ...view, name: checked }))
}

/** The views without this one. When it was the one the sheet opens in, the sheet opens as laid out. */
export function removeView(views: SavedViews, id: string): SavedViews {
	saved(views, id)

	return freezeViews({
		...views,
		views: views.views.filter(view => view.id !== id),
		defaultId: views.defaultId === id ? null : views.defaultId
	})
}

/** The view the sheet opens in; null for the sheet as its schema lays it out. */
export function setDefaultView(views: SavedViews, id: string | null): SavedViews {
	if (id !== null) {
		saved(views, id)
	}

	return freezeViews({ ...views, defaultId: id })
}

/**
 * Checks what was read back from storage against the views format, every problem at once.
 *
 * @throws TabulaError `invalid_views`, also for views of another module
 */
export function readViews(input: unknown, module: string): SavedViews {
	const problems: string[] = []
	const problem = (path: string, message: string): void => {
		problems.push(`${path}: ${message}`)
	}
	const root = plain(input)

	if (!root) {
		throw new TabulaError("invalid_views", "Saved views must be an object.")
	}

	if (root.format !== VIEWS_FORMAT) {
		problem("format", `must be "${VIEWS_FORMAT}".`)
	}

	if (root.version !== VIEWS_VERSION) {
		problem("version", `must be ${VIEWS_VERSION}; views of another version of this format cannot be read.`)
	}

	if (root.module !== module) {
		problem("module", `must be "${module}", the module these views are read for.`)
	}

	const views: SavedView[] = []
	const ids = new Set<string>()

	if (!Array.isArray(root.views)) {
		problem("views", "must be a list.")
	} else {
		root.views.forEach((item, index) => {
			const view = readView(item, `views[${index}]`, problem)

			if (view && ids.has(view.id)) {
				problem(`views[${index}].id`, `"${view.id}" is the id of another view.`)
			} else if (view) {
				ids.add(view.id)
				views.push(view)
			}
		})
	}

	const defaultId = root.defaultId === undefined || root.defaultId === null ? null : root.defaultId

	if (defaultId !== null && (typeof defaultId !== "string" || !ids.has(defaultId))) {
		problem("defaultId", "must be the id of one of the views, or null.")
	}

	if (problems.length > 0) {
		throw new TabulaError(
			"invalid_views",
			`The views cannot be read:\n${problems.map(line => `  ${line}`).join("\n")}`
		)
	}

	return freezeViews({ module, views, defaultId: defaultId as string | null })
}

// ---------------------------------------------------------------- inside

/** Names compared as a person reads them, by language: "Haftalık" and "haftalık" are one name. */
const collators = new Map<string, Intl.Collator>()

function collator(locale: string | undefined): Intl.Collator {
	const key = locale ?? ""
	let found = collators.get(key)

	if (!found) {
		found = new Intl.Collator(locale, { sensitivity: "accent" })
		collators.set(key, found)
	}

	return found
}

type Plain = Record<string, unknown>
type Problem = (path: string, message: string) => void

function checkedName(views: SavedViews, name: string, options: ViewNameOptions): string {
	const problem = viewNameProblem(views, name, options)

	if (problem !== null) {
		throw new TabulaError("invalid_argument", `"${name}" cannot be a view's name: ${problem}.`)
	}

	return name.trim()
}

function saved(views: SavedViews, id: string): SavedView {
	const view = views.views.find(item => item.id === id)

	if (!view) {
		throw new TabulaError("invalid_argument", `There is no view "${id}".`)
	}

	return view
}

function change(views: SavedViews, id: string, update: (view: SavedView) => SavedView): SavedViews {
	saved(views, id)

	return freezeViews({ ...views, views: views.views.map(view => (view.id === id ? update(view) : view)) })
}

function pickState(state: ViewState): ViewState {
	return { columns: state.columns, columnWidths: state.columnWidths, filters: state.filters, sort: state.sort }
}

function sameRecord<T>(
	a: Readonly<Record<string, T>>,
	b: Readonly<Record<string, T>>,
	same: (x: T, y: T) => boolean
): boolean {
	const keys = Object.keys(a)

	return keys.length === Object.keys(b).length && keys.every(key => key in b && same(a[key] as T, b[key] as T))
}

function sameCondition(a: ColumnCondition, b: ColumnCondition): boolean {
	if (a.kind === "range" || b.kind === "range") {
		return a.kind === "range" && b.kind === "range" && a.from === b.from && a.to === b.to
	}

	const keys = new Set(a.keys)

	return keys.size === new Set(b.keys).size && b.keys.every(key => keys.has(key))
}

function readView(input: unknown, path: string, problem: Problem): SavedView | null {
	const view = plain(input)

	if (!view) {
		problem(path, "must be an object.")

		return null
	}

	let failed = false
	const fail: Problem = (at, message) => {
		failed = true
		problem(at, message)
	}

	const id = typeof view.id === "string" && view.id !== "" ? view.id : null
	const name = typeof view.name === "string" && view.name.trim() !== "" ? view.name.trim() : null

	if (id === null) {
		fail(`${path}.id`, "must be a non-empty string.")
	}

	if (name === null) {
		fail(`${path}.name`, "must be a non-empty string.")
	}

	const columns = readLayout(view.columns, `${path}.columns`, fail)
	const columnWidths = readWidths(view.columnWidths, `${path}.columnWidths`, fail)
	const filters = readFilters(view.filters, `${path}.filters`, fail)
	const sort = readSort(view.sort, `${path}.sort`, fail)

	return failed || id === null || name === null ? null : { id, name, columns, columnWidths, filters, sort }
}

function readLayout(input: unknown, path: string, problem: Problem): ColumnLayout {
	if (input === undefined || input === null) {
		return {}
	}

	const layout = plain(input)

	if (!layout) {
		problem(path, "must be an object.")

		return {}
	}

	const result: { order?: readonly string[]; hidden?: readonly string[]; pinned?: readonly string[] } = {}

	for (const name of ["order", "hidden", "pinned"] as const) {
		const value = layout[name]

		if (value === undefined) {
			continue
		}

		if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
			problem(`${path}.${name}`, "must be a list of field keys.")
		} else {
			result[name] = value as string[]
		}
	}

	return result
}

function readWidths(input: unknown, path: string, problem: Problem): Record<string, number> {
	if (input === undefined || input === null) {
		return {}
	}

	const widths = plain(input)

	if (!widths) {
		problem(path, "must be an object of widths by field key.")

		return {}
	}

	const result: Record<string, number> = {}

	for (const [key, width] of Object.entries(widths)) {
		if (typeof width === "number" && Number.isFinite(width) && width > 0) {
			result[key] = width
		} else {
			problem(`${path}.${key}`, "must be a number of pixels.")
		}
	}

	return result
}

function readFilters(input: unknown, path: string, problem: Problem): Record<string, ColumnCondition> {
	if (input === undefined || input === null) {
		return {}
	}

	const filters = plain(input)

	if (!filters) {
		problem(path, "must be an object of conditions by field key.")

		return {}
	}

	const result: Record<string, ColumnCondition> = {}

	for (const [key, value] of Object.entries(filters)) {
		const condition = plain(value)
		const bound = (side: unknown): side is string | null => side === null || typeof side === "string"

		if (
			condition?.kind === "values" &&
			Array.isArray(condition.keys) &&
			condition.keys.every(item => typeof item === "string")
		) {
			result[key] = { kind: "values", keys: condition.keys as string[] }
		} else if (condition?.kind === "range" && bound(condition.from) && bound(condition.to)) {
			result[key] = { kind: "range", from: condition.from, to: condition.to }
		} else {
			problem(
				`${path}.${key}`,
				'must be { kind: "values", keys: [...] } or { kind: "range", from, to }, each bound text or null.'
			)
		}
	}

	return result
}

function readSort(input: unknown, path: string, problem: Problem): ColumnSort | null {
	if (input === undefined || input === null) {
		return null
	}

	const sort = plain(input)

	if (
		sort &&
		typeof sort.key === "string" &&
		sort.key !== "" &&
		(sort.direction === "asc" || sort.direction === "desc")
	) {
		return { key: sort.key, direction: sort.direction }
	}

	problem(path, 'must be { key, direction: "asc" or "desc" }, or null.')

	return null
}

function freezeState(state: ViewState): ViewState {
	const columns = state.columns

	return Object.freeze({
		columns: Object.freeze({
			...(columns.order ? { order: Object.freeze([...columns.order]) } : {}),
			...(columns.hidden ? { hidden: Object.freeze([...columns.hidden]) } : {}),
			...(columns.pinned ? { pinned: Object.freeze([...columns.pinned]) } : {})
		}),
		columnWidths: Object.freeze({ ...state.columnWidths }),
		filters: Object.freeze(
			Object.fromEntries(
				Object.entries(state.filters).map(([key, condition]) => [
					key,
					Object.freeze(
						condition.kind === "values"
							? { kind: "values", keys: Object.freeze([...condition.keys]) }
							: { ...condition }
					)
				])
			)
		) as ColumnFilters,
		sort: state.sort ? Object.freeze({ key: state.sort.key, direction: state.sort.direction }) : null
	})
}

function freezeViews(views: Pick<SavedViews, "module" | "views" | "defaultId">): SavedViews {
	return Object.freeze({
		format: VIEWS_FORMAT,
		version: VIEWS_VERSION,
		module: views.module,
		views: Object.freeze(
			views.views.map(view => Object.freeze({ id: view.id, name: view.name, ...freezeState(view) }))
		),
		defaultId: views.defaultId
	})
}

function plain(value: unknown): Plain | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Plain) : null
}
