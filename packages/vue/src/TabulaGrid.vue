<script setup lang="ts">
import {
	autoColumnWidth,
	clampColumnWidth,
	editText,
	formatCell,
	headerDisplayText,
	parseTsv,
	readInput,
	REDO_ORIGIN,
	resolveColumnSizing,
	Selection,
	SheetValidator,
	TabulaError,
	toTsv,
	UNDO_ORIGIN,
	UndoHistory,
	VALUE_SETTINGS,
	type CellPosition,
	type CellRange,
	type ColumnSizing,
	type Direction,
	type CellValue,
	type FieldSchema,
	type Issue,
	type IssueSet,
	type LookupSearch,
	type ModuleSchema,
	type RowResults,
	type RowStore,
	type StoreChange,
	type ValueSettings
} from "@nouxwell/tabula-core"
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	shallowRef,
	toRaw,
	useId,
	watch,
	type PropType
} from "vue"
import { alignmentOf } from "./alignment"
import { GRID_TEXT, issueText, type GridLocale } from "./messages"
import { horizontalPadding, textMeasurer, type Measure } from "./measure"
import type { GridTheme } from "./types"

const props = defineProps({
	/** The module schema: which columns there are, in which order, and what each may hold. */
	schema: { type: Object as PropType<ModuleSchema>, required: true },
	/** The rows. The grid writes into it and redraws whenever it changes, whoever changed it. */
	store: { type: Object as PropType<RowStore>, required: true },
	/** Sizing for every column. Whatever is left out keeps its default. */
	columnSizing: { type: Object as PropType<Partial<ColumnSizing>>, default: undefined },
	/** Sizing for single columns by field key, over `columnSizing`. */
	columnOverrides: { type: Object as PropType<Readonly<Record<string, Partial<ColumnSizing>>>>, default: undefined },
	/** No cell can be changed: no typing, pasting, clearing or cutting. */
	readonly: { type: Boolean, default: false },
	theme: { type: String as PropType<GridTheme>, default: "light" },
	/**
	 * How values are written and read: separators, digits, date patterns, the words for yes and no.
	 * Turkish by default, as nouxwell/tabula's own defaults are.
	 */
	valueSettings: { type: Object as PropType<ValueSettings>, default: () => VALUE_SETTINGS.tr },
	/** Pixels. */
	rowHeight: { type: Number, default: 30 },
	/**
	 * The issues to show: a `SheetValidator`, or a `SheetSession`'s `issues` with the backend's in
	 * them. Pass what an issue panel shows too, so both tell the same story; left out, the grid checks
	 * the sheet against the schema on its own. Issues passed in belong to the host: the grid neither
	 * changes their settings nor disposes of them.
	 */
	issues: { type: Object as PropType<IssueSet>, default: undefined },
	/**
	 * Each row's result from the backend, such as a `SheetSession`'s `results`: shown by the row's
	 * number, and a row it locks cannot be changed.
	 */
	results: { type: Object as PropType<RowResults>, default: undefined },
	/**
	 * Searches a lookup's records as the user types into one, such as a `LookupResolver`: the editor
	 * then lists them to pick from. Left out, a lookup takes only names, matched to records elsewhere.
	 */
	lookups: { type: Object as PropType<LookupSearch>, default: undefined },
	/**
	 * Undo and redo for the store. Pass one to show its state elsewhere, such as on toolbar buttons;
	 * left out, the grid keeps its own. One passed in belongs to the host, which disposes of it.
	 */
	history: { type: Object as PropType<UndoHistory>, default: undefined },
	/** The language of the grid's own words: issue messages and labels. */
	locale: { type: String as PropType<GridLocale>, default: "tr" }
})

/** Widths the user set by dragging or fitting, by field key. Bind it with v-model to keep them. */
const columnWidths = defineModel<Readonly<Record<string, number>>>("columnWidths", { default: () => ({}) })

const HEADER_HEIGHT = 32
const OVERSCAN_ROWS = 6
const OVERSCAN_COLS = 2
/** Room kept free at a header's right edge for the handle that resizes the column. */
const RESIZE_HANDLE = 6
/** How many rows fitting a column to its contents looks at, spread over the sheet. */
const AUTOFIT_SAMPLE = 5000
/** The editor's padding, border and room for the caret, in pixels. */
const EDITOR_CHROME = 22

const ARROWS: Readonly<Record<string, Direction>> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right"
}

const STEPS: Readonly<Record<Direction, CellPosition>> = {
	up: { row: -1, col: 0 },
	down: { row: 1, col: 0 },
	left: { row: 0, col: -1 },
	right: { row: 0, col: 1 }
}

// The store and the schema hold private fields, which a reactive proxy cannot reach. Whatever the
// host passed, the grid works on the objects themselves and learns about changes by subscribing.
const store = shallowRef<RowStore>(toRaw(props.store))
const schema = shallowRef<ModuleSchema>(toRaw(props.schema))
const fields = computed<readonly FieldSchema[]>(() => schema.value.fields)

const selection = new Selection(0, 0)
const dataVersion = shallowRef(0)
const selectionVersion = shallowRef(0)
const rowCount = shallowRef(0)

const id = useId()
const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const head = ref<HTMLElement | null>(null)
const gutter = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const editor = ref<HTMLInputElement | null>(null)
const headerProbe = ref<HTMLElement | null>(null)
const cellProbe = ref<HTMLElement | null>(null)

// ---------------------------------------------------------------- columns

const sizings = computed<readonly ColumnSizing[]>(() =>
	fields.value.map(field => resolveColumnSizing(props.columnSizing, props.columnOverrides?.[field.key]))
)

/** Widths from the headers, measured once the fonts are in. Until then, every column is at its minimum. */
const autoWidths = shallowRef<readonly number[]>([])

/** The width of the column being dragged, kept apart until the drag ends so the model changes once. */
const liveWidth = shallowRef<{ key: string; width: number } | null>(null)

const widths = computed<readonly number[]>(() =>
	fields.value.map((field, index) => {
		const sizing = sizings.value[index] ?? resolveColumnSizing()

		if (liveWidth.value?.key === field.key) {
			return liveWidth.value.width
		}

		const manual = columnWidths.value[field.key]

		// A width the user chose is never replaced by a measured one.
		return manual === undefined ? (autoWidths.value[index] ?? sizing.minWidth) : clampColumnWidth(manual, sizing)
	})
)

const offsets = computed<readonly number[]>(() => {
	const list = [0]

	for (const width of widths.value) {
		list.push((list[list.length - 1] ?? 0) + width)
	}

	return list
})

const totalWidth = computed(() => offsets.value[offsets.value.length - 1] ?? 0)
const totalHeight = computed(() => rowCount.value * props.rowHeight)
const gutterWidth = computed(() => Math.max(44, String(Math.max(rowCount.value, 1)).length * 8 + 20))

const cellStyles = computed(() =>
	widths.value.map((width, index) => `left:${offsets.value[index] ?? 0}px;width:${width}px`)
)

const cellClasses = computed(() =>
	fields.value.map(field => {
		const align = alignmentOf(field)
		const classes = align === "left" ? "" : `is-${align}`

		return isEditable(field) ? classes : `${classes} is-readonly`
	})
)

function isEditable(field: FieldSchema | undefined): field is FieldSchema {
	return field !== undefined && field.editable && !props.readonly
}

function headerText(col: number): string {
	const field = fields.value[col]
	const sizing = sizings.value[col]

	return field && sizing ? headerDisplayText(field.label, sizing.headerDisplayMaxLength) : ""
}

function headerStyle(col: number): string {
	return `left:${gutterWidth.value + (offsets.value[col] ?? 0)}px;width:${widths.value[col] ?? 0}px`
}

/** The column under a horizontal position in the body. */
function columnAt(x: number): number {
	const list = offsets.value
	let low = 0
	let high = Math.max(0, fields.value.length - 1)

	while (low < high) {
		const middle = (low + high + 1) >> 1

		if ((list[middle] ?? 0) <= x) {
			low = middle
		} else {
			high = middle - 1
		}
	}

	return low
}

