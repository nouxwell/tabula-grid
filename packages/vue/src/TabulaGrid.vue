<script setup lang="ts">
import {
	autoColumnWidth,
	clampColumnWidth,
	headerDisplayText,
	parseTsv,
	resolveColumnSizing,
	Selection,
	toTsv,
	type CellPosition,
	type CellRange,
	type ColumnSizing,
	type Direction,
	type FieldSchema,
	type ModuleSchema,
	type RowStore
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
import { alignmentOf, cellText, editText } from "./cellText"
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
	/** Pixels. */
	rowHeight: { type: Number, default: 30 }
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
		const text = rowId === undefined ? "" : cellText(field, rows.get(rowId, field.key))

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
}

/** Scrolls just far enough for the moving end of the selection to be fully in view. */
function reveal(): void {
	const element = scroller.value
	const target = selection.head

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

	return rowId === undefined || field === undefined ? "" : cellText(field, store.value.get(rowId, field.key))
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

	if (!cell || !isEditable(field) || rowId === undefined) {
		return false
	}

	measureDraft = cellProbe.value ? textMeasurer(cellProbe.value) : null
	editing.value = { row: cell.row, col: cell.col, original: editText(field, store.value.get(rowId, field.key)), mode }
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
		store.value.setCell(rowId, field.key, text === "" ? null : text)
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

function onEditorKeydown(event: KeyboardEvent): void {
	const state = editing.value

	if (!state) {
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

					if (rowId !== undefined && isEditable(field) && value !== undefined) {
						rows.setCell(rowId, field.key, value === "" ? null : value)
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

					if (rowId !== undefined && isEditable(field)) {
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
			next.subscribe(() => {
				dataVersion.value++

				if (next.size !== rowCount.value) {
					syncSize()
				}
			})
		)
	},
	{ immediate: true }
)

watch(
	() => toRaw(props.schema),
	next => {
		schema.value = next
		editing.value = null
		syncSize()
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
	resizeObserver?.disconnect()
	stopDrag?.()
	stopSelection()
})

defineExpose({
	/** The selection, in on-screen positions. */
	selection,
	focus: focusInput,
	/** Fits a column to its header and contents, as a double click on its edge does. */
	autoFit
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
						:class="{ 'is-selected': rowSelected(r) }"
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
							:aria-readonly="!isEditable(fields[c]) || undefined"
							:class="cellClasses[c]"
							:style="cellStyles[c]"
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

.tabula-grid-probe {
	position: absolute;
	top: 0;
	left: -10000px;
	visibility: hidden;
	pointer-events: none;
}
</style>