function measureHeaders(): void {
	const probe = headerProbe.value

	if (!probe) {
		return
	}

	const measure = textMeasurer(probe)
	const padding = horizontalPadding(probe)
	const mark = measure(" *")

	autoWidths.value = fields.value.map((field, index) => {
		const sizing = sizings.value[index] ?? resolveColumnSizing()
		const content = measure(headerText(index)) + padding + (field.required ? mark : 0) + RESIZE_HANDLE

		return autoColumnWidth(content, sizing)
	})
}

/** Fits a column to its header and its contents, within the automatic limits, as a width the user chose. */
function autoFit(col: number): void {
	const field = fields.value[col]
	const sizing = sizings.value[col]

	if (!field || !sizing || !headerProbe.value || !cellProbe.value) {
		return
	}

	const measureHeader = textMeasurer(headerProbe.value)
	const measureCell = textMeasurer(cellProbe.value)
	const cellPadding = horizontalPadding(cellProbe.value)
	let content =
		measureHeader(headerText(col)) +
		horizontalPadding(headerProbe.value) +
		(field.required ? measureHeader(" *") : 0) +
		RESIZE_HANDLE

	const rows = store.value
	const step = Math.max(1, Math.ceil(rows.size / AUTOFIT_SAMPLE))

	for (let row = 0; row < rows.size; row += step) {
		const rowId = rows.rowIdAt(row)
		const text = rowId === undefined ? "" : formatCell(field, rows.get(rowId, field.key), props.valueSettings)

		if (text !== "") {
			content = Math.max(content, measureCell(text) + cellPadding)
		}
	}

	setWidth(field.key, autoColumnWidth(content, sizing))
}

function setWidth(key: string, width: number): void {
	if (columnWidths.value[key] !== width) {
		columnWidths.value = Object.freeze({ ...columnWidths.value, [key]: width })
	}
}

// ---------------------------------------------------------------- what is on screen

const firstRow = shallowRef(0)
const lastRow = shallowRef(-1)
const firstCol = shallowRef(0)
const lastCol = shallowRef(-1)
// A row's key is its index modulo how many rows fit on screen, so the element of a row scrolling out
// is handed to the row scrolling in instead of being destroyed and built again.
const rowPool = shallowRef(1)
const colPool = shallowRef(1)

const visibleRows = computed(() => span(firstRow.value, lastRow.value))
const visibleCols = computed(() => span(firstCol.value, lastCol.value))

function span(first: number, last: number): number[] {
	const list: number[] = []

	for (let index = first; index <= last; index++) {
		list.push(index)
	}

	return list
}

function bodySize(): { width: number; height: number } {
	const element = scroller.value

	return {
		width: Math.max(0, (element?.clientWidth ?? 0) - gutterWidth.value),
		height: Math.max(0, (element?.clientHeight ?? 0) - HEADER_HEIGHT)
	}
}

function updateWindow(): void {
	const element = scroller.value

	if (!element) {
		return
	}

	const { width, height } = bodySize()
	const rows = rowCount.value
	const cols = fields.value.length
	const top = element.scrollTop
	const left = element.scrollLeft
	const narrowest = Math.max(1, Math.min(...widths.value, Number.POSITIVE_INFINITY))

	rowPool.value = Math.ceil(height / props.rowHeight) + OVERSCAN_ROWS * 2 + 2
	colPool.value = Math.max(1, Math.min(cols, Math.ceil(width / narrowest) + OVERSCAN_COLS * 2 + 2))
	firstRow.value = Math.max(0, Math.floor(top / props.rowHeight) - OVERSCAN_ROWS)
	lastRow.value = Math.min(rows - 1, Math.floor((top + height) / props.rowHeight) + OVERSCAN_ROWS)
	firstCol.value = cols === 0 ? 0 : Math.max(0, columnAt(left) - OVERSCAN_COLS)
	lastCol.value = cols === 0 ? -1 : Math.min(cols - 1, columnAt(left + width) + OVERSCAN_COLS)

	// The list under the editor moves with the cell it belongs to.
	if (listOpen.value) {
		placeList()
	}
}

/** Scrolls just far enough for a cell, the moving end of the selection by default, to be fully in view. */
function reveal(target: CellPosition | null = selection.head): void {
	const element = scroller.value

	if (!element || !target) {
		return
	}

	const { width, height } = bodySize()
	const top = target.row * props.rowHeight
	const left = offsets.value[target.col] ?? 0
	const right = offsets.value[target.col + 1] ?? left

	if (top < element.scrollTop) {
		element.scrollTop = top
	} else if (top + props.rowHeight > element.scrollTop + height) {
		element.scrollTop = top + props.rowHeight - height
	}

	if (left < element.scrollLeft) {
		element.scrollLeft = left
	} else if (right > element.scrollLeft + width) {
		element.scrollLeft = Math.min(left, right - width)
	}
}

// ---------------------------------------------------------------- cells

function text(row: number, col: number): string {
	// Read so the render depends on it: the store itself is not reactive.
	void dataVersion.value

	const rowId = store.value.rowIdAt(row)
	const field = fields.value[col]

	return rowId === undefined || field === undefined
		? ""
		: formatCell(field, store.value.get(rowId, field.key), props.valueSettings)
}

/** The issues on a cell, as the issue set has them now. */
function issuesAt(row: number, col: number): readonly Issue[] {
	void issueVersion.value

	const rowId = store.value.rowIdAt(row)
	const field = fields.value[col]

	return rowId === undefined || field === undefined ? [] : issueSet.value.issuesAt(rowId, field.key)
}

/** An error or a warning standing on the cell; failing those, an issue waiting to be checked again. */
function severityClass(issues: readonly Issue[]): string | undefined {
	const standing = issues.filter(issue => !issue.stale)

	if (standing.length > 0) {
		return standing.some(issue => issue.severity === "error") ? "is-error" : "is-warning"
	}

	return issues.length > 0 ? "is-stale" : undefined
}

function issueClass(row: number, col: number): string | undefined {
	return severityClass(issuesAt(row, col))
}

/** Every issue in the user's language, one per line; a stale one says it waits to be checked again. */
function issueLines(issues: readonly Issue[]): string | undefined {
	return issues.length === 0
		? undefined
		: issues
				.map(issue => {
					const text = issueText(issue, props.locale, props.valueSettings)

					return issue.stale ? `${GRID_TEXT[props.locale].recheck}: ${text}` : text
				})
				.join("\n")
}

function issueTitle(row: number, col: number): string | undefined {
	return issueLines(issuesAt(row, col))
}

// ---------------------------------------------------------------- rows

/** Whether the backend's results lock the row: processed, or on its way to be. */
function isLockedRow(rowId: string): boolean {
	return results.value?.isLocked(rowId) ?? false
}

function rowLocked(row: number): boolean {
	void resultVersion.value

	const rowId = store.value.rowIdAt(row)

	return rowId !== undefined && isLockedRow(rowId)
}

/** Where the row stands with the backend: on its way, or its last result. Null before it was ever sent. */
function rowStatus(rowId: string): "sending" | "succeeded" | "failed" | "skipped" | null {
	const result = results.value?.resultOf(rowId) ?? null

	// Locked without having gone through: it is being sent, whatever an earlier run said.
	if (results.value?.isLocked(rowId) && result?.outcome !== "succeeded") {
		return "sending"
	}

	return result?.outcome ?? null
}

/** The row number's classes: where the row stands with the backend, and any issue about the row as a whole. */
function rowClass(row: number): string[] {
	void resultVersion.value
	void issueVersion.value

	const rowId = store.value.rowIdAt(row)

	if (rowId === undefined) {
		return []
	}

	const status = rowStatus(rowId)
	const severity = severityClass(issueSet.value.rowIssues(rowId))

	return [status ? `is-${status}` : "", severity ?? ""].filter(Boolean)
}

/** The row number's tooltip: where the row stands, then the issues about the row as a whole. */
function rowTitle(row: number): string | undefined {
	void resultVersion.value
	void issueVersion.value

	const rowId = store.value.rowIdAt(row)

	if (rowId === undefined) {
		return undefined
	}

	const status = rowStatus(rowId)
	const lines = [status ? GRID_TEXT[props.locale][status] : undefined, issueLines(issueSet.value.rowIssues(rowId))]
	const text = lines.filter(Boolean).join("\n")

	return text === "" ? undefined : text
}

/** Reads text into a field's type: its value, or the text itself when it cannot be read. */
function valueOf(field: FieldSchema, input: string) {
	return readInput(field, input, props.valueSettings).value
}

function isBlank(row: number, col: number): boolean {
	const rowId = store.value.rowIdAt(row)
	const field = fields.value[col]

	return rowId === undefined || field === undefined || store.value.get(rowId, field.key) === null
}

const active = computed(() => {
	void selectionVersion.value

	return selection.active
})

const range = computed(() => {
	void selectionVersion.value

	return selection.range
})

const activeId = computed(() => (active.value ? `${id}-${active.value.row}-${active.value.col}` : undefined))

/** What a screen reader says for the input on the active cell: the column, then what the cell holds. */
const inputLabel = computed(() => {
	const cell = active.value
	const field = cell ? fields.value[cell.col] : undefined

	return cell && field ? `${field.label}: ${text(cell.row, cell.col)}` : undefined
})

function isActive(row: number, col: number): boolean {
	return active.value !== null && active.value.row === row && active.value.col === col
}

function inRange(row: number, col: number): boolean {
	const area = range.value

	return area !== null && row >= area.top && row <= area.bottom && col >= area.left && col <= area.right
}

function rowSelected(row: number): boolean {
	return range.value !== null && row >= range.value.top && row <= range.value.bottom
}

function colSelected(col: number): boolean {
	return range.value !== null && col >= range.value.left && col <= range.value.right
}

function box(area: CellRange): Record<string, string> {
	const left = offsets.value[area.left] ?? 0

	return {
		transform: `translate(${left}px, ${area.top * props.rowHeight}px)`,
		width: `${(offsets.value[area.right + 1] ?? left) - left}px`,
		height: `${(area.bottom - area.top + 1) * props.rowHeight}px`
	}
}

const rangeStyle = computed(() => (range.value ? box(range.value) : {}))

const activeStyle = computed(() => {
	const cell = active.value

	return cell ? box({ top: cell.row, bottom: cell.row, left: cell.col, right: cell.col }) : {}
})

// ---------------------------------------------------------------- editing

interface EditState {
	readonly row: number
	readonly col: number
	/** What the editor opened with for the value there; committing the same text writes nothing. */
	readonly original: string
	/**
	 * `enter` when typing started it, as in Excel: an arrow key commits and moves. `edit` when F2 or a
	 * double click started it: the arrows move the caret.
	 */
	readonly mode: "enter" | "edit"
}

const editing = shallowRef<EditState | null>(null)
const draft = ref("")
let measureDraft: Measure | null = null

/**
 * As in Excel, the editor grows to the right as the text outgrows the cell, so what is being typed
 * stays in view. It never gets narrower than the cell, nor runs past the last column.
 */
const editorStyle = computed(() => {
	const state = editing.value

	if (!state) {
		return {}
	}

	const cellWidth = widths.value[state.col] ?? 0
	const room = totalWidth.value - (offsets.value[state.col] ?? 0)
	const wanted = measureDraft ? measureDraft(draft.value) + EDITOR_CHROME : cellWidth

	return { ...activeStyle.value, width: `${Math.min(Math.max(cellWidth, wanted), Math.max(cellWidth, room))}px` }
})

/**
 * The grid's keyboard goes to one input that sits on the active cell, invisible until it is needed.
 *
 * Text does not always arrive as a key: an input method composes it, a virtual keyboard or dictation
 * inserts it whole. Reading keys alone loses all of that. Whatever reaches this input, however it got
 * there, starts an edit in the same input, so a composition carries on without a break and no key
 * typed quickly after the first is lost on the way to an editor that is not there yet.
 */
function focusInput(): void {
	void nextTick(() => editor.value?.focus({ preventScroll: true }))
}

function onRootFocus(event: FocusEvent): void {
	if (event.target === root.value) {
		focusInput()
	}
}

/** Starts editing the active cell. False when it cannot be edited. */
function beginEdit(mode: EditState["mode"]): boolean {
	const cell = selection.active
	const field = cell ? fields.value[cell.col] : undefined
	const rowId = cell ? store.value.rowIdAt(cell.row) : undefined

	if (!cell || !isEditable(field) || rowId === undefined || rowLocked(cell.row)) {
		return false
	}

	measureDraft = cellProbe.value ? textMeasurer(cellProbe.value) : null
	editing.value = {
		row: cell.row,
		col: cell.col,
		original: editText(field, store.value.get(rowId, field.key), props.valueSettings),
		mode
	}
	reveal()

	return true
}

/** F2 or a double click: edit what is there, the caret at its end. */
function startEdit(): void {
	if (!beginEdit("edit")) {
		return
	}

	draft.value = editing.value?.original ?? ""

	void nextTick(() => {
		const input = editor.value

		input?.focus({ preventScroll: true })
		input?.setSelectionRange(input.value.length, input.value.length)
	})
}

/** Text reached the input while it was waiting: it replaces the cell, as typing does in Excel. */
function onInput(event: Event): void {
	if (editing.value || (event as InputEvent).isComposing) {
		return
	}

	const input = event.target as HTMLInputElement
	const typed = input.value

	if (typed === "") {
		return
	}

	if (beginEdit("enter")) {
		draft.value = typed
	} else {
		input.value = ""
		draft.value = ""
	}
}

/** An input method started composing: the edit starts now, so the composition is never interrupted. */
function onCompositionStart(): void {
	if (!editing.value) {
		beginEdit("enter")
	}
}

function onInputKeydown(event: KeyboardEvent): void {
	// While an input method composes, Enter and the arrows belong to it, not to the grid.
	if (event.isComposing || event.keyCode === 229) {
		return
	}

	if (editing.value) {
		onEditorKeydown(event)
	} else {
		onKeydown(event)
	}
}

function onInputBlur(): void {
	commitEdit(false)
}

/** Writes what was typed. `refocus` is false when focus is leaving the grid and should be let go. */
function commitEdit(refocus = true): void {
	const state = editing.value

	if (!state) {
		return
	}

	const text = draft.value

	editing.value = null
	draft.value = ""

	const rowId = store.value.rowIdAt(state.row)
	const field = fields.value[state.col]

	if (rowId !== undefined && field !== undefined && text !== state.original) {
		store.value.setCell(rowId, field.key, valueOf(field, text))
	}

	if (refocus) {
		focusInput()
	}
}

function cancelEdit(): void {
	editing.value = null
	draft.value = ""
	focusInput()
}

// ---------------------------------------------------------------- suggestions

/** One entry in the list under the editor: an option, or a lookup's record. */
interface Suggestion {
	readonly key: string
	readonly label: string
	readonly description: string | null
	readonly disabled: boolean
	readonly value: CellValue
}

/** How many records the list shows for a lookup; the user types on to narrow it. */
const SUGGESTION_LIMIT = 8
/** Milliseconds typing has to pause before a lookup is searched. */
const SEARCH_DELAY = 150

const suggestions = shallowRef<readonly Suggestion[]>([])
const highlighted = shallowRef(-1)
/** A line under the entries: searching, found nothing, found more than shown, or could not search. */
const listNote = shallowRef<"searching" | "none" | "more" | "unavailable" | null>(null)
const listPlace = shallowRef<{ left: number; top: number; width: number } | null>(null)
const listId = `${id}-list`
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchController: AbortController | null = null

const listOpen = computed(() => editing.value !== null && (suggestions.value.length > 0 || listNote.value !== null))

/** The field being edited, when it offers a list: a single-choice options field, or a lookup with a search. */
const listField = computed<FieldSchema | null>(() => {
	const field = editing.value ? fields.value[editing.value.col] : undefined

	if (field?.type === "options" && !field.multiple) {
		return field
	}

	return field?.type === "lookup" && props.lookups ? field : null
})

/** Compared the way the user reads: in their language, so "İ" is "i" in Turkish. */
function lower(text: string): string {
	return text.trim().toLocaleLowerCase(props.locale)
}

function stopSearch(): void {
	if (searchTimer !== null) {
		clearTimeout(searchTimer)
		searchTimer = null
	}

	searchController?.abort()
	searchController = null
}

function closeList(): void {
	stopSearch()
	suggestions.value = []
	highlighted.value = -1
	listNote.value = null
}

/**
 * The entry Enter picks: the only one named exactly as typed, or the only one there is. None
 * otherwise, so Enter never puts a record the user did not mean in place of what they typed: two
 * records both named "Termos" are for the user to tell apart.
 */
function preferred(list: readonly Suggestion[], query: string): number {
	const needle = lower(query)
	const open = list.filter(item => !item.disabled)
	const exact = open.filter(item => lower(item.label) === needle)
	const only = exact.length === 1 ? exact[0] : exact.length === 0 && open.length === 1 ? open[0] : undefined

	return only ? list.indexOf(only) : -1
}

function showSuggestions(list: readonly Suggestion[], query: string, note: (typeof listNote)["value"]): void {
	suggestions.value = list
	highlighted.value = preferred(list, query)
	listNote.value = note
	void nextTick(placeList)
}

/** Fills the list for what is typed: options at once, a lookup's records once typing pauses. */
function suggest(): void {
	const field = listField.value
	const query = draft.value

	stopSearch()

	if (field?.type === "options") {
		const needle = lower(query)
		const list = field.options
			.filter(
				option =>
					needle === "" || lower(option.label).includes(needle) || lower(String(option.value)) === needle
			)
			.map(option => ({
				key: String(option.value),
				label: option.label,
				description: null,
				disabled: false,
				value: option.value
			}))

		if (list.length > 0) {
			showSuggestions(list, query, null)
		} else {
			closeList()
		}

		return
	}

	if (field?.type !== "lookup" || query.trim() === "") {
		closeList()

		return
	}

	listNote.value = "searching"
	void nextTick(placeList)
	searchTimer = setTimeout(() => void search(field.key, query), SEARCH_DELAY)
}

async function search(field: string, query: string): Promise<void> {
	const lookups = props.lookups
	const controller = new AbortController()

	searchTimer = null
	searchController = controller

	try {
		const response = await lookups?.search(field, query, controller.signal, SUGGESTION_LIMIT)

		if (searchController !== controller || !response) {
			return
		}

		const list = response.items.map(item => ({
			key: String(item.id),
			label: item.label,
			description: item.description ?? null,
			disabled: item.disabled === true,
			value: Object.freeze({ id: item.id, label: item.label })
		}))

		showSuggestions(list, query, list.length === 0 ? "none" : response.more ? "more" : null)
	} catch {
		if (searchController === controller) {
			showSuggestions([], query, "unavailable")
		}
	} finally {
		if (searchController === controller) {
			searchController = null
		}
	}
}

watch([editing, draft], () => suggest())

/** Moves the highlight to the next entry that can be picked, wrapping round. */
function moveHighlight(by: 1 | -1): void {
	const list = suggestions.value

	for (let step = 1; step <= list.length; step++) {
		const index = (highlighted.value + by * step + list.length * 2) % list.length

		if (!list[index]?.disabled) {
			highlighted.value = index

			return
		}
	}
}

/** Puts the entry in the cell being edited, and ends the edit. */
function pick(index: number): boolean {
	const item = suggestions.value[index]
	const state = editing.value

	if (!item || item.disabled || !state) {
		return false
	}

	const rowId = store.value.rowIdAt(state.row)
	const field = fields.value[state.col]

	editing.value = null
	draft.value = ""
	closeList()

	if (rowId !== undefined && field) {
		store.value.setCell(rowId, field.key, item.value)
	}

	focusInput()

	return true
}

/** Places the list under the editor, or over it when there is more room above. */
function placeList(): void {
	const input = editor.value
	const frame = root.value
	const list = frame?.querySelector<HTMLElement>(".tabula-grid-list")

	if (!input || !frame || !listOpen.value) {
		listPlace.value = null

		return
	}

	const cell = input.getBoundingClientRect()
	const box = frame.getBoundingClientRect()
	const height = list?.offsetHeight ?? 0
	const below = box.bottom - cell.bottom
	const above = height > below && cell.top - box.top > below

	listPlace.value = {
		left: cell.left - box.left,
		top: above ? cell.top - box.top - height : cell.bottom - box.top,
		width: cell.width
	}
}

/** The keys a list under the editor takes. False when the key is not the list's. */
function onListKeydown(event: KeyboardEvent): boolean {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		moveHighlight(event.key === "ArrowDown" ? 1 : -1)

		return true
	}

	if (event.key === "Escape") {
		closeList()

		return true
	}

	if ((event.key === "Enter" || event.key === "Tab") && highlighted.value >= 0 && pick(highlighted.value)) {
		if (event.key === "Enter") {
			move(event.shiftKey ? -1 : 1, 0)
		} else {
			move(0, event.shiftKey ? -1 : 1)
		}

		return true
	}

	return false
}

/** Alt+Down on an options cell: an edit that starts with every option listed. */
function openList(): boolean {
	const cell = selection.active
	const field = cell ? fields.value[cell.col] : undefined

	if (field?.type !== "options" || field.multiple || !beginEdit("edit")) {
		return false
	}

	draft.value = ""
	void nextTick(() => editor.value?.focus({ preventScroll: true }))

	return true
}

function onEditorKeydown(event: KeyboardEvent): void {
	const state = editing.value

	if (!state) {
		return
	}

	if (listOpen.value && onListKeydown(event)) {
		event.preventDefault()

		return
	}

	if (event.key === "Enter") {
		commitEdit()
		move(event.shiftKey ? -1 : 1, 0)
	} else if (event.key === "Tab") {
		commitEdit()
		move(0, event.shiftKey ? -1 : 1)
	} else if (event.key === "Escape") {
		cancelEdit()
	} else if (state.mode === "enter" && ARROWS[event.key] !== undefined) {
		const step = STEPS[ARROWS[event.key] as Direction]

		commitEdit()
		move(step.row, step.col)
	} else {
		return
	}

	event.preventDefault()
}

// ---------------------------------------------------------------- keyboard

function move(rows: number, cols: number, extend = false): void {
	selection.move(rows, cols, { extend })
	reveal()
}

function onKeydown(event: KeyboardEvent): void {
	const mod = event.ctrlKey || event.metaKey
	const extend = event.shiftKey
	const from = (extend ? selection.head : selection.active) ?? { row: 0, col: 0 }
	const page = Math.max(1, Math.floor(bodySize().height / props.rowHeight) - 1)
	const direction = ARROWS[event.key]
	const undo = undoKeyOf(event)

	if (undo !== null) {
		// Not followed by reveal(): the step shows what it changed, from its top left.
		event.preventDefault()
		step(undo)

		return
	}

	if (event.altKey && event.key === "ArrowDown" && openList()) {
		event.preventDefault()

		return
	}

	if (direction !== undefined) {
		if (mod) {
			selection.jump(direction, isBlank, { extend })
		} else {
			const step = STEPS[direction]

			selection.move(step.row, step.col, { extend })
		}
	} else {
		switch (event.key) {
			case "Tab": {
				// At the last column Tab leaves the grid, and Shift+Tab at the first: a keyboard user
				// must always have a way out.
				const col = selection.active?.col ?? 0

				if (extend ? col <= 0 : col >= fields.value.length - 1) {
					return
				}

				selection.move(0, extend ? -1 : 1)
				break
			}
			case "Enter":
				selection.move(extend ? -1 : 1, 0)
				break
			case "Home":
				selection.moveTo(mod ? 0 : from.row, 0, { extend })
				break
			case "End":
				selection.moveTo(mod ? Number.POSITIVE_INFINITY : from.row, Number.POSITIVE_INFINITY, { extend })
				break
			case "PageDown":
				selection.move(page, 0, { extend })
				break
			case "PageUp":
				selection.move(-page, 0, { extend })
				break
			case "F2":
				startEdit()
				break
			case "Delete":
			case "Backspace":
				clearRange("clear")
				break
			default:
				if (!handleShortcut(event, mod)) {
					return
				}
		}
	}

	event.preventDefault()
	reveal()
}

/**
 * The keys that are neither movement nor text. False when the key is not the grid's, so the browser
 * keeps it: a character then lands in the input and starts an edit from there.
 */
function handleShortcut(event: KeyboardEvent, mod: boolean): boolean {
	// AltGr arrives as Ctrl and Alt together, and types characters such as "@" on a Turkish keyboard.
	const altGr = event.ctrlKey && event.altKey

	if (event.key === " " && event.shiftKey && !mod) {
		const cell = selection.active

		if (cell) {
			selection.selectRows(cell.row)
		}

		return true
	}

	if (event.key === " " && mod && !event.shiftKey) {
		const cell = selection.active

		if (cell) {
			selection.selectColumns(cell.col)
		}

		return true
	}

	if (mod && !altGr && event.key.toLowerCase() === "a") {
		selection.selectAll()

		return true
	}

	return false
}

/**
 * Ctrl+Z is undo; Ctrl+Y and Ctrl+Shift+Z are redo. Null for any other key. While a cell is being
 * edited these never get here: they belong to the editor, and undo what was typed into it.
 */
function undoKeyOf(event: KeyboardEvent): "undo" | "redo" | null {
	const key = event.key.toLowerCase()

	if (!(event.ctrlKey || event.metaKey) || event.altKey || (key !== "z" && key !== "y")) {
		return null
	}

	return key === "y" || event.shiftKey ? "redo" : "undo"
}

// ---------------------------------------------------------------- undo

/** Undoes or redoes a step. False when there was none to take, or the grid is read-only. */
function step(direction: "undo" | "redo"): boolean {
	if (props.readonly) {
		return false
	}

	commitEdit(false)

	try {
		return (direction === "undo" ? undoHistory.value.undo() : undoHistory.value.redo()) !== null
	} catch (error) {
		// The history no longer matched the sheet and has cleared itself; the sheet is untouched.
		if (error instanceof TabulaError && error.code === "conflict") {
			return false
		}

		throw error
	}
}

/**
 * After an undo or a redo, whoever asked for it, selects the cells it changed and brings them into
 * view, as Excel does: what the user cannot see changing back, they cannot trust changed back.
 */
function showChange(change: StoreChange): void {
	const rows = store.value
	const columns = new Map(fields.value.map((field, index) => [field.key, index]))
	const cells = { top: Infinity, left: Infinity, bottom: -1, right: -1 }
	const added = { top: Infinity, bottom: -1 }
	let removedAt = Infinity

	for (const operation of change.operations) {
		if (operation.kind === "set") {
			const row = rows.indexOf(operation.rowId)
			const col = columns.get(operation.field)

			if (row >= 0 && col !== undefined) {
				cells.top = Math.min(cells.top, row)
				cells.bottom = Math.max(cells.bottom, row)
				cells.left = Math.min(cells.left, col)
				cells.right = Math.max(cells.right, col)
			}
		} else if (operation.kind === "insert") {
			for (const entry of operation.rows) {
				const row = rows.indexOf(entry.rowId)

				if (row >= 0) {
					added.top = Math.min(added.top, row)
					added.bottom = Math.max(added.bottom, row)
				}
			}
		} else {
			removedAt = Math.min(removedAt, operation.rows[0]?.index ?? Infinity)
		}
	}

	// A cell being edited would write its text over what came back.
	editing.value = null
	draft.value = ""

	if (cells.bottom >= 0) {
		selection.moveTo(cells.top, cells.left)
		selection.moveTo(cells.bottom, cells.right, { extend: true })
	} else if (added.bottom >= 0) {
		selection.selectRows(added.top, added.bottom)
	} else if (removedAt !== Infinity) {
		selection.moveTo(removedAt, selection.active?.col ?? 0)
	}

	reveal(selection.active)
}

// ---------------------------------------------------------------- clipboard

function rangeText(area: CellRange): string {
	const rows: string[][] = []

	for (let row = area.top; row <= area.bottom; row++) {
		const cells: string[] = []

		for (let col = area.left; col <= area.right; col++) {
			cells.push(text(row, col))
		}

		rows.push(cells)
	}

	return toTsv(rows)
}

function onCopy(event: ClipboardEvent): void {
	const area = selection.range

	if (editing.value || !area || !event.clipboardData) {
		return
	}

	event.clipboardData.setData("text/plain", rangeText(area))
	event.preventDefault()
}

function onCut(event: ClipboardEvent): void {
	if (editing.value || props.readonly) {
		return
	}

	onCopy(event)
	clearRange("cut")
}

/**
 * Pastes what a spreadsheet copied, starting at the top left of the selection.
 *
 * As in Excel, one value pasted over a larger selection fills all of it. Unlike Excel, a paste that
 * runs past the last row adds the rows it needs: this is a sheet for entering data, and pasting 500
 * rows into an empty one is the point. Columns past the last are dropped, and a column that cannot
 * be edited is passed over, so every other value still lands in its own column.
 */
function onPaste(event: ClipboardEvent): void {
	const area = selection.range

	if (editing.value || props.readonly || !area) {
		return
	}

	const block = parseTsv(event.clipboardData?.getData("text/plain") ?? "")

	event.preventDefault()

	if (block.length === 0) {
		return
	}

	const single = block.length === 1 && block[0]?.length === 1
	const fill = single && (area.bottom > area.top || area.right > area.left)
	const height = fill ? area.bottom - area.top + 1 : block.length
	const width = fill ? area.right - area.left + 1 : Math.max(...block.map(row => row.length))
	const rows = store.value
	const cols = fields.value

	rows.transact(
		() => {
			const missing = area.top + height - rows.size

			if (missing > 0) {
				rows.appendRows(missing)
			}

			for (let offset = 0; offset < height; offset++) {
				const rowId = rows.rowIdAt(area.top + offset)

				for (let step = 0; step < width && area.left + step < cols.length; step++) {
					const field = cols[area.left + step]
					const value = fill ? block[0]?.[0] : block[offset]?.[step]

					if (rowId !== undefined && isEditable(field) && value !== undefined && !isLockedRow(rowId)) {
						rows.setCell(rowId, field.key, valueOf(field, value))
					}
				}
			}
		},
		{ origin: "paste" }
	)

	selection.moveTo(area.top, area.left)
	selection.moveTo(area.top + height - 1, Math.min(area.left + width, cols.length) - 1, { extend: true })
	reveal()
}

function clearRange(origin: string): void {
	const area = selection.range

	if (!area || props.readonly) {
		return
	}

	const rows = store.value

	rows.transact(
		() => {
			for (let row = area.top; row <= area.bottom; row++) {
				const rowId = rows.rowIdAt(row)

				for (let col = area.left; col <= area.right; col++) {
					const field = fields.value[col]

					if (rowId !== undefined && isEditable(field) && !isLockedRow(rowId)) {
						rows.setCell(rowId, field.key, null)
					}
				}
			}
		},
		{ origin }
	)
}

// ---------------------------------------------------------------- mouse

let stopDrag: (() => void) | null = null

/** Follows the mouse until the button is let go, wherever it goes. */
function drag(onMove: (event: MouseEvent) => void, onEnd?: () => void): void {
	stopDrag?.()

	const end = (): void => {
		window.removeEventListener("mousemove", onMove)
		window.removeEventListener("mouseup", end)
		stopDrag = null
		onEnd?.()
	}

	window.addEventListener("mousemove", onMove)
	window.addEventListener("mouseup", end)
	stopDrag = end
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

function cellAt(event: MouseEvent): CellPosition | null {
	const element = body.value

	if (!element || rowCount.value === 0 || fields.value.length === 0) {
		return null
	}

	const rect = element.getBoundingClientRect()

	return {
		row: clamp(Math.floor((event.clientY - rect.top) / props.rowHeight), 0, rowCount.value - 1),
		col: columnAt(clamp(event.clientX - rect.left, 0, totalWidth.value - 1))
	}
}

/**
 * A press anywhere on the grid ends an edit and brings the keyboard to the grid's input. The press's
 * own default is stopped, or the browser would move focus to the press's target and away again.
 */
function takeFocus(event: MouseEvent): void {
	event.preventDefault()
	commitEdit(false)
	focusInput()
}

function onBodyDown(event: MouseEvent): void {
	if (event.button !== 0 || (editing.value && event.target === editor.value)) {
		return
	}

	takeFocus(event)

	const cell = cellAt(event)

	if (!cell) {
		return
	}

	selection.moveTo(cell.row, cell.col, { extend: event.shiftKey })
	drag(move => {
		const over = cellAt(move)

		if (over) {
			selection.moveTo(over.row, over.col, { extend: true })
		}
	})
}

function columnAtClient(clientX: number): number {
	const rect = head.value?.getBoundingClientRect()

	return columnAt(Math.max(0, clientX - (rect?.left ?? 0) - gutterWidth.value))
}

function rowAtClient(clientY: number): number {
	const rect = gutter.value?.getBoundingClientRect()

	return clamp(Math.floor((clientY - (rect?.top ?? 0)) / props.rowHeight), 0, Math.max(0, rowCount.value - 1))
}

function onHeaderDown(event: MouseEvent, col: number): void {
	if (event.button !== 0) {
		return
	}

	takeFocus(event)

	const from = event.shiftKey && selection.active ? selection.active.col : col

	selection.selectColumns(from, col)
	drag(move => selection.selectColumns(from, columnAtClient(move.clientX)))
}

function onGutterDown(event: MouseEvent, row: number): void {
	if (event.button !== 0) {
		return
	}

	takeFocus(event)

	const from = event.shiftKey && selection.active ? selection.active.row : row

	selection.selectRows(from, row)
	drag(move => selection.selectRows(from, rowAtClient(move.clientY)))
}

function onCornerDown(event: MouseEvent): void {
	if (event.button === 0) {
		takeFocus(event)
		selection.selectAll()
	}
}

function onResizeStart(event: MouseEvent, col: number): void {
	const field = fields.value[col]
	const sizing = sizings.value[col]

	if (event.button !== 0 || !field || !sizing) {
		return
	}

	const startX = event.clientX
	const startWidth = widths.value[col] ?? sizing.minWidth

	drag(
		move => {
			liveWidth.value = { key: field.key, width: clampColumnWidth(startWidth + move.clientX - startX, sizing) }
		},
		() => {
			const live = liveWidth.value

			liveWidth.value = null

			if (live && live.width !== startWidth) {
				setWidth(live.key, live.width)
			}
		}
	)
}

// ---------------------------------------------------------------- wiring

function syncSize(): void {
	rowCount.value = store.value.size
	selection.resize(rowCount.value, fields.value.length)
	updateWindow()
}

const stopSelection = selection.subscribe(() => {
	selectionVersion.value++
})

watch(
	() => toRaw(props.store),
	(next, _previous, onCleanup) => {
		store.value = next
		editing.value = null
		syncSize()
		dataVersion.value++

		onCleanup(
			next.subscribe(change => {
				dataVersion.value++

				if (next.size !== rowCount.value) {
					syncSize()
				}

				if (change.origin === UNDO_ORIGIN || change.origin === REDO_ORIGIN) {
					showChange(change)
				}
			})
		)
	},
	{ immediate: true }
)

// The undo history: the host's when given, otherwise one of the grid's own for the store, made again
// when the store is replaced.
let ownHistory: UndoHistory | null = null
const undoHistory = shallowRef<UndoHistory>(toRaw(props.history) ?? (ownHistory = new UndoHistory(store.value)))

watch(
	() => [toRaw(props.history), store.value] as const,
	([given, nextStore]) => {
		ownHistory?.dispose()
		ownHistory = given ? null : new UndoHistory(nextStore)
		undoHistory.value = given ?? (ownHistory as UndoHistory)
	}
)

watch(
	() => toRaw(props.schema),
	next => {
		schema.value = next
		editing.value = null
		syncSize()
	}
)

// The issues: the host's when given, otherwise those of a validator of the grid's own for this schema
// and store, made again when either is replaced.
const issueSet = shallowRef<IssueSet>(
	toRaw(props.issues) ?? new SheetValidator(schema.value, store.value, props.valueSettings)
)
const issueVersion = shallowRef(0)
let ownValidator: SheetValidator | null = props.issues ? null : (issueSet.value as SheetValidator)

watch(
	() => [toRaw(props.issues), schema.value, store.value] as const,
	([given, nextSchema, nextStore], previous, onCleanup) => {
		if (given) {
			ownValidator?.dispose()
			ownValidator = null
			issueSet.value = given
		} else if (!ownValidator || previous !== undefined) {
			ownValidator?.dispose()
			ownValidator = new SheetValidator(nextSchema, nextStore, props.valueSettings)
			issueSet.value = ownValidator
		}

		issueVersion.value++
		onCleanup(issueSet.value.subscribe(() => issueVersion.value++))
	},
	{ immediate: true }
)

// The backend's results, when the host gives them.
const results = shallowRef<RowResults | undefined>(toRaw(props.results))
const resultVersion = shallowRef(0)

watch(
	() => toRaw(props.results),
	(given, _previous, onCleanup) => {
		results.value = given
		resultVersion.value++

		if (given) {
			onCleanup(given.subscribe(() => resultVersion.value++))
		}
	},
	{ immediate: true }
)

watch(
	() => props.valueSettings,
	settings => {
		// Only the grid's own: a validator from the host keeps the settings the host gave it.
		ownValidator?.setSettings(settings)
	}
)

watch(sizings, () => measureHeaders())
watch(offsets, () => updateWindow())
watch(
	() => props.rowHeight,
	() => updateWindow()
)

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
	measureHeaders()
	updateWindow()

	if (scroller.value) {
		resizeObserver = new ResizeObserver(() => updateWindow())
		resizeObserver.observe(scroller.value)
	}

	// A web font that arrives later is a different width; measure again once it has.
	void document.fonts?.ready.then(() => measureHeaders())
})

onBeforeUnmount(() => {
	stopSearch()
	ownValidator?.dispose()
	ownHistory?.dispose()
	resizeObserver?.disconnect()
	stopDrag?.()
	stopSelection()
})

/**
 * Goes to a row, and to one of its fields when given: selects the cell, scrolls it into view and
 * gives the grid the keyboard. An issue's rowId and field are what it takes. False when the row is
 * no longer there.
 */
function goTo(rowId: string, field?: string | null): boolean {
	const row = store.value.indexOf(rowId)

	if (row < 0) {
		return false
	}

	commitEdit(false)

	const col = field ? fields.value.findIndex(candidate => candidate.key === field) : -1

	selection.moveTo(row, col < 0 ? (selection.active?.col ?? 0) : col)
	reveal()
	focusInput()

	return true
}

defineExpose({
	/** The selection, in on-screen positions. */
	selection,
	goTo,
	focus: focusInput,
	/** Fits a column to its header and contents, as a double click on its edge does. */
	autoFit,
	/** Takes the last step back, as Ctrl+Z does, and gives the grid the keyboard. False when there was none. */
	undo: (): boolean => {
		focusInput()

		return step("undo")
	},
	/** Makes the last step taken back again, as Ctrl+Y does. False when there was none. */
	redo: (): boolean => {
		focusInput()

		return step("redo")
	}
})
</script>

<template>
	<div
		ref="root"
		class="tabula-grid"
		role="grid"
		:tabindex="active ? -1 : 0"
		:data-tabula-theme="theme"
		:style="{ '--tabula-row-height': `${rowHeight}px` }"
		:aria-rowcount="rowCount + 1"
		:aria-colcount="fields.length"
		:aria-readonly="readonly || undefined"
		aria-multiselectable="true"
		:aria-activedescendant="activeId"
		@focus="onRootFocus"
		@copy="onCopy"
		@cut="onCut"
		@paste="onPaste"
	>
		<div ref="scroller" class="tabula-grid-scroller" @scroll.passive="updateWindow">
			<div
				class="tabula-grid-sheet"
				:style="{ width: `${gutterWidth + totalWidth}px`, height: `${HEADER_HEIGHT + totalHeight}px` }"
			>
				<div
					ref="head"
					class="tabula-grid-head"
					role="row"
					aria-rowindex="1"
					:style="{ width: `${gutterWidth + totalWidth}px`, height: `${HEADER_HEIGHT}px` }"
				>
					<div class="tabula-grid-corner" :style="{ width: `${gutterWidth}px` }" @mousedown="onCornerDown" />
					<div
						v-for="c in visibleCols"
						:key="c % colPool"
						class="tabula-grid-th"
						role="columnheader"
						:aria-colindex="c + 1"
						:class="{ 'is-right': cellClasses[c]?.includes('is-right'), 'is-selected': colSelected(c) }"
						:style="headerStyle(c)"
						:title="fields[c]?.label"
						@mousedown="onHeaderDown($event, c)"
					>
						<span class="tabula-grid-th-text">{{ headerText(c) }}</span>
						<span v-if="fields[c]?.required" class="tabula-grid-required" aria-hidden="true">*</span>
						<span
							v-if="sizings[c]?.resizable"
							class="tabula-grid-resize"
							aria-hidden="true"
							@mousedown.stop="onResizeStart($event, c)"
							@dblclick.stop="autoFit(c)"
						/>
					</div>
				</div>
				<div
					ref="gutter"
					class="tabula-grid-gutter"
					aria-hidden="true"
					:style="{ width: `${gutterWidth}px`, height: `${totalHeight}px` }"
				>
					<div
						v-for="r in visibleRows"
						:key="r % rowPool"
						class="tabula-grid-rh"
						:class="[{ 'is-selected': rowSelected(r) }, rowClass(r)]"
						:title="rowTitle(r)"
						:style="{ transform: `translateY(${r * rowHeight}px)` }"
						@mousedown="onGutterDown($event, r)"
					>
						{{ r + 1 }}
					</div>
				</div>
				<div
					ref="body"
					class="tabula-grid-body"
					:data-version="dataVersion"
					:style="{
						top: `${HEADER_HEIGHT}px`,
						left: `${gutterWidth}px`,
						width: `${totalWidth}px`,
						height: `${totalHeight}px`
					}"
					@mousedown="onBodyDown"
					@dblclick="startEdit()"
				>
					<div
						v-for="r in visibleRows"
						:key="r % rowPool"
						class="tabula-grid-row"
						:class="{ 'is-locked': rowLocked(r) }"
						role="row"
						:aria-rowindex="r + 2"
						:style="{ transform: `translateY(${r * rowHeight}px)` }"
					>
						<div
							v-for="c in visibleCols"
							:id="isActive(r, c) ? activeId : undefined"
							:key="c % colPool"
							class="tabula-grid-cell"
							role="gridcell"
							:aria-colindex="c + 1"
							:aria-selected="inRange(r, c)"
							:aria-readonly="!isEditable(fields[c]) || rowLocked(r) || undefined"
							:aria-invalid="issueClass(r, c) === 'is-error' ? 'true' : undefined"
							:class="[cellClasses[c], issueClass(r, c)]"
							:style="cellStyles[c]"
							:title="issueTitle(r, c)"
						>
							{{ text(r, c) }}
						</div>
					</div>
					<div v-if="range" class="tabula-grid-range" :style="rangeStyle" />
					<div v-if="active" class="tabula-grid-active" :style="activeStyle" />
					<input
						v-if="active"
						ref="editor"
						v-model="draft"
						class="tabula-grid-input"
						:class="editing ? ['is-editing', cellClasses[editing.col]] : undefined"
						:style="editing ? editorStyle : activeStyle"
						:aria-label="inputLabel"
						:role="listField ? 'combobox' : undefined"
						:aria-autocomplete="listField ? 'list' : undefined"
						:aria-expanded="listField ? listOpen : undefined"
						:aria-controls="listField ? listId : undefined"
						:aria-activedescendant="listOpen && highlighted >= 0 ? `${listId}-${highlighted}` : undefined"
						autocomplete="off"
						spellcheck="false"
						@keydown="onInputKeydown"
						@input="onInput"
						@compositionstart="onCompositionStart"
						@blur="onInputBlur"
						@mousedown.stop
					/>
				</div>
			</div>
		</div>
		<ul
			v-if="listOpen"
			:id="listId"
			class="tabula-grid-list"
			role="listbox"
			:style="
				listPlace
					? { left: `${listPlace.left}px`, top: `${listPlace.top}px`, minWidth: `${listPlace.width}px` }
					: { visibility: 'hidden' }
			"
		>
			<li
				v-for="(item, index) in suggestions"
				:id="`${listId}-${index}`"
				:key="item.key"
				class="tabula-grid-option"
				:class="{ 'is-highlighted': index === highlighted, 'is-disabled': item.disabled }"
				role="option"
				:aria-selected="index === highlighted"
				:aria-disabled="item.disabled || undefined"
				@mousedown.prevent="pick(index)"
				@mousemove="item.disabled || (highlighted = index)"
			>
				<span class="tabula-grid-option-label">{{ item.label }}</span>
				<span v-if="item.description" class="tabula-grid-option-description">{{ item.description }}</span>
			</li>
			<li v-if="listNote" class="tabula-grid-list-note" role="presentation">{{ GRID_TEXT[locale][listNote] }}</li>
		</ul>
		<div ref="headerProbe" class="tabula-grid-th tabula-grid-probe" aria-hidden="true" />
		<div ref="cellProbe" class="tabula-grid-cell tabula-grid-probe" aria-hidden="true" />
	</div>
</template>

<style>
.tabula-grid {
	--tabula-bg: #ffffff;
	--tabula-fg: #161922;
	--tabula-muted: #586074;
	--tabula-line: #e3e6ee;
	--tabula-head-bg: #eceef4;
	--tabula-head-line: #d6dae4;
	--tabula-head-selected-bg: #dbe1f6;
	--tabula-readonly-bg: #f6f7fa;
	--tabula-accent: #2946c9;
	--tabula-range-bg: rgb(41 70 201 / 10%);
	--tabula-required: #ad2a22;
	--tabula-error-bg: #fbe8e6;
	--tabula-warning-bg: #fdf1dc;
	--tabula-error-mark: #c0392b;
	--tabula-warning-mark: #c27c0e;
	--tabula-stale-mark: #8a93a8;
	--tabula-success-bg: #e3f4e8;
	--tabula-success-mark: #1e8a4c;
	--tabula-font-size: 13px;

	position: relative;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	min-height: 0;
	border: 1px solid var(--tabula-head-line);
	outline: none;
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	font-size: var(--tabula-font-size);
	line-height: 1.35;
	font-variant-numeric: tabular-nums;
	user-select: none;
}

.tabula-grid[data-tabula-theme="dark"] {
	--tabula-bg: #191c24;
	--tabula-fg: #e7e9f0;
	--tabula-muted: #9aa2b6;
	--tabula-line: #2c3140;
	--tabula-head-bg: #222632;
	--tabula-head-line: #343a4c;
	--tabula-head-selected-bg: #2c3660;
	--tabula-readonly-bg: #1e212a;
	--tabula-accent: #92a6ff;
	--tabula-range-bg: rgb(146 166 255 / 16%);
	--tabula-required: #ff9087;
	--tabula-error-bg: #3b2220;
	--tabula-warning-bg: #3a2c12;
	--tabula-error-mark: #ff8a80;
	--tabula-warning-mark: #f0b860;
	--tabula-stale-mark: #7d869c;
	--tabula-success-bg: #1d3427;
	--tabula-success-mark: #6fd39a;

	color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
	.tabula-grid[data-tabula-theme="auto"] {
		--tabula-bg: #191c24;
		--tabula-fg: #e7e9f0;
		--tabula-muted: #9aa2b6;
		--tabula-line: #2c3140;
		--tabula-head-bg: #222632;
		--tabula-head-line: #343a4c;
		--tabula-head-selected-bg: #2c3660;
		--tabula-readonly-bg: #1e212a;
		--tabula-accent: #92a6ff;
		--tabula-range-bg: rgb(146 166 255 / 16%);
		--tabula-required: #ff9087;
		--tabula-error-bg: #3b2220;
		--tabula-warning-bg: #3a2c12;
		--tabula-error-mark: #ff8a80;
		--tabula-warning-mark: #f0b860;
		--tabula-stale-mark: #7d869c;
		--tabula-success-bg: #1d3427;
		--tabula-success-mark: #6fd39a;

		color-scheme: dark;
	}
}

.tabula-grid-scroller {
	position: relative;
	flex: 1;
	min-height: 0;
	overflow: auto;
	overscroll-behavior: contain;
}

.tabula-grid-sheet {
	position: relative;
}

.tabula-grid-head {
	position: sticky;
	top: 0;
	z-index: 3;
	box-sizing: border-box;
	border-bottom: 1px solid var(--tabula-head-line);
	background: var(--tabula-head-bg);
}

.tabula-grid-corner {
	position: sticky;
	left: 0;
	z-index: 1;
	box-sizing: border-box;
	height: 100%;
	border-right: 1px solid var(--tabula-head-line);
	background: var(--tabula-head-bg);
}

.tabula-grid-th {
	position: absolute;
	top: 0;
	display: flex;
	align-items: center;
	box-sizing: border-box;
	height: 100%;
	padding: 0 10px;
	overflow: hidden;
	border-right: 1px solid var(--tabula-head-line);
	font-weight: 600;
	white-space: nowrap;
}

.tabula-grid-th.is-right {
	justify-content: flex-end;
}

.tabula-grid-th.is-selected,
.tabula-grid-rh.is-selected {
	background: var(--tabula-head-selected-bg);
	color: var(--tabula-fg);
}

.tabula-grid-th-text {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.tabula-grid-required {
	flex: none;
	padding-left: 3px;
	color: var(--tabula-required);
}

.tabula-grid-resize {
	position: absolute;
	top: 0;
	right: 0;
	width: 6px;
	height: 100%;
	cursor: col-resize;
}

.tabula-grid-resize:hover {
	background: var(--tabula-accent);
}

.tabula-grid-gutter {
	position: sticky;
	left: 0;
	z-index: 2;
	box-sizing: border-box;
	border-right: 1px solid var(--tabula-head-line);
	background: var(--tabula-head-bg);
}

.tabula-grid-rh {
	position: absolute;
	top: 0;
	right: 0;
	left: 0;
	box-sizing: border-box;
	height: var(--tabula-row-height);
	padding-right: 8px;
	border-bottom: 1px solid var(--tabula-head-line);
	color: var(--tabula-muted);
	font-size: 0.92em;
	line-height: calc(var(--tabula-row-height) - 1px);
	text-align: right;
}

.tabula-grid-body {
	position: absolute;
	z-index: 0;
	overflow: hidden;
}

.tabula-grid-row {
	position: absolute;
	top: 0;
	right: 0;
	left: 0;
	height: var(--tabula-row-height);
	contain: layout style;
}

.tabula-grid-cell {
	position: absolute;
	top: 0;
	box-sizing: border-box;
	height: var(--tabula-row-height);
	padding: 0 9px;
	overflow: hidden;
	border-right: 1px solid var(--tabula-line);
	border-bottom: 1px solid var(--tabula-line);
	line-height: calc(var(--tabula-row-height) - 1px);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-grid-cell.is-right {
	text-align: right;
}

.tabula-grid-cell.is-center {
	text-align: center;
}

/* A cell with an issue, Excel-style: a tint and a mark in the corner, red for an error and amber for a warning. */
.tabula-grid-cell.is-error {
	background: var(--tabula-error-bg);
}

.tabula-grid-cell.is-warning {
	background: var(--tabula-warning-bg);
}

.tabula-grid-cell.is-error::after,
.tabula-grid-cell.is-warning::after {
	content: "";
	position: absolute;
	top: 0;
	right: 0;
	border-width: 0 7px 7px 0;
	border-style: solid;
	border-color: transparent var(--tabula-error-mark) transparent transparent;
}

.tabula-grid-cell.is-warning::after {
	border-right-color: var(--tabula-warning-mark);
}

/* A backend's issue on a cell changed since: no tint, a grey corner, until it is checked again. */
.tabula-grid-cell.is-stale::after {
	content: "";
	position: absolute;
	top: 0;
	right: 0;
	border-width: 0 7px 7px 0;
	border-style: solid;
	border-color: transparent var(--tabula-stale-mark) transparent transparent;
}

/* A row the backend processed, or one on its way: shown, not changed. */
.tabula-grid-row.is-locked .tabula-grid-cell {
	color: var(--tabula-muted);
}

/* Where each row stands with the backend, as a bar on its number. */
.tabula-grid-rh.is-succeeded {
	background: var(--tabula-success-bg);
	box-shadow: inset 3px 0 0 var(--tabula-success-mark);
}

.tabula-grid-rh.is-failed {
	background: var(--tabula-error-bg);
	box-shadow: inset 3px 0 0 var(--tabula-error-mark);
}

.tabula-grid-rh.is-skipped {
	box-shadow: inset 3px 0 0 var(--tabula-stale-mark);
}

.tabula-grid-rh.is-sending {
	box-shadow: inset 3px 0 0 var(--tabula-accent);
}

/* An issue about the row as a whole is on its number. */
.tabula-grid-rh.is-error {
	color: var(--tabula-error-mark);
	font-weight: 600;
}

.tabula-grid-rh.is-warning {
	color: var(--tabula-warning-mark);
	font-weight: 600;
}

.tabula-grid-cell.is-readonly {
	background: var(--tabula-readonly-bg);
	color: var(--tabula-muted);
}

.tabula-grid-range,
.tabula-grid-active {
	position: absolute;
	top: 0;
	left: 0;
	pointer-events: none;
}

.tabula-grid-range {
	background: var(--tabula-range-bg);
}

.tabula-grid-active {
	box-shadow: inset 0 0 0 2px var(--tabula-muted);
}

.tabula-grid:focus-within .tabula-grid-active {
	box-shadow: inset 0 0 0 2px var(--tabula-accent);
}

/* Waiting on the active cell for whatever is typed: there, focused, and not seen. */
.tabula-grid-input {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 1;
	box-sizing: border-box;
	margin: 0;
	padding: 0 7px;
	border: 2px solid transparent;
	border-radius: 0;
	outline: none;
	background: transparent;
	color: transparent;
	font: inherit;
	opacity: 0;
	caret-color: transparent;
	pointer-events: none;
	user-select: text;
}

.tabula-grid-input.is-editing {
	border-color: var(--tabula-accent);
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	opacity: 1;
	caret-color: auto;
	pointer-events: auto;
}

.tabula-grid-input.is-right {
	text-align: right;
}

/* The list under the editor: options, or a lookup's records. */
.tabula-grid-list {
	position: absolute;
	z-index: 5;
	box-sizing: border-box;
	max-width: 420px;
	max-height: 280px;
	margin: 0;
	padding: 2px 0;
	overflow: auto;
	border: 1px solid var(--tabula-head-line);
	border-radius: 0 0 4px 4px;
	background: var(--tabula-bg);
	box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
	list-style: none;
	user-select: none;
}

.tabula-grid-option {
	display: flex;
	gap: 10px;
	align-items: baseline;
	justify-content: space-between;
	padding: 5px 10px;
	white-space: nowrap;
	cursor: pointer;
}

.tabula-grid-option.is-highlighted {
	background: var(--tabula-range-bg);
	box-shadow: inset 2px 0 0 var(--tabula-accent);
}

.tabula-grid-option.is-disabled {
	color: var(--tabula-muted);
	cursor: default;
}

.tabula-grid-option-label {
	overflow: hidden;
	text-overflow: ellipsis;
}

.tabula-grid-option-description,
.tabula-grid-list-note {
	color: var(--tabula-muted);
	font-size: 0.92em;
}

.tabula-grid-list-note {
	padding: 5px 10px;
}

.tabula-grid-probe {
	position: absolute;
	top: 0;
	left: -10000px;
	visibility: hidden;
	pointer-events: none;
}
</style>
