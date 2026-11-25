<script setup lang="ts">
import {
	adjustValue,
	arrangeColumns,
	autoColumnWidth,
	clampColumnWidth,
	distinctValues,
	editText,
	fillValues,
	filterKeys,
	formatCell,
	formulaParts,
	formulaSheets,
	hasRange,
	headerDisplayText,
	isFormulaError,
	isLookupValue,
	lookupFills,
	mergeColumnFormats,
	parseFormula,
	parseTsv,
	readInput,
	REDO_ORIGIN,
	rowOrder,
	rowsMatching,
	rowStyles,
	RowView,
	summarizeCells,
	resolveColumnSizing,
	Selection,
	SheetValidator,
	TabulaError,
	toTsv,
	UNDO_ORIGIN,
	UndoHistory,
	VALUE_SETTINGS,
	withColumn,
	withDefaults,
	type Adjustment,
	type CellMarkChange,
	type CellMarks,
	type CellWrite,
	type FormulaSheets,
	type SharedMarks,
	type CellStyle,
	type FoundCell,
	type MarkedCell,
	type CellPosition,
	type CellRange,
	type ColumnFilters,
	type ColumnSizing,
	type ColumnSort,
	type DistinctValue,
	type Direction,
	type FillMode,
	type CellValue,
	type ColumnFormats,
	type ColumnLayout,
	type FieldSchema,
	type Issue,
	type IssueSet,
	type LookupItem,
	type LookupSearch,
	type ModuleSchema,
	type RowResults,
	type RowStore,
	type SheetChanges,
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
import { columnName, parseAddress } from "./address.js"
import FormulaHelp from "./FormulaHelp.vue"
import {
	entryHelp,
	entryPoints,
	entryReferences,
	entryResult,
	isEntryFormula,
	type EntryColumn,
	type EntryResult
} from "./formulaEntry.js"
import ScrollThumbs from "./ScrollThumbs.vue"
import { alignmentOf } from "./alignment.js"
import { GRID_TEXT, issueText, type GridLocale } from "./messages.js"
import { horizontalPadding, textMeasurer, type Measure } from "./measure.js"
import type { ActiveCell, GridMenuItem, GridPosition, GridTheme, SelectedCells } from "./types.js"

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
	 * The rows to show, such as a `RowView` filtered to the rows with issues. Left out, every row is.
	 * Row numbers stay the rows' numbers in the sheet, filtered or not.
	 */
	view: { type: Object as PropType<RowView>, default: undefined },
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
	/**
	 * What the user changed since the sheet was loaded, such as a `SheetChanges`: a changed cell has a
	 * mark in its top left corner. Left out, nothing is marked.
	 */
	changes: { type: Object as PropType<SheetChanges>, default: undefined },
	/** Letters over the headers, A, B, C, as the columns stand on screen: the formula bar's addresses. */
	columnLetters: { type: Boolean, default: false },
	/**
	 * The host's own items in the menu a right click opens on a cell or a row's number, after the
	 * grid's. Choosing one emits `menu` with its key; one with `children` opens them beside it.
	 */
	menuItems: { type: Array as PropType<readonly GridMenuItem[]>, default: () => [] },
	/** The language of the grid's own words: issue messages and labels. */
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	/**
	 * What the user put on cells by hand, such as a `CellMarks` kept with the draft: fills, text
	 * colours, bold and italic, drawn over the schema's colour rules. Ctrl+B and Ctrl+I put bold and
	 * italic on the cells selected. Left out, nothing is marked.
	 */
	marks: { type: Object as PropType<CellMarks>, default: undefined },
	/** Cells found, such as a find's answer: each one tinted, and `current` outlined. */
	found: {
		type: Object as PropType<{ readonly cells: readonly FoundCell[]; readonly current?: FoundCell | null }>,
		default: undefined
	},
	/**
	 * Columns narrower together than the sheet share the room left between them, those the user has
	 * not sized by hand. Left out, the room on the right stays empty.
	 */
	fit: { type: Boolean, default: false },
	/**
	 * A row under the rows, held in place, with each number column's sum, or its average, smallest
	 * or largest, over the rows shown.
	 */
	totals: { type: Boolean, default: false },
	/** How large the sheet is drawn, 1 as it is: its text, rows and widths together. */
	zoom: { type: Number, default: 1 },
	/**
	 * How each column is drawn until the user says otherwise, by field key: a template's formats, such
	 * as its view's `columns.formats`. The user's own, in `columns`, go over them property by property,
	 * and taking theirs off brings these back. Left out, each column is drawn its field's way.
	 */
	defaultFormats: { type: Object as PropType<ColumnFormats>, default: undefined },
	/**
	 * A faint row after the last: a click there adds a row with the schema's defaults and selects its
	 * cell, to type or paste into. Not shown where the sheet cannot be typed into.
	 */
	newRow: { type: Boolean, default: false },
	/**
	 * A few words on each sheet the formulas read with SHEET, by its name, such as when the values
	 * read from it were saved: a cell worked out from that sheet says them in its tooltip.
	 */
	sheetNotes: { type: Object as PropType<Readonly<Record<string, string>>>, default: undefined },
	/**
	 * The workbook's sheets, for SHEET in a formula typed into a cell with "=", such as the
	 * `FormulaEngine`'s. Left out, SHEET there is `#REF!`.
	 */
	sheets: { type: Object as PropType<FormulaSheets>, default: undefined }
})

const emit = defineEmits<{
	/** One of the host's `menuItems` was chosen, by its key; the selection is what it is about. */
	menu: [key: string]
	/** Ctrl+H was pressed in the grid: the host opens its find and replace. */
	find: []
}>()

/** Widths the user set by dragging or fitting, by field key. Bind it with v-model to keep them. */
const columnWidths = defineModel<Readonly<Record<string, number>>>("columnWidths", { default: () => ({}) })

/**
 * Which columns are hidden, pinned or moved: the user's own arrangement. Bind it with v-model to
 * keep it; the header's menu changes it.
 */
const columns = defineModel<ColumnLayout>("columns", { default: () => ({}) })

/**
 * Each column's filter, by field key: the values it keeps, or a range of its numbers or dates. The
 * header's menu sets them; bind with v-model to keep them. Applied at a moment, as a spreadsheet's
 * are: a row changed afterwards stays until they are applied again.
 */
const filters = defineModel<ColumnFilters>("filters", { default: () => ({}) })

/** The rows in the order of one column, ascending or descending; null keeps the sheet's order. */
const sort = defineModel<ColumnSort | null>("sort", { default: null })

const HEADER_HEIGHT = 32
/** The room a column's letter takes before its label, past the letter's own width. */
const LETTER_GAP = 6
/** The link drawn in the header of a column a record fills, with its gap. */
const LINK_ROOM = 18
const OVERSCAN_ROWS = 6
const OVERSCAN_COLS = 2
/** Room kept free at a header's right edge for the handle that resizes the column. */
const RESIZE_HANDLE = 6
/** How many rows fitting a column to its contents looks at, spread over the sheet. */
const AUTOFIT_SAMPLE = 5000
/** Room past the last row and column, so the scroll bars drawn over the edges never cover a cell. */
const SCROLL_ROOM = 10
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
const arranged = computed(() => arrangeColumns(schema.value.fields, columns.value))
/** The columns shown, in order, the pinned ones first. A column's index on screen is its place here. */
const fields = computed<readonly FieldSchema[]>(() => arranged.value.fields)
/** How many of the first columns stay in place while the sheet scrolls sideways. */
const pinnedCount = computed(() => arranged.value.pinned)

const selection = new Selection(0, 0)
const dataVersion = shallowRef(0)
const selectionVersion = shallowRef(0)
const rowCount = shallowRef(0)

const id = useId()
const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const gutter = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const editor = ref<HTMLInputElement | null>(null)
const headerProbe = ref<HTMLElement | null>(null)
const suggestionList = ref<HTMLElement | null>(null)
const filterList = ref<HTMLElement | null>(null)
const cellProbe = ref<HTMLElement | null>(null)

// ---------------------------------------------------------------- columns

const sizings = computed<readonly ColumnSizing[]>(() =>
	fields.value.map(field => resolveColumnSizing(props.columnSizing, props.columnOverrides?.[field.key]))
)

/** Widths from the headers, measured once the fonts are in. Until then, every column is at its minimum. */
const autoWidths = shallowRef<readonly number[]>([])

/** The width of the column being dragged, kept apart until the drag ends so the model changes once. */
const liveWidth = shallowRef<{ key: string; width: number } | null>(null)

/** The room the body has across, past the row numbers: what `fit` fills. */
const bodyWidth = shallowRef(0)

/** Rows' height as drawn: the host's, by the zoom. */
const rowH = computed(() => Math.max(16, Math.round(props.rowHeight * props.zoom)))

const widths = computed<readonly number[]>(() => {
	const base = fields.value.map((field, index) => {
		const sizing = sizings.value[index] ?? resolveColumnSizing()

		if (liveWidth.value?.key === field.key) {
			return liveWidth.value.width
		}

		const manual = columnWidths.value[field.key]

		// A width the user chose is never replaced by a measured one. It is kept as at 100%, and drawn
		// by the zoom; a measured one is measured in the zoomed text already.
		// A column at its narrowest grows with the zoom too, so a larger text still fits it.
		return manual === undefined
			? Math.max(autoWidths.value[index] ?? sizing.minWidth, Math.round(sizing.minWidth * props.zoom))
			: Math.round(clampColumnWidth(manual, sizing) * props.zoom)
	})

	return props.fit ? fitted(base) : base
})

/**
 * The widths stretched to the body: the room left shared among the columns the user has not sized,
 * each by its width, the last taking what rounding leaves. Nothing changes when there is no room.
 */
function fitted(base: readonly number[]): readonly number[] {
	const room = bodyWidth.value - base.reduce((sum, width) => sum + width, 0) - SCROLL_ROOM
	const free = fields.value.flatMap((field, index) =>
		columnWidths.value[field.key] === undefined && liveWidth.value?.key !== field.key ? [index] : []
	)
	const share = free.reduce((sum, index) => sum + (base[index] ?? 0), 0)

	if (room <= 0 || share <= 0) {
		return base
	}

	const next = [...base]
	let left = room

	free.forEach((index, place) => {
		const extra = place === free.length - 1 ? left : Math.floor((room * (base[index] ?? 0)) / share)

		next[index] = (next[index] ?? 0) + extra
		left -= extra
	})

	return next
}

const offsets = computed<readonly number[]>(() => {
	const list = [0]

	for (const width of widths.value) {
		list.push((list[list.length - 1] ?? 0) + width)
	}

	return list
})

const totalWidth = computed(() => offsets.value[offsets.value.length - 1] ?? 0)
const pinnedWidth = computed(() => offsets.value[pinnedCount.value] ?? 0)
const totalHeight = computed(() => rowCount.value * rowH.value)
/** The row after the last that adds one, when there is one. */
const newRowHeight = computed(() => (props.newRow && !props.readonly && fields.value.length > 0 ? rowH.value : 0))
const gutterWidth = computed(() => Math.max(44, String(Math.max(rowCount.value, 1)).length * 8 + 20))

const cellStyles = computed(() =>
	widths.value.map((width, index) => `left:${offsets.value[index] ?? 0}px;width:${width}px`)
)

/** The letters share the header's row with the labels: no strip of their own. */
const headerHeight = computed(() => HEADER_HEIGHT)

/** How each column is drawn over its field's own way, by field key: the user's formats over the defaults. */
const formats = computed(() => mergeColumnFormats(props.defaultFormats, columns.value.formats))

const cellClasses = computed(() =>
	fields.value.map(field => {
		const align = formats.value[field.key]?.align ?? alignmentOf(field)
		const classes = align === "left" ? "" : `is-${align}`

		return isEditable(field) ? classes : `${classes} is-readonly`
	})
)

/** The lookup filling each field it fills, by the filled field's key. */
const filledBy = computed(() => {
	const lookups = new Map<string, FieldSchema>()

	for (const field of schema.value.fields) {
		for (const key of field.type === "lookup" ? field.fills : []) {
			lookups.set(key, field)
		}
	}

	return lookups
})

/** A cell its row's record filled: tinted, and its tooltip names the record. */
function filledClass(row: number, col: number): string | undefined {
	void dataVersion.value

	const field = fields.value[col]
	const rowId = view.value.rowIdAt(row)

	return field && rowId !== undefined && filledBy.value.has(field.key) && filledFrom(rowId, field.key) !== null
		? "is-filled"
		: undefined
}

/** The record a filled cell's value came from, by its label: what the cell's tooltip names. */
function filledFrom(rowId: string, key: string): string | null {
	const lookup = filledBy.value.get(key)
	const record = lookup ? store.value.get(rowId, lookup.key) : null

	return isLookupValue(record) ? record.label : null
}

function isEditable(field: FieldSchema | undefined): field is FieldSchema {
	return field !== undefined && field.editable && !props.readonly
}

/** The lookup that fills the column, by its label: the header's link says so. Null for any other column. */
function fillingLookup(col: number): string | null {
	const field = fields.value[col]

	return field ? (filledBy.value.get(field.key)?.label ?? null) : null
}

/** The sheets each formula field reads with SHEET, by the field's key; a field reading none is left out. */
const sheetsRead = computed(() => {
	const sheets = new Map<string, readonly string[]>()

	for (const field of schema.value.fields) {
		if (!field.formula) {
			continue
		}

		try {
			const names = formulaSheets(parseFormula(field.formula))

			if (names.length > 0) {
				sheets.set(field.key, names)
			}
		} catch {
			// A formula that does not parse reads nothing; its error is the engine's to show.
		}
	}

	return sheets
})

/** The sheets the column's formula reads, as their names are written in it. */
function sheetsOf(col: number): readonly string[] {
	const field = fields.value[col]

	return (field && sheetsRead.value.get(field.key)) || []
}

/**
 * The header's tooltip: the whole label, the formula of a column worked out from the others, the
 * sheets it reads, and the lookup that fills a column.
 */
function headerTitle(col: number): string | undefined {
	const field = fields.value[col]
	const lookup = fillingLookup(col)
	const sheets = sheetsOf(col)

	if (!field) {
		return undefined
	}

	return [
		field.label,
		field.formula ? `= ${field.formula}` : "",
		sheets.length > 0
			? (GRID_TEXT[props.locale].sheetColumn ?? "").replace(
					"{sheets}",
					sheets.map(name => `“${name}”`).join(", ")
				)
			: "",
		lookup ? (GRID_TEXT[props.locale].filledColumn ?? "").replace("{lookup}", lookup) : ""
	]
		.filter(Boolean)
		.join("\n")
}

/** What a header holds past its label's words: the letter before it, and a link or a sheet after it. */
function headerExtra(col: number, measure: (text: string) => number): number {
	return (
		(props.columnLetters ? measure(columnName(col)) + LETTER_GAP : 0) +
		(fillingLookup(col) === null ? 0 : LINK_ROOM) +
		(sheetsOf(col).length === 0 ? 0 : LINK_ROOM)
	)
}

/** The lines a cell worked out from other sheets adds to its tooltip: each sheet, and the host's note on it. */
function sheetLines(col: number): string[] {
	return sheetsOf(col).map(name => {
		const from = (GRID_TEXT[props.locale].fromSheet ?? "").replace("{sheet}", name)
		const note = props.sheetNotes?.[name]

		return note ? `${from} · ${note}` : from
	})
}

function headerText(col: number): string {
	const field = fields.value[col]
	const sizing = sizings.value[col]

	return field && sizing ? headerDisplayText(field.label, sizing.headerDisplayMaxLength) : ""
}

/** A pinned header sits in the pinned block, which starts past the row numbers; the rest in the head row. */
function headerStyle(col: number): string {
	const left = (col < pinnedCount.value ? 0 : gutterWidth.value) + (offsets.value[col] ?? 0)

	return `left:${left}px;width:${widths.value[col] ?? 0}px`
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
		const content =
			measure(headerText(index)) +
			padding +
			(field.required ? mark : 0) +
			headerExtra(index, measure) +
			RESIZE_HANDLE

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
		headerExtra(col, measureHeader) +
		RESIZE_HANDLE

	const rows = view.value
	const step = Math.max(1, Math.ceil(rows.size / AUTOFIT_SAMPLE))

	for (let row = 0; row < rows.size; row += step) {
		const rowId = rows.rowIdAt(row)
		const text =
			rowId === undefined ? "" : formatCell(field, store.value.get(rowId, field.key), props.valueSettings)

		if (text !== "") {
			content = Math.max(content, measureCell(text) + cellPadding)
		}
	}

	setWidth(field.key, autoColumnWidth(content, sizing))
}

/** Keeps a width as drawn now, as it would be at 100%: the zoom draws it again. */
function setWidth(key: string, width: number): void {
	const kept = Math.round(width / props.zoom)

	if (columnWidths.value[key] !== kept) {
		columnWidths.value = Object.freeze({ ...columnWidths.value, [key]: kept })
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
/** The columns on screen that scroll; the pinned ones are drawn apart, always. */
const visibleCols = computed(() => span(firstCol.value, lastCol.value))
const pinnedCols = computed(() => span(0, pinnedCount.value - 1))
/** How far the sheet is scrolled sideways, for what is drawn in place over it. */
const scrollX = shallowRef(0)

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
		height: Math.max(0, (element?.clientHeight ?? 0) - headerHeight.value)
	}
}

function updateWindow(): void {
	const element = scroller.value

	if (!element) {
		return
	}

	const { width, height } = bodySize()

	bodyWidth.value = width

	const rows = rowCount.value
	const cols = fields.value.length
	const top = element.scrollTop
	const left = element.scrollLeft
	const narrowest = Math.max(1, Math.min(...widths.value, Number.POSITIVE_INFINITY))

	rowPool.value = Math.ceil(height / rowH.value) + OVERSCAN_ROWS * 2 + 2
	colPool.value = Math.max(1, Math.min(cols, Math.ceil(width / narrowest) + OVERSCAN_COLS * 2 + 2))
	firstRow.value = Math.max(0, Math.floor(top / rowH.value) - OVERSCAN_ROWS)
	lastRow.value = Math.min(rows - 1, Math.floor((top + height) / rowH.value) + OVERSCAN_ROWS)
	const pinned = pinnedCount.value

	// The pinned columns cover the first pixels of the body on screen: the ones that scroll start after.
	scrollX.value = left
	firstCol.value = cols <= pinned ? pinned : Math.max(pinned, columnAt(left + pinnedWidth.value) - OVERSCAN_COLS)
	lastCol.value = cols <= pinned ? pinned - 1 : Math.min(cols - 1, columnAt(left + width) + OVERSCAN_COLS)

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
	const top = target.row * rowH.value
	const left = offsets.value[target.col] ?? 0
	const right = offsets.value[target.col + 1] ?? left

	if (top < element.scrollTop) {
		element.scrollTop = top
	} else if (top + rowH.value > element.scrollTop + height) {
		element.scrollTop = top + rowH.value - height
	}

	// A pinned column is always in view; one that scrolls must clear the pinned ones.
	if (target.col < pinnedCount.value) {
		return
	}

	const start = element.scrollLeft + pinnedWidth.value

	if (left < start) {
		element.scrollLeft = left - pinnedWidth.value
	} else if (right > element.scrollLeft + width) {
		element.scrollLeft = Math.min(left - pinnedWidth.value, right - width)
	}
}

// ---------------------------------------------------------------- cells

function text(row: number, col: number): string {
	// Read so the render depends on it: the store itself is not reactive.
	void dataVersion.value

	const rowId = view.value.rowIdAt(row)
	const field = fields.value[col]

	if (rowId === undefined || field === undefined) {
		return ""
	}

	const value = store.value.get(rowId, field.key)
	const shown = formatCell(field, value, props.valueSettings, { decimals: formats.value[field.key]?.decimals })

	// A rise carries its plus, as a change column writes it; only on screen, never copied.
	return hasSignTone(field) && signOf(value) > 0 ? `+${shown}` : shown
}

function hasSignTone(field: FieldSchema): boolean {
	return "tone" in field && field.tone === "sign"
}

/** A number's sign: 1, -1, or 0 for zero and for anything that is not a number. */
function signOf(value: CellValue): number {
	if (typeof value === "number") {
		return Math.sign(value)
	}

	if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) {
		return 0
	}

	return /^-?0+(\.0+)?$/.test(value) ? 0 : value.startsWith("-") ? -1 : 1
}

/** A rise or a fall, in a column whose schema colours numbers by their sign. */
function toneClass(row: number, col: number): string | undefined {
	const field = fields.value[col]

	if (field === undefined || !hasSignTone(field)) {
		return undefined
	}

	void dataVersion.value

	const rowId = view.value.rowIdAt(row)
	const sign = rowId === undefined ? 0 : signOf(store.value.get(rowId, field.key))

	return sign > 0 ? "is-positive" : sign < 0 ? "is-negative" : undefined
}

// ---------------------------------------------------------------- looks

const marksVersion = shallowRef(0)

watch(
	() => toRaw(props.marks),
	(marks, _previous, onCleanup) => {
		marksVersion.value++

		if (marks) {
			onCleanup(marks.subscribe(() => marksVersion.value++))
		}
	},
	{ immediate: true }
)

/** What the colour rules put on each row, worked out once a row is drawn and kept until the rows change. */
const ruleStyles = new Map<string, Map<string | null, CellStyle>>()
let ruleStylesAt = -1

watch([schema, () => props.valueSettings], () => ruleStyles.clear())

function stylesOf(rowId: string): Map<string | null, CellStyle> | null {
	const rules = schema.value.styles

	if (rules.length === 0) {
		return null
	}

	if (ruleStylesAt !== dataVersion.value) {
		ruleStyles.clear()
		ruleStylesAt = dataVersion.value
	}

	let styles = ruleStyles.get(rowId)

	if (!styles) {
		const sheet = schema.value

		styles = rowStyles(
			rules,
			key => sheet.field(key),
			key => store.value.get(rowId, key),
			props.valueSettings
		)
		ruleStyles.set(rowId, styles)
	}

	return styles
}

/** A cell's fill, text colour, bold and italic: the colour rules', then the user's own, which win. */
function lookClass(row: number, col: number): string | undefined {
	void dataVersion.value
	void marksVersion.value

	const rowId = view.value.rowIdAt(row)
	const field = fields.value[col]

	if (rowId === undefined || field === undefined) {
		return undefined
	}

	const styles = stylesOf(rowId)
	const ofRow = styles?.get(null)
	const ofCell = styles?.get(field.key)
	const mark = toRaw(props.marks)?.get(rowId, field.key) ?? null
	const fill = mark?.fill ?? ofCell?.fill ?? ofRow?.fill ?? null
	const color = mark?.color ?? ofCell?.color ?? ofRow?.color ?? null
	const classes: string[] = []

	if (fill) {
		classes.push(`is-fill-${fill}`)
	}

	if (color) {
		classes.push(`is-text-${color}`)
	}

	if (mark?.bold || ofCell?.bold || ofRow?.bold) {
		classes.push("is-bold")
	}

	if (mark?.italic) {
		classes.push("is-italic")
	}

	return classes.length > 0 ? classes.join(" ") : undefined
}

const foundKeys = computed(() => {
	const found = props.found

	return found ? new Set(found.cells.map(cell => JSON.stringify([cell.rowId, cell.field]))) : null
})

/** A cell a find found, and the one it is on. */
function foundClass(row: number, col: number): string | undefined {
	const keys = foundKeys.value

	if (!keys || keys.size === 0) {
		return undefined
	}

	const rowId = view.value.rowIdAt(row)
	const field = fields.value[col]

	if (rowId === undefined || field === undefined) {
		return undefined
	}

	const current = props.found?.current

	if (current && current.rowId === rowId && current.field === field.key) {
		return "is-found-current"
	}

	return keys.has(JSON.stringify([rowId, field.key])) ? "is-found" : undefined
}

/** The cells selected, by row id and field key, row by row. */
function selectedCells(): MarkedCell[] {
	const area = range.value

	if (!area) {
		return []
	}

	const cells: MarkedCell[] = []

	for (let row = area.top; row <= area.bottom; row++) {
		const rowId = view.value.rowIdAt(row)

		if (rowId === undefined) {
			continue
		}

		for (let col = area.left; col <= area.right; col++) {
			const field = fields.value[col]

			if (field) {
				cells.push({ rowId, field: field.key })
			}
		}
	}

	return cells
}

/**
 * What the cells selected have in common: bold and italic when every one is, a colour when every
 * one has it. For a toolbar to show its buttons pressed and its colours ticked, kept up as the
 * selection and the marks change. Null with no `marks`, or nothing selected.
 */
const selectionMarks = computed<SharedMarks | null>(() => {
	void marksVersion.value
	void viewVersion.value

	const marks = toRaw(props.marks)
	const cells = selectedCells()

	return marks && cells.length > 0 ? marks.shared(cells) : null
})

/** The keys of the columns the selection spans, as they stand on screen. */
function selectedFields(): string[] {
	const area = range.value

	return area ? fields.value.slice(area.left, area.right + 1).map(field => field.key) : []
}

/** Puts a mark on the cells selected. False when there is nothing selected or no `marks`. */
function markSelection(change: CellMarkChange): boolean {
	const marks = toRaw(props.marks)
	const cells = selectedCells()

	if (!marks || cells.length === 0) {
		return false
	}

	marks.mark(cells, change)

	return true
}

/** Bold or italic on the cells selected, or off when every one has it, as Ctrl+B and Ctrl+I. */
function toggleSelection(style: "bold" | "italic"): boolean {
	const marks = toRaw(props.marks)
	const cells = selectedCells()

	if (!marks || cells.length === 0) {
		return false
	}

	marks.toggle(cells, style)

	return true
}

/** Takes every mark off the cells selected. */
function clearSelectionMarks(): boolean {
	const marks = toRaw(props.marks)
	const cells = selectedCells()

	if (!marks || cells.length === 0) {
		return false
	}

	marks.clear(cells)

	return true
}

/** Whether a cell may be written: its column takes typing and its row is not locked by a result. */
function canEdit(rowId: string, key: string): boolean {
	return schema.value.has(key) && isEditable(schema.value.field(key)) && !isLockedRow(rowId)
}

// ---------------------------------------------------------------- totals

type TotalKind = "sum" | "average" | "min" | "max"

const TOTAL_KINDS: readonly TotalKind[] = ["sum", "average", "min", "max"]
const TOTAL_WORDS = { sum: "totalSum", average: "totalAverage", min: "totalMin", max: "totalMax" } as const

const totalKind = ref<TotalKind>("sum")
/** The list of what the totals row shows, open above its button, and the item the keys are on. */
const totalMenu = shallowRef<{ readonly left: number; readonly bottom: number; readonly width: number } | null>(null)
const totalHover = ref<TotalKind>("sum")
const totalButton = ref<HTMLButtonElement | null>(null)
let stopTotalMenu: (() => void) | null = null

/**
 * The pointer moving onto an item of the totals list takes the highlight. Only a real move: a
 * browser also says the pointer entered an item when the list opens under a pointer at rest, and
 * that would take the highlight from the keys that opened it.
 */
function hoverTotal(kind: TotalKind, event: MouseEvent): void {
	if (event.movementX !== 0 || event.movementY !== 0) {
		totalHover.value = kind
	}
}

function openTotalMenu(): void {
	const button = totalButton.value?.getBoundingClientRect()
	const frame = root.value?.getBoundingClientRect()

	if (!button || !frame) {
		return
	}

	totalHover.value = totalKind.value
	totalMenu.value = {
		left: button.left - frame.left,
		bottom: frame.bottom - button.top + 4,
		width: Math.max(button.width, 150)
	}

	const close = (down: MouseEvent): void => {
		const target = down.target instanceof Element ? down.target : null

		if (!target?.closest(".tabula-grid-totals-menu") && !target?.closest(".tabula-grid-totals-pick")) {
			closeTotalMenu()
		}
	}

	window.addEventListener("mousedown", close, true)
	stopTotalMenu = () => window.removeEventListener("mousedown", close, true)
}

function closeTotalMenu(): void {
	stopTotalMenu?.()
	stopTotalMenu = null
	totalMenu.value = null
}

function chooseTotal(kind: TotalKind): void {
	totalKind.value = kind
	closeTotalMenu()
	totalButton.value?.focus()
}

/** The keys on the totals button: arrows open the list and move in it, Enter takes, Escape leaves. */
function onTotalKeydown(event: KeyboardEvent): void {
	const at = TOTAL_KINDS.indexOf(totalHover.value)

	event.stopPropagation()

	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		if (!totalMenu.value) {
			openTotalMenu()
		} else {
			const step = event.key === "ArrowDown" ? 1 : -1

			totalHover.value = TOTAL_KINDS[(at + step + TOTAL_KINDS.length) % TOTAL_KINDS.length] ?? "sum"
		}
	} else if ((event.key === "Enter" || event.key === " ") && totalMenu.value) {
		chooseTotal(totalHover.value)
	} else if (event.key === "Escape" && totalMenu.value) {
		closeTotalMenu()
	} else {
		return
	}

	event.preventDefault()
}

onBeforeUnmount(closeTotalMenu)

/** Each column's total over the rows shown, as its cells write numbers; null for a column of no numbers. */
const columnTotals = computed<readonly (string | null)[] | null>(() => {
	if (!props.totals) {
		return null
	}

	void dataVersion.value
	void viewVersion.value

	const rows = view.value

	return fields.value.map(field => {
		if (!NUMERIC_TYPES.has(field.type)) {
			return null
		}

		const values = function* () {
			for (let row = 0; row < rows.size; row++) {
				const rowId = rows.rowIdAt(row)

				if (rowId !== undefined) {
					yield { field, value: store.value.get(rowId, field.key) }
				}
			}
		}
		const total = summarizeCells(values())[totalKind.value]

		return total === null
			? ""
			: formatCell(field, total, props.valueSettings, { decimals: formats.value[field.key]?.decimals })
	})
})

/** Where a total sits: under its column, the pinned ones held in place as the rest scroll. */
function totalStyle(col: number): string {
	const shift = col < pinnedCount.value ? 0 : scrollX.value

	return `left:${gutterWidth.value + (offsets.value[col] ?? 0) - shift}px;width:${widths.value[col] ?? 0}px`
}

/** A cell the user changed since the sheet was loaded, as the host's `changes` say. */
function changeClass(row: number, col: number): string | undefined {
	const changes = toRaw(props.changes)

	if (!changes) {
		return undefined
	}

	void changeVersion.value

	const rowId = view.value.rowIdAt(row)
	const field = fields.value[col]

	return rowId !== undefined && field !== undefined && changes.isChanged(rowId, field.key) ? "is-changed" : undefined
}

/** The issues on a cell, as the issue set has them now. */
function issuesAt(row: number, col: number): readonly Issue[] {
	void issueVersion.value

	const rowId = view.value.rowIdAt(row)
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
	const issues = issueLines(issuesAt(row, col))
	const field = fields.value[col]
	const rowId = view.value.rowIdAt(row)
	const source = field && rowId !== undefined ? filledFrom(rowId, field.key) : null

	// A cell whose formula could not be worked out has its issue to say why: no sheet it came from.
	const failed = field && rowId !== undefined && isFormulaError(store.value.get(rowId, field.key))

	// A cell its row's record filled says which record, and one read from other sheets says which,
	// under any issue.
	const lines = [
		issues,
		source
			? (GRID_TEXT[props.locale][isEditable(field) ? "filledFromEditable" : "filledFrom"] ?? "").replace(
					"{record}",
					source
				)
			: "",
		...(failed ? [] : sheetLines(col))
	].filter(Boolean)

	return lines.length > 0 ? lines.join("\n") : undefined
}

// ---------------------------------------------------------------- rows

/** Whether the backend's results lock the row: processed, or on its way to be. */
function isLockedRow(rowId: string): boolean {
	return results.value?.isLocked(rowId) ?? false
}

function rowLocked(row: number): boolean {
	void resultVersion.value

	const rowId = view.value.rowIdAt(row)

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

/**
 * The row number's classes: where the row stands with the backend, and the worst issue anywhere on
 * the row, which colours the number itself.
 */
function rowClass(row: number): string[] {
	void resultVersion.value

	const rowId = view.value.rowIdAt(row)

	if (rowId === undefined) {
		return []
	}

	const status = rowStatus(rowId)

	return [status ? `is-${status}` : "", rowMark(row) ?? ""].filter(Boolean)
}

/**
 * The worst issue standing anywhere on the row, its hidden columns too, in its number's colour: a
 * row with something to fix is found by its number as the sheet scrolls past.
 */
function rowMark(row: number): string | undefined {
	void issueVersion.value

	const rowId = view.value.rowIdAt(row)

	if (rowId === undefined || !issueSet.value.hasIssues(rowId)) {
		return undefined
	}

	const issues = [...issueSet.value.rowIssues(rowId)]

	for (const field of schema.value.fields) {
		issues.push(...issueSet.value.issuesAt(rowId, field.key))
	}

	return severityClass(issues)
}

/** The row number's tooltip: where the row stands, then the issues about the row as a whole. */
function rowTitle(row: number): string | undefined {
	void resultVersion.value
	void issueVersion.value

	const rowId = view.value.rowIdAt(row)

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
	const rowId = view.value.rowIdAt(row)
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

/** Where a range of cells is drawn; `shift` moves it sideways, as the input over a pinned cell is. */
function box(area: CellRange, shift = 0): Record<string, string> {
	const left = offsets.value[area.left] ?? 0

	return {
		transform: `translate(${left + shift}px, ${area.top * rowH.value}px)`,
		width: `${(offsets.value[area.right + 1] ?? left) - left}px`,
		height: `${(area.bottom - area.top + 1) * rowH.value}px`
	}
}

/** A range split where the pinned columns end: each part is drawn with its columns. */
function parts(area: CellRange | null) {
	const pinned = pinnedCount.value

	return {
		pinned: area && area.left < pinned ? box({ ...area, right: Math.min(area.right, pinned - 1) }) : null,
		free: area && area.right >= pinned ? box({ ...area, left: Math.max(area.left, pinned) }) : null
	}
}

const rangeParts = computed(() => parts(range.value))

/**
 * The fill handle, on the selection's bottom right corner with the columns that corner is drawn
 * with, kept inside the sheet at its last row and column. None while a cell is edited, or where
 * nothing can be changed.
 */
const fillHandle = computed(() => {
	const area = range.value

	if (!area || props.readonly || editing.value) {
		return null
	}

	const x = Math.min(offsets.value[area.right + 1] ?? 0, totalWidth.value - 4)
	const y = Math.min((area.bottom + 1) * rowH.value, totalHeight.value - 4)

	return { pinned: area.right < pinnedCount.value, style: { transform: `translate(${x}px, ${y}px)` } }
})

/** Where a fill would go while the handle is dragged: the selection and the cells it would fill. */
const fillParts = computed(() => {
	const dragging = fillDrag.value

	return dragging?.target ? parts(grown(dragging.source, dragging.target)) : null
})

const activePinned = computed(() => active.value !== null && active.value.col < pinnedCount.value)

const activeStyle = computed(() => {
	const cell = active.value

	return cell ? box({ top: cell.row, bottom: cell.row, left: cell.col, right: cell.col }) : {}
})

/**
 * Where the input sits. It is one element, so it never loses the keyboard on the way between the
 * pinned columns and the rest; over a pinned cell it is moved along as the sheet scrolls.
 */
const inputStyle = computed(() => {
	const cell = active.value

	return cell && activePinned.value
		? box({ top: cell.row, bottom: cell.row, left: cell.col, right: cell.col }, scrollX.value)
		: activeStyle.value
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

	return { ...inputStyle.value, width: `${Math.min(Math.max(cellWidth, wanted), Math.max(cellWidth, room))}px` }
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
	const rowId = cell ? view.value.rowIdAt(cell.row) : undefined

	if (!cell || !isEditable(field) || rowId === undefined || rowLocked(cell.row)) {
		return false
	}

	measureDraft = cellProbe.value ? textMeasurer(cellProbe.value) : null

	const current = store.value.get(rowId, field.key)

	// Several options: ticked in a list rather than typed. Typing replaces the cell, as anywhere,
	// so it starts with none ticked; F2, a double click or Alt+Down start with what is there.
	picked.value =
		field.type === "options" && field.multiple
			? new Set(mode === "enter" || !Array.isArray(current) ? [] : current.map(item => String(item)))
			: null
	editing.value = {
		row: cell.row,
		col: cell.col,
		original: editText(field, current, props.valueSettings),
		mode
	}
	entryDismissed.value = false
	entryHighlighted.value = 0
	reveal()

	return true
}

/** F2 or a double click: edit what is there, the caret at its end. */
function startEdit(): void {
	if (!beginEdit("edit")) {
		return
	}

	draft.value = picked.value ? "" : (editing.value?.original ?? "")

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

/**
 * Writes what was typed. `refocus` is false when focus is leaving the grid and should be let go.
 *
 * A formula, "=" first, writes its result for the row. One that gives none writes nothing and
 * returns false: with `refocus` the edit stays open, its reason under it, to be put right; leaving
 * the grid lets it go.
 */
function commitEdit(refocus = true): boolean {
	const state = editing.value

	if (!state) {
		return true
	}

	const text = draft.value
	const ticked = picked.value
	const rowId = view.value.rowIdAt(state.row)
	const field = fields.value[state.col]
	const outcome =
		rowId !== undefined && takesEntry(field) && isEntryFormula(text) && text !== state.original
			? entryOutcomeFor(rowId, field.key, text)
			: null

	if (outcome && !outcome.ok && refocus) {
		return false
	}

	editing.value = null
	draft.value = ""
	picked.value = null

	if (outcome) {
		if (outcome.ok && rowId !== undefined && field !== undefined) {
			store.value.setCell(rowId, field.key, outcome.value)
		}
	} else if (rowId !== undefined && field?.type === "options" && ticked && text.trim() === "") {
		// In the options' own order, whatever order they were ticked in.
		const values = field.options.filter(option => ticked.has(String(option.value))).map(option => option.value)
		const value = values.length === 0 ? null : Object.freeze(values)

		if (JSON.stringify(value) !== JSON.stringify(store.value.get(rowId, field.key))) {
			store.value.setCell(rowId, field.key, value)
		}
	} else if (rowId !== undefined && field !== undefined && text !== state.original) {
		store.value.setCell(rowId, field.key, valueOf(field, asTyped(text)))
	}

	if (refocus) {
		focusInput()
	}

	return outcome?.ok ?? true
}

/** Text as it is written: "'=" first keeps the rest as typed, as Excel's apostrophe does. */
function asTyped(text: string): string {
	return text.startsWith("'=") ? text.slice(1) : text
}

function cancelEdit(): void {
	editing.value = null
	draft.value = ""
	picked.value = null
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
	/** A lookup's record, whose values fill the fields the lookup fills when it is picked. */
	readonly record?: LookupItem
}

/**
 * A list entry's words cut where they hold what is typed, the part typed marked: how the user sees
 * why a record is listed, by its name or by its code.
 */
function marked(text: string): { readonly text: string; readonly hit: boolean }[] {
	const needle = lower(draft.value.trim())
	const at = needle === "" ? -1 : lower(text).indexOf(needle)

	// Lower-casing keeps the length of these texts in all but rare letters; where it does not, no mark.
	if (at < 0 || lower(text).length !== text.length) {
		return [{ text, hit: false }]
	}

	return [
		{ text: text.slice(0, at), hit: false },
		{ text: text.slice(at, at + needle.length), hit: true },
		{ text: text.slice(at + needle.length), hit: false }
	].filter(part => part.text !== "")
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

/**
 * The options ticked while a multi-select cell is edited, by value as text; null for any other edit.
 * The list stays open while they are ticked, and the edit writes them when it ends.
 */
const picked = shallowRef<ReadonlySet<string> | null>(null)

/** The field being edited, when it offers a list: a single-choice options field, or a lookup with a search. */
const listField = computed<FieldSchema | null>(() => {
	const field = editing.value ? fields.value[editing.value.col] : undefined

	if (field?.type === "options") {
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
	// Ticking several: the first entry is always the one Space or Enter ticks.
	highlighted.value = picked.value && list.length > 0 ? Math.max(0, preferred(list, query)) : preferred(list, query)
	listNote.value = note
	void nextTick(placeList)
}

/** Fills the list for what is typed: options at once, a lookup's records once typing pauses. */
function suggest(): void {
	const field = listField.value
	const query = draft.value

	stopSearch()

	// A formula has suggestions of its own; an options field's list waits.
	if (entryField.value) {
		closeList()

		return
	}

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
			value: Object.freeze({ id: item.id, label: item.label }),
			record: item
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

/**
 * Puts the entry in the cell being edited, and ends the edit. In a multi-select cell it ticks the
 * entry, or takes the tick away, and the edit goes on with the search cleared.
 */
function pick(index: number): boolean {
	const item = suggestions.value[index]
	const state = editing.value

	if (!item || item.disabled || !state) {
		return false
	}

	if (picked.value) {
		const next = new Set(picked.value)

		if (!next.delete(item.key)) {
			next.add(item.key)
		}

		picked.value = next

		if (draft.value !== "") {
			draft.value = ""
		} else {
			highlighted.value = index
		}

		return true
	}

	const rowId = view.value.rowIdAt(state.row)
	const field = fields.value[state.col]

	editing.value = null
	draft.value = ""
	closeList()

	if (rowId !== undefined && field) {
		// The record and what it fills, as one change: one Ctrl+Z takes back both.
		store.value.setCells([
			{ rowId, field: field.key, value: item.value },
			...(item.record ? lookupFills(field, rowId, item.record) : [])
		])
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

	if (picked.value) {
		return onPickKeydown(event)
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

/**
 * Keys while ticking options. Space ticks the highlighted option while nothing is typed; Enter ticks
 * the one a search found. Enter with nothing typed, Tab and leaving the cell write what is ticked;
 * Escape leaves the cell as it was.
 */
function onPickKeydown(event: KeyboardEvent): boolean {
	const searching = draft.value.trim() !== ""

	if (event.key === " " && !searching && highlighted.value >= 0) {
		return pick(highlighted.value)
	}

	if (event.key === "Enter" && searching && highlighted.value >= 0) {
		return pick(highlighted.value)
	}

	return false
}

/** Alt+Down on an options cell: an edit that starts with every option listed. */
function openList(): boolean {
	const cell = selection.active
	const field = cell ? fields.value[cell.col] : undefined

	if (field?.type !== "options" || !beginEdit("edit")) {
		return false
	}

	draft.value = ""
	void nextTick(() => editor.value?.focus({ preventScroll: true }))

	return true
}

// ---------------------------------------------------------------- a formula typed into a cell

/**
 * Whether a field takes a formula typed into it with "=", worked out once and written as a value:
 * any field the user can edit but a record, which is picked rather than worked out.
 */
function takesEntry(field: FieldSchema | undefined): field is FieldSchema {
	return isEditable(field) && field.type !== "lookup"
}

/** The columns as they stand on screen, with their letters: what a formula's addresses and suggestions name. */
const entryColumns = computed<EntryColumn[]>(() =>
	fields.value.map((field, col) => ({
		key: field.key,
		label: field.label,
		type: field.type,
		letter: columnName(col)
	}))
)

/** Numbers with a decimal comma: "1,1" is a number in a formula, and ";" separates, as in a Turkish Excel. */
const comma = computed(() => props.valueSettings.decimalSeparator === ",")
/** Where the caret stands in the editor: the suggestions and the call's help follow it. */
const entryCaret = ref(0)
const entryHighlighted = ref(0)
/** Escape closed the suggestions; they open again with what is typed next. */
const entryDismissed = ref(false)
const entryListId = `${id}-formula`
/** A touch screen: the formula's help sits over its keyboard, with buttons for what the keyboard hides. */
const coarsePointer = ref(false)

/** The field being edited, while a formula is typed into it. */
const entryField = computed(() => {
	const state = editing.value
	const field = state ? fields.value[state.col] : undefined

	return state && takesEntry(field) && isEntryFormula(draft.value) ? field : null
})

const entryAid = computed(() =>
	entryField.value ? entryHelp(draft.value, entryCaret.value, entryColumns.value, props.locale, comma.value) : null
)

const entryListOpen = computed(
	() => entryAid.value !== null && !entryDismissed.value && entryAid.value.items.length > 0
)

/** What a formula gives for a row's cell, the value to write or why there is none. */
function entryOutcomeFor(rowId: string, key: string, text: string): EntryResult {
	return entryResult(
		text,
		entryColumns.value,
		{
			schema: schema.value,
			field: key,
			read: field => store.value.get(rowId, field),
			settings: props.valueSettings,
			sheets: props.sheets ?? null
		},
		props.locale
	)
}

/** What the formula being typed gives for the cell's row, as it is typed; nothing for a lone "=". */
const entryOutcome = computed<EntryResult | null>(() => {
	void dataVersion.value

	const state = editing.value
	const field = entryField.value
	const rowId = state ? view.value.rowIdAt(state.row) : undefined

	return field && rowId !== undefined && draft.value.trim() !== "="
		? entryOutcomeFor(rowId, field.key, draft.value)
		: null
})

/** After the result: which cell Enter writes into, and how many Ctrl+Enter does. */
const entryNote = computed(() => {
	const state = editing.value
	const area = range.value

	if (!state) {
		return ""
	}

	const words = GRID_TEXT[props.locale]
	const one = (words.formulaWrites ?? "").replace("{address}", `${columnName(state.col)}${sheetRow(state.row)}`)
	const count = area ? (area.bottom - area.top + 1) * (area.right - area.left + 1) : 1

	return count > 1 ? `${one} · ${(words.formulaWritesMany ?? "").replace("{n}", String(count))}` : one
})

/** On a touch screen, buttons for the columns that hold numbers, the ones a formula reads most. */
const entryButtons = computed(() =>
	coarsePointer.value ? entryColumns.value.filter(column => NUMERIC_TYPES.has(column.type)).slice(0, 4) : []
)

/** Where the result and the help go: around the editor, or docked over a touch screen's keyboard. */
const entryPlace = shallowRef<{
	readonly left: number
	readonly top: number
	readonly bottom: number
	/** The help goes over the editor: there is more room there. */
	readonly above: boolean
	/** Docked: how far the keyboard leaves the bottom of the window. */
	readonly docked: number | null
} | null>(null)

function placeEntry(): void {
	const input = editor.value
	const frame = root.value

	if (!input || !frame || !entryField.value) {
		entryPlace.value = null

		return
	}

	const cell = input.getBoundingClientRect()
	const box = frame.getBoundingClientRect()
	const below = box.bottom - cell.bottom
	const viewport = typeof window === "undefined" ? null : window.visualViewport

	entryPlace.value = {
		left: cell.left - box.left,
		top: cell.top - box.top,
		bottom: cell.bottom - box.top,
		above: below < 240 && cell.top - box.top > below,
		docked:
			coarsePointer.value && viewport
				? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
				: null
	}
}

watch([entryField, draft, entryCaret], () => void nextTick(placeEntry))
watch(
	() => entryAid.value?.items,
	() => {
		entryHighlighted.value = 0
	}
)
watch(draft, () => {
	entryDismissed.value = false
})

/** Where the caret is, read after every key and click: the suggestions follow it. */
function followCaret(): void {
	entryCaret.value = editor.value?.selectionStart ?? draft.value.length
}

watch(draft, () => void nextTick(followCaret))

/** Puts text in place of `start`..`end` of what is typed, the caret after it. */
function replaceDraft(start: number, end: number, text: string): void {
	const at = start + text.length

	draft.value = `${draft.value.slice(0, start)}${text}${draft.value.slice(end)}`
	entryCaret.value = at

	void nextTick(() => {
		const input = editor.value

		input?.focus({ preventScroll: true })
		input?.setSelectionRange(at, at)
	})
}

/** A suggestion in place of what it completes. */
function insertEntry(index: number): void {
	const help = entryAid.value
	const item = help?.items[index]

	if (help && item) {
		replaceDraft(help.start, help.end, item.insert)
	}
}

/** A field or a sign at the caret, from a click on a column's cell or a button. */
function insertAtCaret(text: string): void {
	const caret = Math.min(entryCaret.value, draft.value.length)

	replaceDraft(caret, caret, text)
}

/** The keys the suggestions take while a formula is typed. False when the key is not theirs. */
function onEntryKeydown(event: KeyboardEvent): boolean {
	const help = entryAid.value

	if (!entryListOpen.value || !help) {
		return false
	}

	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		const count = help.items.length

		entryHighlighted.value = (entryHighlighted.value + (event.key === "ArrowDown" ? 1 : -1) + count) % count

		return true
	}

	if ((event.key === "Enter" && !(event.ctrlKey || event.metaKey)) || event.key === "Tab") {
		insertEntry(entryHighlighted.value)

		return true
	}

	if (event.key === "Escape") {
		entryDismissed.value = true

		return true
	}

	return false
}

/** A cell that Ctrl+Enter gave no value, and why. */
interface EntryFailure {
	readonly rowId: string
	readonly key: string
	readonly reason: string
}

/** What the last Ctrl+Enter wrote, and the cells it could not: shown until closed. */
const entryNotice = shallowRef<{ readonly written: number; readonly failed: readonly EntryFailure[] } | null>(null)
let entryNoticeTimer: ReturnType<typeof setTimeout> | null = null

const failedEntries = computed(
	() => new Set((entryNotice.value?.failed ?? []).map(item => `${item.rowId}|${item.key}`))
)

/** The notice in words: how many cells were written, and how many could not be, with the first one's reason. */
const entryNoticeLines = computed(() => {
	const notice = entryNotice.value
	const words = GRID_TEXT[props.locale]
	const first = notice?.failed[0]

	return {
		written:
			notice && notice.written > 0 ? (words.entryWritten ?? "").replace("{n}", String(notice.written)) : null,
		failed:
			notice && first
				? (words.entryFailed ?? "")
						.replace("{n}", String(notice.failed.length))
						.replace("{reason}", first.reason)
				: null
	}
})

/** A cell the last Ctrl+Enter could not work out: tinted until its notice is closed. */
function entryClass(row: number, col: number): string | undefined {
	if (failedEntries.value.size === 0) {
		return undefined
	}

	const rowId = view.value.rowIdAt(row)
	const field = fields.value[col]

	return rowId !== undefined && field && failedEntries.value.has(`${rowId}|${field.key}`)
		? "is-entry-failed"
		: undefined
}

function closeEntryNotice(): void {
	if (entryNoticeTimer !== null) {
		clearTimeout(entryNoticeTimer)
		entryNoticeTimer = null
	}

	entryNotice.value = null
}

function undoEntry(): void {
	closeEntryNotice()
	undoHistory.value.undo()
	focusInput()
}

/** Goes to the first cell Ctrl+Enter could not work out. */
function showEntryFailure(): void {
	const first = entryNotice.value?.failed[0]

	if (first) {
		go(first.rowId, first.key, false)
	}
}

/**
 * Text into every cell selected, as Excel's Ctrl+Enter puts it: a formula worked out for each cell's
 * row and field, anything else read as typed there. A cell the formula gives no value keeps its own
 * and is counted. One change: Ctrl+Z takes all of it back. Returns how many cells were written.
 */
function enterSelected(text: string): number {
	const area = selection.range

	if (!area || props.readonly) {
		return 0
	}

	const formula = isEntryFormula(text)
	const writes: CellWrite[] = []
	const failed: EntryFailure[] = []

	for (let row = area.top; row <= area.bottom; row++) {
		const rowId = view.value.rowIdAt(row)

		if (rowId === undefined || isLockedRow(rowId)) {
			continue
		}

		for (let col = area.left; col <= area.right; col++) {
			const field = fields.value[col]

			if (!isEditable(field)) {
				continue
			}

			if (!formula) {
				writes.push({ rowId, field: field.key, value: valueOf(field, asTyped(text)) })
				continue
			}

			const outcome = entryOutcomeFor(rowId, field.key, text)

			if (outcome.ok) {
				writes.push({ rowId, field: field.key, value: outcome.value })
			} else {
				failed.push({ rowId, key: field.key, reason: outcome.text })
			}
		}
	}

	if (writes.length > 0) {
		store.value.setCells(writes, { origin: "entry" })
	}

	closeEntryNotice()
	entryNotice.value = { written: writes.length, failed }

	// Nothing to look at: the notice goes by itself.
	if (failed.length === 0) {
		entryNoticeTimer = setTimeout(closeEntryNotice, 6000)
	}

	return writes.length
}

/** Ctrl+Enter in the editor: one cell as Enter writes it, several each by its own row. */
function enterEdit(): void {
	const state = editing.value
	const area = selection.range

	if (!state || !area || picked.value || (area.top === area.bottom && area.left === area.right)) {
		commitEdit()

		return
	}

	const text = draft.value

	editing.value = null
	draft.value = ""
	closeList()
	enterSelected(text)
	focusInput()
}

function onEditorKeydown(event: KeyboardEvent): void {
	const state = editing.value

	if (!state) {
		return
	}

	if (entryField.value && onEntryKeydown(event)) {
		event.preventDefault()

		return
	}

	if (listOpen.value && onListKeydown(event)) {
		event.preventDefault()

		return
	}

	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		enterEdit()
	} else if (event.key === "Enter") {
		if (commitEdit()) {
			move(event.shiftKey ? -1 : 1, 0)
		}
	} else if (event.key === "Tab") {
		if (commitEdit()) {
			move(0, event.shiftKey ? -1 : 1)
		}
	} else if (event.key === "Escape") {
		cancelEdit()
	} else if (state.mode === "enter" && !entryField.value && ARROWS[event.key] !== undefined) {
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
	const page = Math.max(1, Math.floor(bodySize().height / rowH.value) - 1)
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

	if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey && !mod)) {
		openContextMenu(null)

		return true
	}

	// Ctrl++ adds rows above rows selected whole, as Excel's does; with cells selected it first selects
	// their rows.
	if (mod && !altGr && (event.key === "+" || event.code === "NumpadAdd") && !props.readonly) {
		const area = selection.range

		if (area && area.left === 0 && area.right >= fields.value.length - 1) {
			insertRows("above")
		} else if (area) {
			selection.selectRows(area.top, area.bottom)
		}

		return true
	}

	// Ctrl+− takes out rows selected whole, as Excel's does; with cells selected it first selects
	// their rows, so a slip of the keys takes nothing out. Taken from the browser's zoom only here.
	if (mod && !altGr && (event.key === "-" || event.code === "NumpadSubtract") && !props.readonly) {
		const area = selection.range

		if (area && area.left === 0 && area.right >= fields.value.length - 1) {
			removeRows()
		} else if (area) {
			selection.selectRows(area.top, area.bottom)
		}

		return true
	}

	// Taken from the browser's bookmark and reload only where the grid can fill.
	const key = event.key.toLowerCase()

	// Bold and italic on what is selected, as a spreadsheet's; only where the host keeps marks.
	if (mod && !altGr && !event.shiftKey && (key === "b" || key === "i") && toRaw(props.marks)) {
		toggleSelection(key === "b" ? "bold" : "italic")

		return true
	}

	// Find and replace is the host's: the grid only says it was asked for.
	if (mod && !altGr && !event.shiftKey && key === "h") {
		emit("find")

		return true
	}

	if (mod && !altGr && !event.shiftKey && (key === "d" || key === "r") && !props.readonly) {
		fillFromEdge(key === "d" ? "down" : "right")

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
	const rows = view.value
	// What the user changed, not what their formulas worked out from it.
	const columns = new Map(
		fields.value.flatMap((field, index) => (field.formula === null ? [[field.key, index] as const] : []))
	)
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
	if (editing.value || props.readonly || (!selection.range && rowCount.value > 0)) {
		return
	}

	event.preventDefault()
	pasteText(event.clipboardData?.getData("text/plain") ?? "")
}

/** Pastes text a spreadsheet copied, as `onPaste` does: from the clipboard event, or the menu's Paste. */
function pasteText(copied: string): void {
	// A sheet with no rows yet takes the paste from its first cell.
	const area =
		selection.range ??
		(rowCount.value === 0 && fields.value.length > 0 ? { top: 0, left: 0, bottom: 0, right: 0 } : null)
	const block = parseTsv(copied)

	if (props.readonly || !area || block.length === 0) {
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
			// Rows a paste adds go at the end of the sheet, so they show after every row shown now,
			// filtered or not; the view takes them in once the paste is done.
			const shown = view.value.size
			const missing = area.top + height - shown
			// New rows hold the schema's defaults wherever the paste leaves them empty.
			const added = missing > 0 ? rows.appendRows(withDefaults(schema.value, missing)) : []
			const rowAt = (position: number): string | undefined =>
				position < shown ? view.value.rowIdAt(position) : added[position - shown]

			for (let offset = 0; offset < height; offset++) {
				const rowId = rowAt(area.top + offset)

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
				const rowId = view.value.rowIdAt(row)

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

// ---------------------------------------------------------------- fill

/** Kinds of field whose values mean the same in any column of the kind. */
const PLAIN_TYPES: ReadonlySet<FieldSchema["type"]> = new Set([
	"string",
	"integer",
	"decimal",
	"money",
	"quantity",
	"percent",
	"bool",
	"date",
	"datetime"
])

/**
 * How far a fill reaches past the selection: rows below it (above, when less than zero) and columns
 * right of it (left, when less than zero). Both at once fill a block, as a drag across the corner.
 */
interface FillTarget {
	readonly rows: number
	readonly cols: number
}

/** A fill handle being dragged: the cells it fills from, and where it would fill now. */
const fillDrag = shallowRef<{ readonly source: CellRange; readonly target: FillTarget | null } | null>(null)

/**
 * A value made in one column, as another column holds it: as it is in its own column or one of the
 * same plain kind; otherwise through its text, as copying and pasting would carry it.
 */
function carry(from: FieldSchema, to: FieldSchema, value: CellValue): CellValue {
	if (value === null || from.key === to.key || (from.type === to.type && PLAIN_TYPES.has(to.type))) {
		return value
	}

	return valueOf(to, formatCell(from, value, props.valueSettings))
}

function grown(area: CellRange, target: FillTarget): CellRange {
	return {
		top: area.top + Math.min(0, target.rows),
		bottom: area.bottom + Math.max(0, target.rows),
		left: area.left + Math.min(0, target.cols),
		right: area.right + Math.max(0, target.cols)
	}
}

/**
 * Where dragging the handle to a cell fills: as far as that cell, down or up, right or left, or
 * both, as a drag across the corner reaches a block. Nowhere while the pointer is inside the
 * selection.
 */
function fillTarget(source: CellRange, over: CellPosition): FillTarget | null {
	const rows = over.row > source.bottom ? over.row - source.bottom : Math.min(0, over.row - source.top)
	const cols = over.col > source.right ? over.col - source.right : Math.min(0, over.col - source.left)

	return rows === 0 && cols === 0 ? null : { rows, cols }
}

/**
 * Fills cells past `source` from the cells in it, as a spreadsheet's fill handle does: numbers,
 * dates and numbered names go on as a series, anything else repeats (`fillValues` in the core).
 *
 * Down or up, each column fills from its own cells. Right or left, each row fills from its cells
 * across. A block, down and across at once, fills down first and then across from every row it
 * reaches, so each cell is filled from the column beside it. As a paste, it writes only into the
 * rows shown, and passes over a column that cannot be edited and a locked row. One step to undo.
 */
function fillRange(source: CellRange, target: FillTarget, mode: FillMode): void {
	if (props.readonly || (target.rows === 0 && target.cols === 0)) {
		return
	}

	store.value.transact(
		() => {
			if (target.rows !== 0) {
				fillColumns(source, target.rows, mode)
			}

			if (target.cols !== 0) {
				fillRows(grown(source, { rows: target.rows, cols: 0 }), target.cols, mode)
			}
		},
		{ origin: "fill" }
	)
}

/** Each column of `source` filled from its own cells, `rows` past it: down, or up when below zero. */
function fillColumns(source: CellRange, rows: number, mode: FillMode): void {
	const sheet = store.value
	const shown = view.value
	const options = { backward: rows < 0, mode }
	const count = Math.abs(rows)

	for (let col = source.left; col <= source.right; col++) {
		const field = fields.value[col]

		if (!isEditable(field)) {
			continue
		}

		const from = span(source.top, source.bottom).map(row => {
			const rowId = shown.rowIdAt(row)

			return rowId === undefined ? null : sheet.get(rowId, field.key)
		})

		fillValues(field, from, count, options).forEach((value, index) => {
			const rowId = shown.rowIdAt(options.backward ? source.top - 1 - index : source.bottom + 1 + index)

			if (rowId !== undefined && !isLockedRow(rowId)) {
				sheet.setCell(rowId, field.key, value)
			}
		})
	}
}

/**
 * Each row of `source` filled across from its cells, `cols` past it: right, or left when below
 * zero. Columns of one plain kind can make a series; a value carried into a column of another kind
 * goes through its text, as a paste would read it.
 */
function fillRows(source: CellRange, cols: number, mode: FillMode): void {
	const sheet = store.value
	const shown = view.value
	const options = { backward: cols < 0, mode }
	const count = Math.abs(cols)
	const from = fields.value.slice(source.left, source.right + 1)
	const first = from[0]
	const series = first && PLAIN_TYPES.has(first.type) && from.every(field => field.type === first.type) ? first : null
	// Values that only repeat are picked by their place, so each is carried from its own column.
	const picks = fillValues(
		null,
		from.map((_, index) => index),
		count,
		options
	) as number[]

	for (let row = source.top; row <= source.bottom; row++) {
		const rowId = shown.rowIdAt(row)

		if (rowId === undefined || isLockedRow(rowId)) {
			continue
		}

		const values = from.map(field => sheet.get(rowId, field.key))
		const made = series ? fillValues(series, values, count, options) : null

		for (let index = 0; index < count; index++) {
			const to = fields.value[options.backward ? source.left - 1 - index : source.right + 1 + index]
			const pick = picks[index] ?? 0
			const origin = series ?? from[pick]

			if (isEditable(to) && origin) {
				sheet.setCell(rowId, to.key, carry(origin, to, made ? (made[index] ?? null) : (values[pick] ?? null)))
			}
		}
	}
}

function selectArea(area: CellRange): void {
	selection.moveTo(area.top, area.left)
	selection.moveTo(area.bottom, area.right, { extend: true })
	reveal()
}

/**
 * Dragging the handle on the selection's corner, down, up, across or both at once. Let go, it fills
 * to where it was dragged and selects all of it; Ctrl or Alt held when letting go turns a series into copies, or one number
 * into a count, as Ctrl and Option do in Excel.
 */
function onFillDown(event: MouseEvent): void {
	const source = selection.range

	if (event.button !== 0 || !source || props.readonly) {
		return
	}

	takeFocus(event)
	fillDrag.value = { source, target: null }
	drag(
		move => {
			const over = cellAt(move)

			if (over) {
				fillDrag.value = { source, target: fillTarget(source, over) }
			}
		},
		release => {
			const target = fillDrag.value?.target ?? null

			fillDrag.value = null

			if (release && target) {
				fillRange(source, target, release.ctrlKey || release.altKey ? "alternate" : "auto")
				selectArea(grown(source, target))
			}
		}
	)
}

/**
 * Double-clicking the handle fills down as far as the column beside the selection holds values,
 * the one on its left first, as in Excel: a new price typed at the top of a list goes down the list.
 */
function onFillDouble(): void {
	const source = selection.range

	if (!source || props.readonly) {
		return
	}

	const beside = [source.left - 1, source.right + 1].find(
		col => col >= 0 && col < fields.value.length && !isBlank(source.bottom + 1, col)
	)

	if (beside === undefined) {
		return
	}

	let last = source.bottom + 1

	while (last + 1 < rowCount.value && !isBlank(last + 1, beside)) {
		last++
	}

	const target: FillTarget = { rows: last - source.bottom, cols: 0 }

	fillRange(source, target, "auto")
	selectArea(grown(source, target))
}

/**
 * Ctrl+D and Ctrl+R, as in Excel: the selection's first row copied down the rest of it, or its first
 * column across. A selection one row high takes the row above it; one column wide, the column left.
 */
function fillFromEdge(direction: "down" | "right"): void {
	const area = selection.range

	if (!area) {
		return
	}

	if (direction === "down") {
		const top = area.bottom > area.top ? area.top : area.top - 1

		if (top >= 0) {
			fillRange({ ...area, top, bottom: top }, { rows: area.bottom - top, cols: 0 }, "copy")
		}

		return
	}

	const left = area.right > area.left ? area.left : area.left - 1

	if (left >= 0) {
		fillRange({ ...area, left, right: left }, { rows: 0, cols: area.right - left }, "copy")
	}
}

// ---------------------------------------------------------------- mouse

let stopDrag: (() => void) | null = null

/**
 * Follows the mouse until the button is let go, wherever it goes. `onEnd` is given the release, or
 * null when the drag was cut short: by another starting, or by the grid going away.
 */
function drag(onMove: (event: MouseEvent) => void, onEnd?: (release: MouseEvent | null) => void): void {
	stopDrag?.()

	const end = (event?: MouseEvent): void => {
		window.removeEventListener("mousemove", onMove)
		window.removeEventListener("mouseup", end)
		stopDrag = null
		onEnd?.(event instanceof MouseEvent ? event : null)
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
		row: clamp(Math.floor((event.clientY - rect.top) / rowH.value), 0, rowCount.value - 1),
		col: columnAtClient(event.clientX)
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

	// Writing a formula where a value is expected: a cell's column goes into it, as Excel's pointing.
	if (entryField.value && entryPoints(draft.value, entryCaret.value, comma.value)) {
		const cell = cellAt(event)
		const column = cell ? entryColumns.value[cell.col] : undefined

		if (column) {
			event.preventDefault()
			insertAtCaret(`[${column.label}]`)

			return
		}
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

/** The column under a point on screen: a pinned one where they are drawn, otherwise one that scrolls. */
function columnAtClient(clientX: number): number {
	const element = scroller.value
	// From where the columns start on screen, just past the row numbers.
	const x = clientX - (element?.getBoundingClientRect().left ?? 0) - gutterWidth.value

	if (pinnedCount.value > 0 && x < pinnedWidth.value) {
		return columnAt(Math.max(0, x))
	}

	return columnAt(clamp(x + (element?.scrollLeft ?? 0), 0, Math.max(0, totalWidth.value - 1)))
}

function rowAtClient(clientY: number): number {
	const rect = gutter.value?.getBoundingClientRect()

	return clamp(Math.floor((clientY - (rect?.top ?? 0)) / rowH.value), 0, Math.max(0, rowCount.value - 1))
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
	rowCount.value = view.value.size
	selection.resize(rowCount.value, fields.value.length)
	updateWindow()
}

const stopSelection = selection.subscribe(() => {
	selectionVersion.value++
})

// The rows on screen: the host's view when given, otherwise one of the grid's own over the store.
// Made before the grid follows the store, so the view has taken in a change when the grid hears of it.
let ownView: RowView | null = null
const view = shallowRef<RowView>(toRaw(props.view) ?? (ownView = new RowView(store.value)))
const viewVersion = shallowRef(0)

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

				if (view.value.size !== rowCount.value) {
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

watch(
	() => [toRaw(props.view), store.value] as const,
	([given, nextStore], previous, onCleanup) => {
		if (given) {
			ownView?.dispose()
			ownView = null
			view.value = given
		} else if (!ownView || previous !== undefined) {
			ownView?.dispose()
			ownView = new RowView(nextStore)
			view.value = ownView
		}

		viewVersion.value++
		syncSize()
		onCleanup(
			view.value.subscribe(() => {
				viewVersion.value++
				dataVersion.value++
				syncSize()
			})
		)
	},
	{ immediate: true }
)

/** Whether a filter leaves rows out, for the row numbers to say so. */
/** Whether the rows shown are not every row in the sheet's order: filtered, sorted, or both. */
const filtered = computed(() => {
	void viewVersion.value

	return view.value.arranged
})

/** A row's number in the sheet: its place among all the rows, which a filter does not change. */
function sheetRow(row: number): number {
	void viewVersion.value

	const rowId = filtered.value ? view.value.rowIdAt(row) : undefined

	return rowId === undefined ? row + 1 : store.value.indexOf(rowId) + 1
}

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

// What the user changed, when the host follows it.
const changeVersion = shallowRef(0)

watch(
	() => toRaw(props.changes),
	(given, _previous, onCleanup) => {
		changeVersion.value++

		if (given) {
			onCleanup(given.subscribe(() => changeVersion.value++))
		}
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
watch(
	() => props.zoom,
	() => void nextTick(() => measureHeaders())
)

// Columns hidden, shown, pinned or moved: positions on screen mean other columns now.
watch(arranged, () => {
	editing.value = null
	closeColumnMenu()
	closeContextMenu()
	syncSize()
})

// ---------------------------------------------------------------- column menu

/** The menu of the column whose header button was pressed, placed under the button. */
const columnMenu = shallowRef<{ readonly col: number; readonly left: number; readonly top: number } | null>(null)
let stopMenu: (() => void) | null = null

/** Columns the user hid that the schema still has. */
const hiddenCount = computed(() => (columns.value.hidden ?? []).filter(key => schema.value.has(key)).length)

function openColumnMenu(event: MouseEvent, col: number): void {
	const frame = root.value
	const button = event.currentTarget as HTMLElement | null

	if (!frame || !button) {
		return
	}

	const at = button.getBoundingClientRect()

	showColumnMenu(col, at.left, at.bottom)
}

/** The column's menu at a point on screen: under its button, or where a right click fell. */
function showColumnMenu(col: number, x: number, y: number): void {
	const frame = root.value

	if (!frame) {
		return
	}

	commitEdit(false)
	closeColumnMenu()
	closeContextMenu()

	const box = frame.getBoundingClientRect()

	columnMenu.value = { col, left: x - box.left, top: y - box.top }

	// A press anywhere else closes it.
	const close = (down: MouseEvent): void => {
		const menu = frame.querySelector(".tabula-grid-menu")

		if (!(down.target instanceof Node && menu?.contains(down.target))) {
			closeColumnMenu()
		}
	}

	window.addEventListener("mousedown", close, true)
	stopMenu = () => window.removeEventListener("mousedown", close, true)
	void nextTick(() => frame.querySelector<HTMLElement>(".tabula-grid-menu button")?.focus())
}

function closeColumnMenu(refocus = false): void {
	stopMenu?.()
	stopMenu = null
	columnMenu.value = null

	if (refocus) {
		focusInput()
	}
}

type ColumnAction =
	"pin" | "unpin" | "hide" | "showHidden" | "sortAsc" | "sortDesc" | "sortClear" | "filter" | "filterClear"

function columnAction(action: ColumnAction): void {
	const menu = columnMenu.value
	const field = menu ? fields.value[menu.col] : undefined

	if (action === "filter" && menu) {
		closeColumnMenu()
		openFilterPanel(menu.col, menu.left, menu.top)

		return
	}

	closeColumnMenu(true)

	if (action === "sortAsc" || action === "sortDesc") {
		if (field) {
			sort.value = Object.freeze({ key: field.key, direction: action === "sortAsc" ? "asc" : "desc" })
		}
	} else if (action === "sortClear") {
		sort.value = null
	} else if (action === "filterClear") {
		if (field) {
			setFilter(field.key, null)
		}
	} else if (action === "showHidden") {
		columns.value = Object.freeze({ ...columns.value, hidden: [] })
	} else if (field) {
		columns.value = withColumn(
			columns.value,
			field.key,
			action === "hide" ? { hidden: true } : { pinned: action === "pin" }
		)
	}
}

/** Up and down move between the menu's items; Escape closes it and gives the grid the keyboard back. */
function onMenuKeydown(event: KeyboardEvent): void {
	const items = [
		...(root.value?.querySelectorAll<HTMLButtonElement>(".tabula-grid-menu button:not(:disabled)") ?? [])
	]
	const at = items.indexOf(document.activeElement as HTMLButtonElement)

	if (event.key === "Escape") {
		closeColumnMenu(true)
	} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		const by = event.key === "ArrowDown" ? 1 : -1

		items[(at + by + items.length) % items.length]?.focus()
	} else {
		return
	}

	event.preventDefault()
}

// ---------------------------------------------------------------- sorting and filtering

/** The view's name for the grid's column filters, beside any filter the host sets. */
const COLUMN_FILTERS = "columns"

// The filters and the sort are applied when they change, at that moment, as a spreadsheet's are.
watch(
	[filters, sort, view, () => props.locale],
	([given, order, rows]) => {
		const standing = Object.keys(given).some(key => schema.value.has(key))

		if (standing) {
			rows.filter(rowsMatching(store.value, schema.value, given), COLUMN_FILTERS)
		} else {
			rows.clear(COLUMN_FILTERS)
		}

		rows.sort(
			order && schema.value.has(order.key) ? rowOrder(store.value, schema.value, order, props.locale) : null
		)
	},
	{ immediate: true }
)

function sortOf(col: number): "asc" | "desc" | null {
	const field = fields.value[col]

	return field && sort.value?.key === field.key ? sort.value.direction : null
}

function isFiltered(col: number): boolean {
	const field = fields.value[col]

	return field !== undefined && filters.value[field.key] !== undefined
}

function ariaSort(col: number): "ascending" | "descending" | undefined {
	const order = sortOf(col)

	return order === "asc" ? "ascending" : order === "desc" ? "descending" : undefined
}

/** The filter being set for one column: its list of values, as the column holds them among the rows the other filters keep. */
interface FilterPanel {
	readonly col: number
	readonly field: FieldSchema
	readonly left: number
	readonly top: number
	readonly values: readonly DistinctValue[]
	readonly more: number
	readonly range: boolean
}

const filterPanel = shallowRef<FilterPanel | null>(null)
const filterSearch = ref("")
const filterChecked = shallowRef<ReadonlySet<string>>(new Set())
const filterFrom = ref("")
const filterTo = ref("")
const filterProblem = ref<string | null>(null)
let stopFilterPanel: (() => void) | null = null

/** A value as the list shows it: as the sheet writes it, an empty cell by name. */
function valueLabel(entry: DistinctValue): string {
	const field = filterPanel.value?.field

	if (entry.key === "" || !field) {
		return GRID_TEXT[props.locale].empty ?? ""
	}

	// A multi-select column lists its options one by one: each written as a cell holding it alone.
	const one = field.type === "options" && field.multiple && !Array.isArray(entry.value) ? [entry.value] : entry.value

	return formatCell(field, one as CellValue, props.valueSettings)
}

/** The values the search leaves in the list. */
const shownValues = computed(() => {
	const panel = filterPanel.value
	const needle = lower(filterSearch.value)

	return !panel
		? []
		: needle === ""
			? panel.values
			: panel.values.filter(entry => lower(valueLabel(entry)).includes(needle))
})

const allShownChecked = computed(() => shownValues.value.every(entry => filterChecked.value.has(entry.key)))
const someShownChecked = computed(() => shownValues.value.some(entry => filterChecked.value.has(entry.key)))

/** The text a bound of a range opens with: the value as an editor shows it. */
function boundText(field: FieldSchema, value: string | null): string {
	return value === null ? "" : editText(field, value, props.valueSettings)
}

function openFilterPanel(col: number, left: number, top: number): void {
	const field = fields.value[col]

	if (!field) {
		return
	}

	// The list holds what the other columns' filters leave, as a spreadsheet's does.
	const others = { ...filters.value }

	delete others[field.key]

	const keep = rowsMatching(store.value, schema.value, others)
	const rows = store.value.rowIds().filter(rowId => keep(rowId))
	const { values, more } = distinctValues(store.value, field, rows, { locale: props.locale })
	const current = filters.value[field.key]

	filterPanel.value = { col, field, left, top, values, more, range: hasRange(field) }
	filterSearch.value = ""
	filterProblem.value = null
	filterChecked.value = new Set(current?.kind === "values" ? current.keys : values.map(entry => entry.key))
	filterFrom.value = current?.kind === "range" ? boundText(field, current.from) : ""
	filterTo.value = current?.kind === "range" ? boundText(field, current.to) : ""

	const frame = root.value
	const close = (down: MouseEvent): void => {
		const panel = frame?.querySelector(".tabula-grid-filter")

		if (!(down.target instanceof Node && panel?.contains(down.target))) {
			closeFilterPanel()
		}
	}

	window.addEventListener("mousedown", close, true)
	stopFilterPanel = () => window.removeEventListener("mousedown", close, true)
	void nextTick(() => frame?.querySelector<HTMLElement>(".tabula-grid-filter input")?.focus())
}

function closeFilterPanel(refocus = false): void {
	stopFilterPanel?.()
	stopFilterPanel = null
	filterPanel.value = null

	if (refocus) {
		focusInput()
	}
}

function toggleValue(key: string): void {
	const next = new Set(filterChecked.value)

	if (next.has(key)) {
		next.delete(key)
	} else {
		next.add(key)
	}

	filterChecked.value = next
}

function toggleShown(): void {
	const next = new Set(filterChecked.value)
	const on = !allShownChecked.value

	for (const entry of shownValues.value) {
		if (on) {
			next.add(entry.key)
		} else {
			next.delete(entry.key)
		}
	}

	filterChecked.value = next
}

/** A bound typed as the sheet writes it, read into the field's own form; undefined when it cannot be read. */
function readBound(field: FieldSchema, text: string): string | null | undefined {
	if (text.trim() === "") {
		return null
	}

	const { value, problem } = readInput(field, text, props.valueSettings)

	return problem === null && typeof value === "string" ? value : undefined
}

function setFilter(key: string, condition: ColumnFilters[string] | null): void {
	const next = { ...filters.value }

	if (condition) {
		next[key] = condition
	} else {
		delete next[key]
	}

	filters.value = Object.freeze(next)
}

/**
 * Sets the column's filter from the panel: a range when one is typed, otherwise the values ticked.
 * While a search narrows the list, only the ticked values it shows count, as in a spreadsheet.
 * Every value ticked is no filter at all.
 */
function applyFilter(): void {
	const panel = filterPanel.value

	if (!panel) {
		return
	}

	const key = panel.field.key

	if (panel.range && (filterFrom.value.trim() !== "" || filterTo.value.trim() !== "")) {
		const from = readBound(panel.field, filterFrom.value)
		const to = readBound(panel.field, filterTo.value)

		if (from === undefined || to === undefined) {
			filterProblem.value = GRID_TEXT[props.locale].badBound ?? null

			return
		}

		setFilter(key, { kind: "range", from, to })
	} else {
		const searching = filterSearch.value.trim() !== ""
		const pool = searching ? shownValues.value : panel.values
		const keys = pool.filter(entry => filterChecked.value.has(entry.key)).map(entry => entry.key)

		setFilter(
			key,
			!searching && keys.length === panel.values.length && panel.more === 0 ? null : { kind: "values", keys }
		)
	}

	closeFilterPanel(true)
}

function clearFilter(): void {
	const panel = filterPanel.value

	if (panel) {
		setFilter(panel.field.key, null)
	}

	closeFilterPanel(true)
}

function onFilterKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		event.preventDefault()
		closeFilterPanel(true)
	} else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
		const type = (event.target as HTMLInputElement).type

		if (type !== "checkbox") {
			event.preventDefault()
			applyFilter()
		}
	}
}

watch(offsets, () => updateWindow())
watch(
	() => rowH.value,
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

	coarsePointer.value = window.matchMedia?.("(pointer: coarse)").matches ?? false
	window.visualViewport?.addEventListener("resize", placeEntry)
})

onBeforeUnmount(() => {
	window.visualViewport?.removeEventListener("resize", placeEntry)
	closeEntryNotice()
	stopSearch()
	closeColumnMenu()
	closeFilterPanel()
	ownValidator?.dispose()
	ownHistory?.dispose()
	ownView?.dispose()
	resizeObserver?.disconnect()
	stopDrag?.()
	stopSelection()
})

/**
 * Goes to a row, and to one of its fields when given: selects the cell, scrolls it into view and
 * gives the grid the keyboard. An issue's rowId and field are what it takes. A row a filter left
 * out is shown, in its place. False when the row is no longer there.
 */
function goTo(rowId: string, field?: string | null): boolean {
	return go(rowId, field ?? null, true)
}

/** `mayShow`: a column the user hid is shown first, once; the cell is gone to when it is. */
function go(rowId: string, field: string | null, mayShow: boolean, focus = true): boolean {
	if (!view.value.show(rowId)) {
		return false
	}

	const row = view.value.indexOf(rowId)

	if (row < 0) {
		return false
	}

	commitEdit(false)

	const col = field ? fields.value.findIndex(candidate => candidate.key === field) : -1

	if (field && col < 0 && mayShow && columns.value.hidden?.includes(field)) {
		columns.value = withColumn(columns.value, field, { hidden: false })
		// The layout comes back through v-model on the next render.
		void nextTick(() => go(rowId, field, false, focus))

		return true
	}

	selection.moveTo(row, col < 0 ? (selection.active?.col ?? 0) : col)
	reveal()

	if (focus) {
		focusInput()
	}

	return true
}

// ---------------------------------------------------------------- what a formula bar and a status bar read

const NUMERIC_TYPES: ReadonlySet<FieldSchema["type"]> = new Set(["integer", "decimal", "money", "quantity", "percent"])

/** The active cell with its address and the text an editor would open with. */
const cell = computed<ActiveCell | null>(() => {
	void dataVersion.value
	void resultVersion.value

	const at = active.value
	const field = at ? fields.value[at.col] : undefined
	const rowId = at ? view.value.rowIdAt(at.row) : undefined

	if (!at || field === undefined || rowId === undefined) {
		return null
	}

	const formula = field.formula ? Object.freeze(formulaParts(field.formula, schema.value.fields)) : null

	return Object.freeze({
		rowId,
		field,
		address: `${columnName(at.col)}${sheetRow(at.row)}`,
		text: editText(field, store.value.get(rowId, field.key), props.valueSettings),
		editable: isEditable(field) && !isLockedRow(rowId),
		filledFrom: filledFrom(rowId, field.key),
		formula,
		// A field read in another sheet is not one of this row's columns.
		references: formula
			? [...new Set(formula.flatMap(part => (part.field && part.sheet === undefined ? [part.field] : [])))]
			: []
	})
})

/** How many colours the fields a formula reads take in turn. */
const REFERENCE_COLOURS = 6

/**
 * A formula typed into the formula bar, while it is: the grid colours the columns it reads, as it
 * does for one typed into a cell.
 */
const barEntry = ref<string | null>(null)

/**
 * Each field a formula reads, with the colour of its place: one being typed into a cell or the
 * formula bar, or else the active cell's column's own.
 */
const references = computed(() => {
	const typed = entryField.value ? draft.value : barEntry.value
	const keys =
		typed !== null && isEntryFormula(typed)
			? entryReferences(typed, entryColumns.value)
			: (cell.value?.references ?? [])

	return new Map(keys.map((key, index) => [key, index % REFERENCE_COLOURS]))
})

/** A column the active cell's formula reads, in its colour; stronger on the active row. */
function refClass(row: number | null, col: number): string | undefined {
	const field = fields.value[col]
	const index = field ? references.value.get(field.key) : undefined

	if (index === undefined) {
		return undefined
	}

	return `is-ref tabula-ref-${index}${row !== null && active.value?.row === row ? " is-ref-here" : ""}`
}

/**
 * The cells selected, summed as a spreadsheet's status bar sums them. Worked out only when read,
 * and again when the selection or the data changes.
 */
const selected = computed<SelectedCells | null>(() => {
	void dataVersion.value

	const area = range.value

	if (!area) {
		return null
	}

	const rows = view.value
	const columns = fields.value.slice(area.left, area.right + 1)
	const from = `${columnName(area.left)}${sheetRow(area.top)}`
	const to = `${columnName(area.right)}${sheetRow(area.bottom)}`
	const values = function* () {
		for (let row = area.top; row <= area.bottom; row++) {
			const rowId = rows.rowIdAt(row)

			if (rowId !== undefined) {
				for (const field of columns) {
					yield { field, value: store.value.get(rowId, field.key) }
				}
			}
		}
	}

	return Object.freeze({
		...summarizeCells(values()),
		address: from === to ? from : `${from}:${to}`,
		rows: area.bottom - area.top + 1,
		columns: columns.length,
		field: columns.find(field => NUMERIC_TYPES.has(field.type)) ?? null
	})
})

/**
 * Goes to a cell by its address, such as "D9" typed into a formula bar. False when there is no such
 * column on screen or no such row.
 */
function goToAddress(address: string): boolean {
	const place = parseAddress(address)
	const field = place ? fields.value[place.col] : undefined
	const rowId = place ? store.value.rowIdAt(place.row - 1) : undefined

	return field !== undefined && rowId !== undefined && go(rowId, field.key, false)
}

/**
 * Writes text into a cell, read as typing it there reads it, such as from a formula bar. A bar
 * names the cell it started on: a click elsewhere moves the selection before the bar lets go.
 * False when the cell cannot be changed; the same text as is there writes nothing.
 */
function writeCell(rowId: string, key: string, input: string): boolean {
	const field = schema.value.has(key) ? schema.value.field(key) : undefined

	if (!isEditable(field) || !store.value.has(rowId) || isLockedRow(rowId)) {
		return false
	}

	if (editing.value) {
		commitEdit(false)
	}

	// A formula writes its result; one that gives none writes nothing.
	if (takesEntry(field) && isEntryFormula(input)) {
		const outcome = entryOutcomeFor(rowId, key, input)

		if (outcome.ok) {
			store.value.setCell(rowId, key, outcome.value)
		}

		return outcome.ok
	}

	if (input !== editText(field, store.value.get(rowId, key), props.valueSettings)) {
		store.value.setCell(rowId, key, valueOf(field, asTyped(input)))
	}

	return true
}

/**
 * For a formula bar: the help and the result of a formula typed there, for the active cell, as the
 * cell's own editor gives them. Null when the active cell takes no formula.
 */
function entryFor(
	text: string,
	caret: number
): { readonly help: ReturnType<typeof entryHelp>; readonly result: EntryResult | null; readonly note: string } | null {
	const at = selection.active
	const field = at ? fields.value[at.col] : undefined
	const rowId = at ? view.value.rowIdAt(at.row) : undefined

	if (!at || rowId === undefined || !takesEntry(field) || isLockedRow(rowId) || !isEntryFormula(text)) {
		return null
	}

	const area = range.value
	const count = area ? (area.bottom - area.top + 1) * (area.right - area.left + 1) : 1
	const words = GRID_TEXT[props.locale]
	const one = (words.formulaWrites ?? "").replace("{address}", `${columnName(at.col)}${sheetRow(at.row)}`)

	return {
		help: entryHelp(text, caret, entryColumns.value, props.locale, comma.value),
		result: text.trim() === "=" ? null : entryOutcomeFor(rowId, field.key, text),
		note: count > 1 ? `${one} · ${(words.formulaWritesMany ?? "").replace("{n}", String(count))}` : one
	}
}

/** A formula bar's text, while a formula is typed there: the columns it reads are coloured. Null ends it. */
function showEntry(text: string | null): void {
	barEntry.value = text
}

/**
 * Changes every number selected by `adjustment`, as one step to undo: a percentage, an amount, or
 * rounding to a step. Cells that cannot be edited, rows a run locked and cells holding no number are
 * passed over. Returns how many cells changed.
 *
 * @throws TabulaError `invalid_argument` for an amount or a step that `adjustValue` refuses
 */
function adjustSelection(adjustment: Adjustment): number {
	const area = selection.range

	if (!area || props.readonly) {
		return 0
	}

	commitEdit(false)

	const sheetRows = store.value
	let changed = 0

	sheetRows.transact(
		() => {
			for (let row = area.top; row <= area.bottom; row++) {
				const rowId = view.value.rowIdAt(row)

				if (rowId === undefined || isLockedRow(rowId)) {
					continue
				}

				for (let col = area.left; col <= area.right; col++) {
					const field = fields.value[col]

					if (!isEditable(field) || field.formula) {
						continue
					}

					const next = adjustValue(field, sheetRows.get(rowId, field.key), adjustment, props.valueSettings)

					if (next !== null) {
						sheetRows.setCell(rowId, field.key, next)
						changed++
					}
				}
			}
		},
		{ origin: "adjust" }
	)

	return changed
}

/**
 * Takes the rows the selection spans out of the sheet, as one step to undo. A row on its way to the
 * backend stays; one it processed may go, as `removeSucceeded()` takes them. Returns how many went.
 */
function removeRows(): number {
	const area = selection.range

	if (!area || props.readonly) {
		return 0
	}

	commitEdit(false)

	const going: string[] = []

	for (let row = area.top; row <= area.bottom; row++) {
		const rowId = view.value.rowIdAt(row)
		const inFlight =
			rowId !== undefined && isLockedRow(rowId) && results.value?.resultOf(rowId)?.outcome !== "succeeded"

		if (rowId !== undefined && !inFlight) {
			going.push(rowId)
		}
	}

	if (going.length > 0) {
		store.value.transact(() => store.value.removeRows(going), { origin: "remove" })
		selection.moveTo(area.top, selection.active?.col ?? 0)
	}

	return going.length
}

/**
 * The row after the last was pressed: a row is added at the end, with the schema's defaults, as one
 * step to undo, and the cell pressed in it is selected, or its first that can be typed into. Typing
 * then writes into it, and a paste goes from it, adding the rows it needs.
 */
function onNewRowDown(event: MouseEvent): void {
	if (event.button !== 0 || props.readonly) {
		return
	}

	takeFocus(event)

	const pressed = columnAtClient(event.clientX)
	const col = isEditable(fields.value[pressed]) ? pressed : fields.value.findIndex(field => isEditable(field))
	const rowsOf = store.value
	let added: string[] = []

	rowsOf.transact(
		() => {
			added = rowsOf.appendRows(withDefaults(schema.value, 1))
		},
		{ origin: "insert" }
	)

	const row = view.value.indexOf(added[0] ?? "")

	if (row >= 0) {
		selection.moveTo(row, Math.max(0, col))
		reveal()
	}
}

/**
 * Adds as many empty rows as the selection spans, above it or below it, as one step to undo; they
 * hold the schema's defaults, and are selected. Returns their ids.
 */
function insertRows(where: "above" | "below"): string[] {
	const area = selection.range

	if (!area || props.readonly) {
		return []
	}

	commitEdit(false)

	const rowsOf = store.value
	const anchor = view.value.rowIdAt(where === "above" ? area.top : area.bottom)
	const index = anchor === undefined ? rowsOf.size : rowsOf.indexOf(anchor) + (where === "below" ? 1 : 0)
	let added: string[] = []

	rowsOf.transact(
		() => {
			added = rowsOf.insertRows(index, withDefaults(schema.value, area.bottom - area.top + 1))
		},
		{ origin: "insert" }
	)

	const first = view.value.indexOf(added[0] ?? "")
	const last = view.value.indexOf(added[added.length - 1] ?? "")

	if (first >= 0) {
		selection.selectRows(first, Math.max(first, last))
		reveal()
	}

	return added
}

// ---------------------------------------------------------------- the context menu

/** The menu a right click or the menu key opened: over a cell or a row's number, where, and what the cell says. */
const contextMenu = shallowRef<{
	readonly kind: "cell" | "row"
	readonly left: number
	readonly top: number
	readonly issues: readonly string[]
} | null>(null)
/** The host's item whose children are open beside it. */
const submenu = ref<string | null>(null)
/** The browser refused to read the clipboard for the menu's Paste: the menu says to use the keys. */
const pasteRefused = ref(false)
let stopContext: (() => void) | null = null

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/** "Ctrl+X", or "⌘X" on a Mac. */
function keys(key: string): string {
	return MAC ? `⌘${key}` : `Ctrl+${key}`
}

interface MenuEntry extends GridMenuItem {
	/** Beside a group's name, such as how many rows its items act on. */
	readonly badge?: string
}

/** How far a cell's value is written in an item's name before it is cut short. */
const MENU_VALUE_LENGTH = 24

/** How many rows the selection spans: what the row items act on. */
function selectedRowCount(): number {
	const area = selection.range

	return area ? area.bottom - area.top + 1 : 1
}

/** The row items, in words that say how many rows they act on. */
function rowEntries(): MenuEntry[] {
	const words = GRID_TEXT[props.locale]
	const fixed = props.readonly
	const count = selectedRowCount()
	const counted = (one: string, many: string): string =>
		count > 1 ? (words[many] ?? "").replace("{n}", count.toLocaleString(numberLocale())) : (words[one] ?? "")

	return [
		{
			key: "tabula:insertAbove",
			label: counted("insertAbove", "insertAboveCount"),
			shortcut: keys("+"),
			disabled: fixed
		},
		{ key: "tabula:insertBelow", label: counted("insertBelow", "insertBelowCount"), disabled: fixed },
		{ key: "tabula:rowsLine", label: "", kind: "line" },
		{
			key: "tabula:removeRows",
			label: counted("removeRows", "removeRowsCount"),
			shortcut: keys("−"),
			disabled: fixed,
			danger: true
		}
	]
}

function numberLocale(): string {
	return props.locale === "tr" ? "tr-TR" : "en-US"
}

/** "“TRY” olanları göster": the active cell's value, as its cell shows it, cut short when long. */
function filterValueLabel(): string {
	const words = GRID_TEXT[props.locale]
	const at = selection.active
	const field = at ? fields.value[at.col] : undefined
	const rowId = at ? view.value.rowIdAt(at.row) : undefined
	const text =
		field && rowId !== undefined ? formatCell(field, store.value.get(rowId, field.key), props.valueSettings) : ""
	const shown = text === "" ? (words.empty ?? "") : text
	const short = shown.length > MENU_VALUE_LENGTH ? `${shown.slice(0, MENU_VALUE_LENGTH - 1)}…` : shown

	return (words.filterValue ?? "").replace("{value}", short)
}

/**
 * The menu's items in order, a null between groups. On a cell: the clipboard and clearing at once,
 * then the groups (Doldur, Satırlar, the host's items, Süz ve sırala), each opened beside it. On a
 * row's number, the row items are what the menu is about, so they stay in the open.
 */
const contextEntries = computed<readonly (MenuEntry | null)[]>(() => {
	const menu = contextMenu.value
	const words = GRID_TEXT[props.locale]
	const fixed = props.readonly

	if (!menu) {
		return []
	}

	void selectionVersion.value

	const entries: (MenuEntry | null)[] = [
		{ key: "tabula:cut", label: words.cut ?? "", shortcut: keys("X"), disabled: fixed },
		{ key: "tabula:copy", label: words.copy ?? "", shortcut: keys("C") },
		{
			key: "tabula:paste",
			label: words.paste ?? "",
			shortcut: keys("V"),
			disabled: fixed || typeof navigator === "undefined" || !navigator.clipboard?.readText
		}
	]

	if (menu.kind === "row") {
		entries.push(
			null,
			...rowEntries().map(entry => (entry.kind === "line" ? null : entry)),
			...(props.menuItems.length > 0 ? [null, ...props.menuItems] : [])
		)

		return entries
	}

	const count = selectedRowCount()
	const col = selection.active?.col ?? -1

	entries.push(
		{ key: "tabula:clear", label: words.clearCells ?? "", shortcut: "Delete", disabled: fixed },
		null,
		{
			key: "tabula:fill",
			label: words.fill ?? "",
			disabled: fixed,
			children: [
				{ key: "tabula:fillDown", label: words.fillDown ?? "", shortcut: keys("D") },
				{ key: "tabula:fillRight", label: words.fillRight ?? "", shortcut: keys("R") }
			]
		},
		{
			key: "tabula:rows",
			label: words.rows ?? "",
			...(count > 1 ? { badge: count.toLocaleString(numberLocale()) } : {}),
			children: rowEntries()
		},
		...props.menuItems,
		{
			key: "tabula:filterSort",
			label: words.filterAndSort ?? "",
			children: [
				{ key: "tabula:filterValue", label: filterValueLabel() },
				{
					key: "tabula:filterClear",
					label: words.filterColumnClear ?? "",
					disabled: col < 0 || !isFiltered(col)
				},
				{ key: "tabula:filterLine", label: "", kind: "line" },
				{ key: "tabula:sortAsc", label: words.sortAsc ?? "" },
				{ key: "tabula:sortDesc", label: words.sortDesc ?? "" }
			]
		}
	)

	return entries
})

/** Where the open group's items stand: beside it on the right, or on the left and higher when the window has no room. */
const submenuPlace = ref<{ readonly left: boolean; readonly shift: number }>({ left: false, shift: 0 })

watch(submenu, open => {
	submenuPlace.value = { left: false, shift: 0 }

	if (open === null) {
		return
	}

	void nextTick(() => {
		const box = root.value?.querySelector(".tabula-grid-submenu")?.getBoundingClientRect()

		if (box) {
			submenuPlace.value = {
				left: box.right > window.innerWidth - 8,
				shift: Math.min(0, window.innerHeight - 8 - box.bottom)
			}
		}
	})
})

/**
 * A right click: on a header, its column's menu; on a cell or a row's number, the context menu, the
 * cell or row selected first when the click falls outside the selection, as in Excel. While a cell
 * is being edited the browser's own menu stays, for the text in it. The menu key opens the menu at
 * the active cell.
 */
function onContextMenu(event: MouseEvent): void {
	const target = event.target instanceof Element ? event.target : null

	if (editing.value || target?.closest(".tabula-grid-filter")) {
		return
	}

	event.preventDefault()

	if (target?.closest(".tabula-grid-menu")) {
		return
	}

	// From the keyboard the event comes to the grid's input, at no point on screen.
	if (target === editor.value || (event.clientX === 0 && event.clientY === 0)) {
		openContextMenu(null)

		return
	}

	const header = target?.closest<HTMLElement>(".tabula-grid-th")

	if (header) {
		const col = Number(header.getAttribute("aria-colindex")) - 1

		if (col >= 0) {
			showColumnMenu(col, event.clientX, event.clientY)
		}

		return
	}

	takeFocus(event)

	if (target?.closest(".tabula-grid-rh")) {
		const row = rowAtClient(event.clientY)
		const area = selection.range
		const whole = area && area.left === 0 && area.right >= fields.value.length - 1

		if (!(whole && row >= area.top && row <= area.bottom)) {
			selection.selectRows(row)
		}

		openContextMenu({ kind: "row", x: event.clientX, y: event.clientY })

		return
	}

	const at = cellAt(event)

	if (at && !inRange(at.row, at.col)) {
		selection.moveTo(at.row, at.col)
	}

	openContextMenu({ kind: "cell", x: event.clientX, y: event.clientY })
}

/** Opens the menu at a point on screen; with none, under the active cell, as the menu key does. */
function openContextMenu(at: { readonly kind: "cell" | "row"; readonly x: number; readonly y: number } | null): void {
	const frame = root.value
	const position = selection.active

	if (!frame || !position) {
		return
	}

	commitEdit(false)
	closeColumnMenu()
	closeContextMenu()

	let point = at

	if (!point) {
		const box = frame.querySelector(".tabula-grid-active")?.getBoundingClientRect()

		point = { kind: "cell", x: box?.left ?? 0, y: box?.bottom ?? 0 }
	}

	const issues = point.kind === "cell" ? issuesAt(position.row, position.col) : []

	contextMenu.value = {
		kind: point.kind,
		left: point.x,
		top: point.y,
		issues: issues.map(issue => issueText(issue, props.locale, props.valueSettings))
	}

	const close = (down: MouseEvent): void => {
		const menu = frame.querySelector(".tabula-grid-context")

		if (!(down.target instanceof Node && menu?.contains(down.target))) {
			closeContextMenu()
		}
	}

	window.addEventListener("mousedown", close, true)
	stopContext = () => window.removeEventListener("mousedown", close, true)

	// Kept on screen: moved left or up when it would run past the window's edge.
	void nextTick(() => {
		const menu = frame.querySelector<HTMLElement>(".tabula-grid-context")
		const placed = contextMenu.value

		if (!menu || !placed) {
			return
		}

		const width = menu.offsetWidth
		const height = menu.offsetHeight
		const left = Math.max(8, Math.min(placed.left, window.innerWidth - width - 8))
		const top = Math.max(8, Math.min(placed.top, window.innerHeight - height - 8))

		if (left !== placed.left || top !== placed.top) {
			contextMenu.value = { ...placed, left, top }
		}

		menu.querySelector<HTMLElement>("button:not(:disabled)")?.focus()
	})
}

function closeContextMenu(refocus = false): void {
	stopContext?.()
	stopContext = null
	contextMenu.value = null
	submenu.value = null
	pasteRefused.value = false

	if (refocus) {
		focusInput()
	}
}

/**
 * Runs an item: the grid's own does its work, the host's is emitted. A group opens its items, and
 * from the keyboard (Enter or Space) goes into them.
 */
function chooseMenu(entry: MenuEntry, event?: MouseEvent): void {
	if (entry.disabled || (entry.kind !== undefined && entry.kind !== "item")) {
		return
	}

	if (entry.children && entry.children.length > 0) {
		submenu.value = submenu.value === entry.key ? null : entry.key

		if (submenu.value !== null && event?.detail === 0) {
			void nextTick(() =>
				root.value?.querySelector<HTMLElement>(".tabula-grid-submenu button:not(:disabled)")?.focus()
			)
		}

		return
	}

	if (entry.key === "tabula:paste") {
		void pasteFromMenu()

		return
	}

	closeContextMenu(true)

	const area = selection.range
	const position = selection.active
	const field = position ? fields.value[position.col] : undefined
	const rowId = position ? view.value.rowIdAt(position.row) : undefined

	switch (entry.key) {
		case "tabula:copy":
		case "tabula:cut":
			if (area) {
				void navigator.clipboard?.writeText(rangeText(area)).catch(() => undefined)

				if (entry.key === "tabula:cut") {
					clearRange("cut")
				}
			}

			break
		case "tabula:clear":
			clearRange("clear")
			break
		case "tabula:fillDown":
			fillFromEdge("down")
			break
		case "tabula:fillRight":
			fillFromEdge("right")
			break
		case "tabula:insertAbove":
			insertRows("above")
			break
		case "tabula:insertBelow":
			insertRows("below")
			break
		case "tabula:removeRows":
			removeRows()
			break
		case "tabula:filterValue":
			if (field && rowId !== undefined) {
				setFilter(field.key, { kind: "values", keys: filterKeys(field, store.value.get(rowId, field.key)) })
			}

			break
		case "tabula:filterClear":
			if (field) {
				setFilter(field.key, null)
			}

			break
		case "tabula:sortAsc":
		case "tabula:sortDesc":
			if (field) {
				sort.value = Object.freeze({
					key: field.key,
					direction: entry.key === "tabula:sortAsc" ? "asc" : "desc"
				})
			}

			break
		default:
			emit("menu", entry.key)
	}
}

/**
 * The menu's Paste reads the clipboard through the browser, which may ask the user first. Refused,
 * the menu stays open and says to paste with the keys, which need no leave.
 */
async function pasteFromMenu(): Promise<void> {
	try {
		const copied = await navigator.clipboard.readText()

		closeContextMenu(true)
		pasteText(copied)
	} catch {
		pasteRefused.value = true
	}
}

/**
 * Up and down move between the items, Right opens an item's children and Left goes back from them;
 * Escape closes what is open, Tab the whole menu.
 */
function onContextKeydown(event: KeyboardEvent): void {
	const menu = root.value?.querySelector(".tabula-grid-context")
	const focused = document.activeElement as HTMLElement | null
	const inSubmenu = Boolean(focused?.closest(".tabula-grid-submenu"))
	const scope = inSubmenu ? focused?.closest(".tabula-grid-submenu") : menu
	const items = [
		...(scope?.querySelectorAll<HTMLButtonElement>(
			inSubmenu
				? "button:not(:disabled)"
				: ":scope > button:not(:disabled), :scope > .tabula-grid-menu-item > button:not(:disabled)"
		) ?? [])
	]
	const at = items.indexOf(focused as HTMLButtonElement)

	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
	} else if (event.key === "ArrowRight" && !inSubmenu && focused?.dataset.key) {
		const entry = contextEntries.value.find(item => item?.key === focused.dataset.key)

		if (entry?.children?.length) {
			submenu.value = entry.key
			void nextTick(() => menu?.querySelector<HTMLElement>(".tabula-grid-submenu button:not(:disabled)")?.focus())
		}
	} else if ((event.key === "ArrowLeft" || event.key === "Escape") && inSubmenu) {
		const parent = submenu.value

		submenu.value = null
		void nextTick(() => menu?.querySelector<HTMLElement>(`button[data-key="${parent}"]`)?.focus())
	} else if (event.key === "Escape" || event.key === "Tab") {
		closeContextMenu(true)
	} else {
		return
	}

	event.preventDefault()
}

/** Where the user is: the active cell by its row's id and field, and how far the sheet is scrolled. */
function position(): GridPosition {
	const at = selection.active
	const element = scroller.value

	return Object.freeze({
		rowId: at ? (view.value.rowIdAt(at.row) ?? null) : null,
		field: at ? (fields.value[at.col]?.key ?? null) : null,
		top: element?.scrollTop ?? 0,
		left: element?.scrollLeft ?? 0
	})
}

/**
 * Puts the user back where `position()` said, such as in a grid made again over the same rows: the
 * scroll as it was, and the active cell when its row and column are still shown.
 */
function restorePosition(at: GridPosition): void {
	const row = at.rowId === null ? -1 : view.value.indexOf(at.rowId)
	const col = at.field === null ? -1 : fields.value.findIndex(field => field.key === at.field)

	if (row >= 0 && col >= 0) {
		selection.moveTo(row, col)
	}

	const element = scroller.value

	if (element) {
		element.scrollTop = at.top
		element.scrollLeft = at.left
		updateWindow()
	}
}

/**
 * A cell's address as the formula bar writes it, "D8": its column as the columns stand on screen,
 * its row's number in the sheet. Null for a column not shown or a row not in the sheet.
 */
function addressOf(rowId: string, field: string): string | null {
	const col = fields.value.findIndex(candidate => candidate.key === field)
	const index = store.value.indexOf(rowId)

	return col < 0 || index < 0 ? null : `${columnName(col)}${index + 1}`
}

/** How many rows are shown, and how many the sheet has. */
const rows = computed(() => {
	void dataVersion.value
	void viewVersion.value

	return Object.freeze({ shown: view.value.size, total: store.value.size })
})

/** The issues counted, as the issue panel counts them. */
const issueSummary = computed(() => {
	void issueVersion.value

	return issueSet.value.summary()
})

/** A value written as the grid writes it, in its settings. */
function formatValue(field: FieldSchema, value: CellValue): string {
	return formatCell(field, value, props.valueSettings)
}

defineExpose({
	/** The selection, in on-screen positions. */
	selection,
	/** The active cell: its address, field and text. Null before anything is selected. */
	cell,
	/** The cells selected, with the sum and average of their numbers. Null before anything is selected. */
	selected,
	/** How many rows are shown, and how many the sheet has. */
	rows,
	/** The issues counted: errors, warnings, those waiting to be checked again, and rows. */
	issueSummary,
	formatValue,
	goTo,
	goToAddress,
	writeCell,
	/**
	 * Text into every cell selected, as Ctrl+Enter writes it: a formula, "=" first, worked out for
	 * each cell's row. Returns how many cells were written.
	 */
	enterSelected,
	/** The help and the result of a formula typed into a formula bar, for the active cell. */
	entryFor,
	/** A formula bar's formula while it is typed, to colour the columns it reads; null ends it. */
	showEntry,
	adjustSelection,
	removeRows,
	insertRows,
	addressOf,
	position,
	restorePosition,
	focus: focusInput,
	/** Fits a column to its header and contents, as a double click on its edge does. */
	autoFit,
	/** The cells selected, by row id and field key: what a toolbar's marks go on. */
	selectedCells,
	/** The keys of the columns the selection spans: what a toolbar's column formats go on. */
	selectedFields,
	/**
	 * What the cells selected have in common in `marks`: bold, italic, a fill, a text colour. A
	 * toolbar shows its bold button pressed by it, and ticks the colours. Null with nothing selected.
	 */
	selectionMarks,
	/** Puts a fill, a text colour, bold or italic on the cells selected, into `marks`. */
	markSelection,
	/** Bold or italic on the cells selected, or off when every one has it. */
	toggleSelection,
	/** Takes every mark off the cells selected. */
	clearSelectionMarks,
	/** Whether a cell may be written: what a find and replace leaves alone. */
	canEdit,
	/** Selects a cell and scrolls it into view, leaving the keyboard where it is: a find's Next. */
	showCell: (rowId: string, field?: string | null): boolean => go(rowId, field ?? null, true, false),
	/** The keys of the columns shown, in the order they stand. */
	shownFields: (): string[] => fields.value.map(field => field.key),
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
		class="tabula-grid tabula-theme"
		role="grid"
		:tabindex="active ? -1 : 0"
		:data-tabula-theme="theme"
		:class="{
			'is-filtered': filtered,
			'is-scrolled-x': scrollX > 0,
			'is-filling': fillDrag,
			'has-letters': columnLetters
		}"
		:style="{ '--tabula-row-height': `${rowH}px`, '--tabula-zoom': zoom }"
		:aria-rowcount="rowCount + 1"
		:aria-colcount="fields.length"
		:aria-readonly="readonly || undefined"
		aria-multiselectable="true"
		:aria-activedescendant="activeId"
		@focus="onRootFocus"
		@copy="onCopy"
		@cut="onCut"
		@paste="onPaste"
		@contextmenu="onContextMenu"
	>
		<div ref="scroller" class="tabula-grid-scroller tabula-scroll" @scroll.passive="updateWindow">
			<div
				class="tabula-grid-sheet"
				:style="{
					width: `${gutterWidth + totalWidth + SCROLL_ROOM}px`,
					height: `${headerHeight + totalHeight + newRowHeight + SCROLL_ROOM}px`
				}"
			>
				<div
					class="tabula-grid-head"
					role="row"
					aria-rowindex="1"
					:style="{ width: `${gutterWidth + totalWidth}px`, height: `${headerHeight}px` }"
				>
					<div class="tabula-grid-corner" :style="{ width: `${gutterWidth}px` }" @mousedown="onCornerDown" />
					<div
						v-if="pinnedCount > 0"
						class="tabula-grid-head-pinned"
						:style="{ left: `${gutterWidth}px`, width: `${pinnedWidth}px` }"
					>
						<div
							v-for="c in pinnedCols"
							:key="c"
							class="tabula-grid-th is-pinned"
							role="columnheader"
							:aria-colindex="c + 1"
							:aria-sort="ariaSort(c)"
							:class="[
								{
									'is-right': cellClasses[c]?.includes('is-right'),
									'is-center': cellClasses[c]?.includes('is-center'),
									'is-selected': colSelected(c)
								},
								refClass(null, c)
							]"
							:style="headerStyle(c)"
							:title="headerTitle(c)"
							@mousedown="onHeaderDown($event, c)"
						>
							<span
								v-if="columnLetters"
								class="tabula-grid-th-letter"
								aria-hidden="true"
								v-text="columnName(c)"
							/>
							<span v-if="fields[c]?.formula" class="tabula-grid-fx" aria-hidden="true">ƒx</span>
							<span class="tabula-grid-th-text">{{ headerText(c) }}</span>
							<span v-if="fields[c]?.required" class="tabula-grid-required" aria-hidden="true">*</span>
							<svg
								v-if="fillingLookup(c) !== null"
								class="tabula-grid-th-link"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
								<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
							</svg>
							<svg
								v-if="sheetsOf(c).length > 0"
								class="tabula-grid-th-link tabula-grid-th-sheet"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<rect x="4" y="4" width="16" height="16" rx="2" />
								<path d="M4 10h16M10 10v10" />
							</svg>
							<span v-if="sortOf(c)" class="tabula-grid-sort" aria-hidden="true">
								{{ sortOf(c) === "asc" ? "↑" : "↓" }}
							</span>
							<svg
								v-if="isFiltered(c)"
								class="tabula-grid-filtered"
								viewBox="0 0 24 24"
								role="img"
								:aria-label="GRID_TEXT[locale].filtered"
							>
								<path d="M3 5h18l-7 8v6l-4 2v-8Z" />
							</svg>
							<button
								type="button"
								class="tabula-grid-th-menu"
								tabindex="-1"
								:aria-label="GRID_TEXT[locale].columnMenu"
								@mousedown.stop.prevent="openColumnMenu($event, c)"
							>
								⋯
							</button>
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
						v-for="c in visibleCols"
						:key="c % colPool"
						class="tabula-grid-th"
						role="columnheader"
						:aria-colindex="c + 1"
						:aria-sort="ariaSort(c)"
						:class="[
							{
								'is-right': cellClasses[c]?.includes('is-right'),
								'is-center': cellClasses[c]?.includes('is-center'),
								'is-selected': colSelected(c)
							},
							refClass(null, c)
						]"
						:style="headerStyle(c)"
						:title="headerTitle(c)"
						@mousedown="onHeaderDown($event, c)"
					>
						<span
							v-if="columnLetters"
							class="tabula-grid-th-letter"
							aria-hidden="true"
							v-text="columnName(c)"
						/>
						<span v-if="fields[c]?.formula" class="tabula-grid-fx" aria-hidden="true">ƒx</span>
						<span class="tabula-grid-th-text">{{ headerText(c) }}</span>
						<span v-if="fields[c]?.required" class="tabula-grid-required" aria-hidden="true">*</span>
						<svg
							v-if="fillingLookup(c) !== null"
							class="tabula-grid-th-link"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
							<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
						</svg>
						<svg
							v-if="sheetsOf(c).length > 0"
							class="tabula-grid-th-link tabula-grid-th-sheet"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<rect x="4" y="4" width="16" height="16" rx="2" />
							<path d="M4 10h16M10 10v10" />
						</svg>
						<span v-if="sortOf(c)" class="tabula-grid-sort" aria-hidden="true">
							{{ sortOf(c) === "asc" ? "↑" : "↓" }}
						</span>
						<svg
							v-if="isFiltered(c)"
							class="tabula-grid-filtered"
							viewBox="0 0 24 24"
							role="img"
							:aria-label="GRID_TEXT[locale].filtered"
						>
							<path d="M3 5h18l-7 8v6l-4 2v-8Z" />
						</svg>
						<button
							type="button"
							class="tabula-grid-th-menu"
							tabindex="-1"
							:aria-label="GRID_TEXT[locale].columnMenu"
							@mousedown.stop.prevent="openColumnMenu($event, c)"
						>
							⋯
						</button>
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
					:style="{ width: `${gutterWidth}px`, height: `${totalHeight + newRowHeight}px` }"
				>
					<div
						v-for="r in visibleRows"
						:key="r % rowPool"
						class="tabula-grid-rh"
						:class="[{ 'is-selected': rowSelected(r) }, rowClass(r)]"
						:title="rowTitle(r)"
						:style="{ transform: `translateY(${r * rowH}px)` }"
						@mousedown="onGutterDown($event, r)"
					>
						{{ sheetRow(r) }}
					</div>
					<div
						v-if="newRowHeight > 0"
						class="tabula-grid-rh is-new"
						:style="{ transform: `translateY(${totalHeight}px)` }"
						@mousedown="onNewRowDown"
					>
						+
					</div>
				</div>
				<div
					ref="body"
					class="tabula-grid-body"
					:data-version="dataVersion"
					:style="{
						top: `${headerHeight}px`,
						left: `${gutterWidth}px`,
						width: `${totalWidth}px`,
						height: `${totalHeight + newRowHeight}px`
					}"
					@mousedown="onBodyDown"
					@dblclick="startEdit()"
				>
					<!-- The pinned columns, held in place as the rest scroll under them. -->
					<div
						v-if="pinnedCount > 0"
						class="tabula-grid-pinned"
						:style="{ left: `${gutterWidth}px`, width: `${pinnedWidth}px`, height: `${totalHeight}px` }"
					>
						<div
							v-for="r in visibleRows"
							:key="r % rowPool"
							class="tabula-grid-row"
							:class="{ 'is-locked': rowLocked(r) }"
							role="presentation"
							:data-row="r"
							:style="{ transform: `translateY(${r * rowH}px)` }"
						>
							<div
								v-for="c in pinnedCols"
								:id="`${id}-${r}-${c}`"
								:key="c"
								class="tabula-grid-cell"
								role="gridcell"
								:aria-colindex="c + 1"
								:aria-selected="inRange(r, c)"
								:aria-readonly="!isEditable(fields[c]) || rowLocked(r) || undefined"
								:aria-invalid="issueClass(r, c) === 'is-error' ? 'true' : undefined"
								:class="[
									cellClasses[c],
									issueClass(r, c),
									toneClass(r, c),
									changeClass(r, c),
									refClass(r, c),
									lookClass(r, c),
									foundClass(r, c),
									filledClass(r, c),
									entryClass(r, c)
								]"
								:style="cellStyles[c]"
								:title="issueTitle(r, c)"
							>
								{{ text(r, c) }}
							</div>
						</div>
						<div v-if="rangeParts.pinned" class="tabula-grid-range" :style="rangeParts.pinned" />
						<div v-if="active && activePinned" class="tabula-grid-active" :style="activeStyle" />
						<div v-if="fillParts?.pinned" class="tabula-grid-fill-preview" :style="fillParts.pinned" />
						<div
							v-if="fillHandle?.pinned"
							class="tabula-grid-fill"
							:style="fillHandle.style"
							:title="GRID_TEXT[locale].fillHandle"
							aria-hidden="true"
							@mousedown.stop="onFillDown"
							@dblclick.stop="onFillDouble"
						/>
					</div>
					<div
						v-for="r in visibleRows"
						:key="r % rowPool"
						class="tabula-grid-row"
						:class="{ 'is-locked': rowLocked(r) }"
						role="row"
						:aria-rowindex="r + 2"
						:data-row="r"
						:aria-owns="pinnedCount > 0 ? pinnedCols.map(c => `${id}-${r}-${c}`).join(' ') : undefined"
						:style="{ transform: `translateY(${r * rowH}px)` }"
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
							:class="[
								cellClasses[c],
								issueClass(r, c),
								toneClass(r, c),
								changeClass(r, c),
								refClass(r, c),
								lookClass(r, c),
								foundClass(r, c),
								filledClass(r, c),
								entryClass(r, c)
							]"
							:style="cellStyles[c]"
							:title="issueTitle(r, c)"
						>
							{{ text(r, c) }}
						</div>
					</div>
					<div
						v-if="newRowHeight > 0"
						class="tabula-grid-new-row"
						role="button"
						:aria-label="GRID_TEXT[locale].newRow"
						:style="{ transform: `translateY(${totalHeight}px)`, height: `${newRowHeight}px` }"
						@mousedown.stop="onNewRowDown"
						@dblclick.stop
					>
						<span
							class="tabula-grid-new-row-text"
							:style="{ left: `${gutterWidth}px` }"
							v-text="GRID_TEXT[locale].newRow"
						/>
					</div>
					<div v-if="rangeParts.free" class="tabula-grid-range" :style="rangeParts.free" />
					<div v-if="active && !activePinned" class="tabula-grid-active" :style="activeStyle" />
					<div v-if="fillParts?.free" class="tabula-grid-fill-preview" :style="fillParts.free" />
					<div
						v-if="fillHandle && !fillHandle.pinned"
						class="tabula-grid-fill"
						:style="fillHandle.style"
						:title="GRID_TEXT[locale].fillHandle"
						aria-hidden="true"
						@mousedown.stop="onFillDown"
						@dblclick.stop="onFillDouble"
					/>
					<input
						v-if="active"
						ref="editor"
						v-model="draft"
						class="tabula-grid-input"
						:class="editing ? ['is-editing', cellClasses[editing.col]] : undefined"
						:style="editing ? editorStyle : inputStyle"
						:aria-label="inputLabel"
						:role="listField || entryField ? 'combobox' : undefined"
						:aria-autocomplete="listField || entryField ? 'list' : undefined"
						:aria-expanded="entryField ? entryListOpen : listField ? listOpen : undefined"
						:aria-controls="entryField ? entryListId : listField ? listId : undefined"
						:aria-activedescendant="
							entryListOpen
								? `${entryListId}-${entryHighlighted}`
								: listOpen && highlighted >= 0
									? `${listId}-${highlighted}`
									: undefined
						"
						:placeholder="picked ? `${picked.size} ${GRID_TEXT[locale].picked}` : undefined"
						autocomplete="off"
						spellcheck="false"
						@keydown="onInputKeydown"
						@keyup="followCaret"
						@click="followCaret"
						@input="onInput"
						@compositionstart="onCompositionStart"
						@blur="onInputBlur"
						@mousedown.stop
					/>
				</div>
			</div>
		</div>
		<ScrollThumbs :target="scroller" :inset-top="headerHeight" :inset-left="gutterWidth + pinnedWidth" />
		<div v-if="columnTotals" class="tabula-grid-totals" role="row" :style="{ height: `${rowH}px` }">
			<template v-for="c in [...pinnedCols, ...visibleCols.filter(col => col >= pinnedCount)]" :key="c">
				<div
					v-if="columnTotals[c] !== null"
					class="tabula-grid-totals-cell"
					:class="{ 'is-pinned': c < pinnedCount }"
					role="gridcell"
					:style="totalStyle(c)"
				>
					{{ columnTotals[c] }}
				</div>
			</template>
			<div
				class="tabula-grid-totals-kind"
				:style="{ width: `${gutterWidth + (columnTotals[0] === null ? (widths[0] ?? 0) : 0)}px` }"
			>
				<button
					ref="totalButton"
					type="button"
					class="tabula-grid-totals-pick"
					:class="{ 'is-open': totalMenu }"
					aria-haspopup="listbox"
					:aria-expanded="totalMenu !== null"
					:aria-label="GRID_TEXT[locale].totals"
					:title="GRID_TEXT[locale].totals"
					@click="totalMenu ? closeTotalMenu() : openTotalMenu()"
					@keydown="onTotalKeydown"
				>
					<span class="tabula-grid-totals-word" v-text="GRID_TEXT[locale][TOTAL_WORDS[totalKind]]" />
					<svg class="tabula-grid-totals-chevron" viewBox="0 0 24 24" aria-hidden="true">
						<path d="m6 9 6 6 6-6" />
					</svg>
				</button>
			</div>
		</div>
		<ul
			v-if="totalMenu"
			class="tabula-grid-totals-menu"
			role="listbox"
			:aria-label="GRID_TEXT[locale].totals"
			:style="{ left: `${totalMenu.left}px`, bottom: `${totalMenu.bottom}px`, minWidth: `${totalMenu.width}px` }"
		>
			<li
				v-for="kind in TOTAL_KINDS"
				:key="kind"
				role="option"
				:aria-selected="kind === totalKind"
				:class="{ 'is-active': kind === totalHover, 'is-selected': kind === totalKind }"
				@mousemove="hoverTotal(kind, $event)"
				@click="chooseTotal(kind)"
			>
				<span v-text="GRID_TEXT[locale][TOTAL_WORDS[kind]]" />
				<svg v-if="kind === totalKind" class="tabula-grid-totals-tick" viewBox="0 0 24 24" aria-hidden="true">
					<path d="m5 12 5 5 9-10" />
				</svg>
			</li>
		</ul>
		<ul
			v-if="listOpen"
			:id="listId"
			ref="suggestionList"
			class="tabula-grid-list tabula-scroll"
			:class="{ 'is-multiple': picked }"
			role="listbox"
			:aria-multiselectable="picked ? 'true' : undefined"
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
				:class="{
					'is-highlighted': index === highlighted,
					'is-disabled': item.disabled,
					'is-picked': picked?.has(item.key)
				}"
				role="option"
				:aria-selected="picked ? picked.has(item.key) : index === highlighted"
				:aria-disabled="item.disabled || undefined"
				@mousedown.prevent="pick(index)"
				@mousemove="item.disabled || (highlighted = index)"
			>
				<span v-if="picked" class="tabula-grid-option-check" aria-hidden="true" />
				<span class="tabula-grid-option-label">
					<template v-for="(part, at) in marked(item.label)" :key="at">
						<mark v-if="part.hit" class="tabula-grid-option-hit">{{ part.text }}</mark>
						<template v-else>{{ part.text }}</template>
					</template>
				</span>
				<span v-if="item.description" class="tabula-grid-option-description">
					<template v-for="(part, at) in marked(item.description)" :key="at">
						<mark v-if="part.hit" class="tabula-grid-option-hit">{{ part.text }}</mark>
						<template v-else>{{ part.text }}</template>
					</template>
				</span>
			</li>
			<li v-if="listNote" class="tabula-grid-list-note" role="presentation">{{ GRID_TEXT[locale][listNote] }}</li>
			<li v-if="picked" class="tabula-grid-list-note" role="presentation">{{ GRID_TEXT[locale].pickHint }}</li>
		</ul>
		<ScrollThumbs v-if="listOpen" :target="suggestionList" :layer="5" />
		<template v-if="entryField && entryPlace">
			<p
				v-if="entryOutcome && entryPlace.docked === null"
				class="tabula-grid-entry-result"
				:class="{ 'is-bad': !entryOutcome.ok, 'is-below': entryPlace.above }"
				role="status"
				:style="{
					left: `${entryPlace.left}px`,
					top: `${entryPlace.above ? entryPlace.bottom + 4 : entryPlace.top - 4}px`
				}"
			>
				<template v-if="entryOutcome.ok">
					= {{ entryOutcome.text }}
					<span class="tabula-grid-entry-note">· {{ entryNote }}</span>
				</template>
				<template v-else>{{ entryOutcome.text }}</template>
			</p>
			<FormulaHelp
				class="tabula-grid-entry"
				:class="{
					'is-above': entryPlace.above && entryPlace.docked === null,
					'is-docked': entryPlace.docked !== null
				}"
				:style="
					entryPlace.docked !== null
						? { bottom: `${entryPlace.docked + 8}px` }
						: {
								left: `${entryPlace.left}px`,
								top: `${entryPlace.above ? entryPlace.top - 4 : entryPlace.bottom + 4}px`
							}
				"
				:help="entryAid"
				:list-open="entryListOpen"
				:highlighted="entryHighlighted"
				:list-id="entryListId"
				:locale="locale"
				:buttons="entryButtons"
				:comma="comma"
				:result="entryPlace.docked !== null ? entryOutcome : null"
				@pick="insertEntry"
				@hover="entryHighlighted = $event"
				@insert="insertAtCaret"
			/>
		</template>
		<div v-if="entryNotice" class="tabula-grid-entry-notice" role="status">
			<p v-if="entryNoticeLines.written" class="tabula-grid-entry-line">
				<span v-text="entryNoticeLines.written" />
				<button type="button" class="tabula-grid-entry-action" @click="undoEntry">
					{{ GRID_TEXT[locale].entryUndo }}
				</button>
			</p>
			<p v-if="entryNoticeLines.failed" class="tabula-grid-entry-line is-bad">
				<span v-text="entryNoticeLines.failed" />
				<button type="button" class="tabula-grid-entry-action" @click="showEntryFailure">
					{{ GRID_TEXT[locale].entryShow }}
				</button>
			</p>
			<button
				type="button"
				class="tabula-grid-entry-close"
				:aria-label="GRID_TEXT[locale].entryClose"
				:title="GRID_TEXT[locale].entryClose"
				@click="closeEntryNotice"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>
		</div>
		<div
			v-if="columnMenu"
			class="tabula-grid-menu"
			role="menu"
			:aria-label="GRID_TEXT[locale].columnMenu"
			:style="{ left: `${columnMenu.left}px`, top: `${columnMenu.top}px` }"
			@keydown="onMenuKeydown"
		>
			<button type="button" role="menuitem" class="tabula-grid-menu-sort-asc" @click="columnAction('sortAsc')">
				{{ GRID_TEXT[locale].sortAsc }}
			</button>
			<button type="button" role="menuitem" class="tabula-grid-menu-sort-desc" @click="columnAction('sortDesc')">
				{{ GRID_TEXT[locale].sortDesc }}
			</button>
			<button
				v-if="sortOf(columnMenu.col)"
				type="button"
				role="menuitem"
				class="tabula-grid-menu-sort-clear"
				@click="columnAction('sortClear')"
			>
				{{ GRID_TEXT[locale].sortClear }}
			</button>
			<span class="tabula-grid-menu-line" role="separator" />
			<button type="button" role="menuitem" class="tabula-grid-menu-filter" @click="columnAction('filter')">
				{{ GRID_TEXT[locale].filter }}
			</button>
			<button
				v-if="isFiltered(columnMenu.col)"
				type="button"
				role="menuitem"
				class="tabula-grid-menu-filter-clear"
				@click="columnAction('filterClear')"
			>
				{{ GRID_TEXT[locale].filterClear }}
			</button>
			<span class="tabula-grid-menu-line" role="separator" />
			<button
				type="button"
				role="menuitem"
				class="tabula-grid-menu-pin"
				@click="columnAction(columnMenu.col < pinnedCount ? 'unpin' : 'pin')"
			>
				{{ columnMenu.col < pinnedCount ? GRID_TEXT[locale].unpin : GRID_TEXT[locale].pin }}
			</button>
			<button
				type="button"
				role="menuitem"
				class="tabula-grid-menu-hide"
				:disabled="fields.length <= 1"
				@click="columnAction('hide')"
			>
				{{ GRID_TEXT[locale].hide }}
			</button>
			<button
				v-if="hiddenCount > 0"
				type="button"
				role="menuitem"
				class="tabula-grid-menu-show"
				@click="columnAction('showHidden')"
			>
				{{ GRID_TEXT[locale].showHidden }} ({{ hiddenCount }})
			</button>
		</div>
		<div
			v-if="contextMenu"
			class="tabula-grid-menu tabula-grid-context"
			role="menu"
			:aria-label="GRID_TEXT[locale].cellMenu"
			:style="{ left: `${contextMenu.left}px`, top: `${contextMenu.top}px` }"
			@keydown="onContextKeydown"
			@contextmenu.prevent
		>
			<p
				v-if="pasteRefused"
				class="tabula-grid-menu-note is-hint"
				role="status"
				v-text="GRID_TEXT[locale].pasteRefused"
			/>
			<template v-if="contextMenu.issues.length > 0">
				<p v-for="(line, at) in contextMenu.issues" :key="at" class="tabula-grid-menu-note" v-text="line" />
				<span class="tabula-grid-menu-line" role="separator" />
			</template>
			<template v-for="(entry, at) in contextEntries" :key="entry?.key ?? `line-${at}`">
				<span v-if="entry === null" class="tabula-grid-menu-line" role="separator" />
				<div v-else-if="entry.children?.length" class="tabula-grid-menu-item">
					<button
						type="button"
						role="menuitem"
						aria-haspopup="menu"
						:aria-expanded="submenu === entry.key"
						:data-key="entry.key"
						:disabled="entry.disabled"
						:class="{ 'is-open': submenu === entry.key }"
						@click="chooseMenu(entry, $event)"
						@mouseenter="submenu = entry.key"
					>
						<span v-text="entry.label" />
						<span class="tabula-grid-menu-key" aria-hidden="true">
							<span v-if="entry.badge" class="tabula-grid-menu-badge" v-text="entry.badge" />
							<svg class="tabula-grid-menu-chevron" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
						</span>
					</button>
					<div
						v-if="submenu === entry.key"
						class="tabula-grid-menu tabula-grid-submenu"
						:class="{ 'is-left': submenuPlace.left }"
						:style="submenuPlace.shift ? { marginTop: `${submenuPlace.shift}px` } : undefined"
						role="menu"
						:aria-label="entry.label"
					>
						<template v-for="child in entry.children" :key="child.key">
							<span v-if="child.kind === 'line'" class="tabula-grid-menu-line" role="separator" />
							<span
								v-else-if="child.kind === 'heading'"
								class="tabula-grid-menu-heading"
								role="presentation"
								v-text="child.label"
							/>
							<button
								v-else
								type="button"
								role="menuitem"
								:class="{ 'is-danger': child.danger }"
								:disabled="child.disabled"
								@click="chooseMenu(child)"
							>
								<span v-text="child.label" />
								<span v-if="child.shortcut" class="tabula-grid-menu-key" v-text="child.shortcut" />
							</button>
						</template>
					</div>
				</div>
				<button
					v-else
					type="button"
					role="menuitem"
					:data-key="entry.key"
					:class="{ 'is-danger': entry.danger }"
					:disabled="entry.disabled"
					@click="chooseMenu(entry)"
					@mouseenter="submenu = null"
				>
					<span v-text="entry.label" />
					<span v-if="entry.shortcut" class="tabula-grid-menu-key" v-text="entry.shortcut" />
				</button>
			</template>
		</div>
		<div
			v-if="filterPanel"
			class="tabula-grid-filter"
			role="dialog"
			:aria-label="`${GRID_TEXT[locale].filterTitle}: ${filterPanel.field.label}`"
			:style="{ left: `${filterPanel.left}px`, top: `${filterPanel.top}px` }"
			@keydown="onFilterKeydown"
		>
			<strong class="tabula-grid-filter-title">{{ filterPanel.field.label }}</strong>
			<div v-if="filterPanel.range" class="tabula-grid-filter-range">
				<label>
					<span>{{ GRID_TEXT[locale].from }}</span>
					<input v-model="filterFrom" class="tabula-grid-filter-from" type="text" autocomplete="off" />
				</label>
				<label>
					<span>{{ GRID_TEXT[locale].to }}</span>
					<input v-model="filterTo" class="tabula-grid-filter-to" type="text" autocomplete="off" />
				</label>
			</div>
			<p v-if="filterProblem" class="tabula-grid-filter-problem" role="alert">{{ filterProblem }}</p>
			<input
				v-model="filterSearch"
				class="tabula-grid-filter-search"
				type="search"
				autocomplete="off"
				:placeholder="GRID_TEXT[locale].search"
				:aria-label="GRID_TEXT[locale].search"
			/>
			<label class="tabula-grid-filter-all">
				<input
					type="checkbox"
					:checked="allShownChecked"
					:indeterminate="someShownChecked && !allShownChecked"
					@change="toggleShown"
				/>
				{{ GRID_TEXT[locale].selectAll }}
			</label>
			<ul ref="filterList" class="tabula-grid-filter-list tabula-scroll">
				<li v-for="entry in shownValues" :key="entry.key">
					<label>
						<input
							type="checkbox"
							:checked="filterChecked.has(entry.key)"
							@change="toggleValue(entry.key)"
						/>
						<span class="tabula-grid-filter-value">{{ valueLabel(entry) }}</span>
						<span class="tabula-grid-filter-count">{{ entry.count }}</span>
					</label>
				</li>
			</ul>
			<ScrollThumbs :target="filterList" />
			<p v-if="filterPanel.more > 0" class="tabula-grid-filter-more">
				+{{ filterPanel.more }} {{ GRID_TEXT[locale].moreValues }}
			</p>
			<div class="tabula-grid-filter-buttons">
				<button type="button" class="tabula-grid-filter-apply" @click="applyFilter">
					{{ GRID_TEXT[locale].apply }}
				</button>
				<button type="button" class="tabula-grid-filter-clear" @click="clearFilter">
					{{ GRID_TEXT[locale].clear }}
				</button>
				<button type="button" class="tabula-grid-filter-cancel" @click="closeFilterPanel(true)">
					{{ GRID_TEXT[locale].cancel }}
				</button>
			</div>
		</div>
		<div ref="headerProbe" class="tabula-grid-th tabula-grid-probe" aria-hidden="true" />
		<div ref="cellProbe" class="tabula-grid-cell tabula-grid-probe" aria-hidden="true" />
	</div>
</template>

<style src="./theme.css"></style>

<style>
/* The colours are in theme.css, shared with the issue panel. */
.tabula-grid {
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
	font-size: calc(var(--tabula-font-size) * var(--tabula-zoom, 1));
	line-height: 1.35;
	font-variant-numeric: tabular-nums;
	user-select: none;
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
	display: flex;
	box-sizing: border-box;
	border-bottom: 1px solid var(--tabula-head-line);
	background: var(--tabula-head-bg);
}

.tabula-grid-corner {
	position: sticky;
	left: 0;
	z-index: 2;
	flex: none;
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

/*
 * The column's letter, before its label in the same row, softer and smaller: a formula's A1 still
 * reads, and the sheet keeps a row a strip of letters would take.
 */
.tabula-grid-th-letter {
	flex: none;
	margin-right: 6px;
	color: var(--tabula-muted);
	font-size: 0.85em;
	font-weight: 500;
}

.tabula-grid-th.is-right {
	justify-content: flex-end;
}

.tabula-grid-th.is-center {
	justify-content: center;
}

/* A selected column: a line under its header and its letter in green. A selected row: its number. */
.tabula-grid-th.is-selected {
	background: var(--tabula-head-selected-bg);
	box-shadow: inset 0 -2px 0 var(--tabula-accent);
}

.tabula-grid-th.is-selected .tabula-grid-th-letter {
	color: var(--tabula-accent-text);
}

.tabula-grid-rh.is-selected {
	background: var(--tabula-head-selected-bg);
	color: var(--tabula-accent-text);
	font-weight: 600;
}

/* A column a record fills, such as a product's code: a link after its label; the tooltip says which. */
.tabula-grid-th-link {
	flex: none;
	width: 13px;
	height: 13px;
	margin-left: 5px;
	fill: none;
	stroke: var(--tabula-muted);
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
}

/* A column worked out from other sheets: a sheet after its label; the tooltip names them. */
.tabula-grid-th-sheet {
	stroke: var(--tabula-sheet);
}

.tabula-grid-th-text {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* A column worked out by a formula: its formula is in the header's tooltip. */
.tabula-grid-fx {
	flex: none;
	padding-right: 5px;
	color: var(--tabula-muted);
	font-size: 0.85em;
	font-style: italic;
	font-weight: 500;
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

/* A header's menu button: there when the pointer is over the header. */
.tabula-grid-th-menu {
	position: absolute;
	top: 50%;
	right: 9px;
	display: none;
	padding: 0 5px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius-small);
	background: var(--tabula-head-bg);
	color: var(--tabula-muted);
	font: inherit;
	line-height: 18px;
	transform: translateY(-50%);
	cursor: pointer;
}

.tabula-grid-th:hover .tabula-grid-th-menu {
	display: block;
}

/*
 * The menu button takes room of its own while it shows, so it never covers the header: the words
 * draw back from it, softly, and the button keeps its place on the right in every column.
 */
.tabula-grid-th {
	transition: padding-right 0.12s ease-out;
}

.tabula-grid-th:hover {
	padding-right: 40px;
}

@media (prefers-reduced-motion: reduce) {
	.tabula-grid-th {
		transition: none;
	}
}

.tabula-grid-menu {
	animation: tabula-grid-drop 0.14s ease-out;
	position: absolute;
	z-index: 6;
	display: flex;
	flex-direction: column;
	min-width: 190px;
	padding: 3px 0;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
}

.tabula-grid-menu button {
	padding: 6px 12px;
	border: 0;
	background: transparent;
	color: var(--tabula-fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.tabula-grid-menu button:hover,
.tabula-grid-menu button:focus-visible {
	outline: none;
	background: var(--tabula-range-bg);
}

.tabula-grid-menu button:disabled {
	color: var(--tabula-muted);
	cursor: default;
}

/* The context menu: at the pointer, over everything, each item with its keys on the right. */
.tabula-grid-context {
	position: fixed;
	z-index: 1000;
	min-width: 230px;
}

.tabula-grid-context button {
	display: flex;
	gap: 24px;
	align-items: center;
	justify-content: space-between;
	width: 100%;
}

.tabula-grid-menu-key {
	display: inline-flex;
	flex: none;
	align-items: center;
	color: var(--tabula-muted);
	font-size: 0.9em;
	white-space: nowrap;
}

/* A group's items keep to one line each: the group grows to the longest, such as a value filtered by. */
.tabula-grid-submenu button {
	white-space: nowrap;
}

.tabula-grid-menu-note {
	max-width: 300px;
	margin: 0;
	padding: 6px 12px;
	color: var(--tabula-issues-error);
	font-size: 0.92em;
	white-space: normal;
}

.tabula-grid-menu-note.is-hint {
	color: var(--tabula-muted);
}

.tabula-grid-menu-item {
	position: relative;
}

.tabula-grid-submenu {
	top: -4px;
	left: 100%;
	min-width: 190px;
}

/* No room on the right: the items open on the left of their group. */
.tabula-grid-submenu.is-left {
	right: 100%;
	left: auto;
}

/* A group whose items are open stays marked while the pointer is among them. */
.tabula-grid-menu button.is-open {
	background: var(--tabula-range-bg);
}

.tabula-grid-menu-chevron {
	width: 14px;
	height: 14px;
	vertical-align: -2px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
}

/* How many rows a group's items act on, before its chevron. */
.tabula-grid-menu-badge {
	margin-right: 6px;
	font-variant-numeric: tabular-nums;
}

/* A small title over the items after it, inside a group, such as "Yuvarla". */
.tabula-grid-menu-heading {
	padding: 6px 12px 2px;
	color: var(--tabula-muted);
	font-size: 0.85em;
	font-weight: 600;
}

/* An item that takes something away, such as deleting rows. */
.tabula-grid-menu button.is-danger:not(:disabled) {
	color: var(--tabula-required);
}

.tabula-grid-menu-line {
	height: 1px;
	margin: 3px 0;
	background: var(--tabula-line);
}

/* A column sorted, and one filtered: by its name, in the accent. */
.tabula-grid-sort {
	flex: none;
	padding-left: 4px;
	color: var(--tabula-accent-text);
	font-weight: 700;
}

.tabula-grid-filtered {
	flex: none;
	width: 13px;
	height: 13px;
	margin-left: 4px;
	fill: var(--tabula-accent-text);
}

/* A column's filter: its values to tick, or a range of its numbers or dates. */
.tabula-grid-filter {
	animation: tabula-grid-drop 0.14s ease-out;
	position: absolute;
	z-index: 7;
	display: flex;
	flex-direction: column;
	gap: 8px;
	box-sizing: border-box;
	width: 260px;
	max-width: calc(100% - 16px);
	padding: 12px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
	color: var(--tabula-fg);
	font-weight: 400;
}

.tabula-grid-filter-title {
	overflow: hidden;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-grid-filter-range {
	display: flex;
	gap: 8px;
}

.tabula-grid-filter-range label {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	color: var(--tabula-muted);
	font-size: 0.92em;
}

.tabula-grid-filter input[type="text"],
.tabula-grid-filter input[type="search"] {
	box-sizing: border-box;
	width: 100%;
	height: 30px;
	padding: 0 8px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius-small);
	outline: none;
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	font: inherit;
}

.tabula-grid-filter input[type="text"]:focus,
.tabula-grid-filter input[type="search"]:focus {
	border-color: var(--tabula-accent);
}

.tabula-grid-filter input[type="checkbox"] {
	margin: 0;
	accent-color: var(--tabula-accent-text);
}

.tabula-grid-filter-all,
.tabula-grid-filter-list label {
	display: flex;
	gap: 8px;
	align-items: center;
	min-height: 26px;
	cursor: pointer;
}

/*
 * The list reaches into the panel's padding, so its scroll bar runs there rather than against the
 * counts, and gives the room back: the values end where the rest of the panel does.
 */
.tabula-grid-filter-list {
	max-height: 220px;
	margin: 0 -8px 0 0;
	padding: 0 8px 0 0;
	overflow: auto;
	list-style: none;
	border-top: 1px solid var(--tabula-line);
}

.tabula-grid-filter-value {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-grid-filter-count,
.tabula-grid-filter-more {
	color: var(--tabula-muted);
	font-size: 0.9em;
}

.tabula-grid-filter-more,
.tabula-grid-filter-problem {
	margin: 0;
}

.tabula-grid-filter-problem {
	color: var(--tabula-required);
}

.tabula-grid-filter-buttons {
	display: flex;
	gap: 6px;
	justify-content: flex-end;
}

.tabula-grid-filter-buttons button {
	padding: 4px 10px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius-small);
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	font: inherit;
	cursor: pointer;
}

.tabula-grid-filter-buttons .tabula-grid-filter-apply {
	border-color: var(--tabula-accent-text);
	background: var(--tabula-accent-text);
	color: var(--tabula-bg);
	font-weight: 600;
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

/* The row after the last, that adds one: faint until the pointer is on it. */
.tabula-grid-rh.is-new {
	color: var(--tabula-accent-text);
	cursor: pointer;
}

.tabula-grid-new-row {
	position: absolute;
	top: 0;
	right: 0;
	left: 0;
	box-sizing: border-box;
	border-bottom: 1px dashed var(--tabula-line);
	background: var(--tabula-head-bg);
	color: var(--tabula-muted);
	cursor: pointer;
}

.tabula-grid-new-row:hover {
	color: var(--tabula-accent-text);
	background: var(--tabula-range-bg);
}

/* The words stay in sight while the sheet scrolls sideways. */
.tabula-grid-new-row-text {
	position: sticky;
	left: 0;
	display: inline-block;
	padding: 0 9px;
	font-style: italic;
	line-height: calc(var(--tabula-row-height) - 1px);
	white-space: nowrap;
}

/* Clipped, but not a scroll box of its own: the pinned columns inside stick to the sheet's scrolling. */
.tabula-grid-body {
	position: absolute;
	z-index: 0;
	overflow: clip;
}

/* The pinned columns: in the head and in the body, held in place while the rest scroll under them. */
.tabula-grid-head-pinned,
.tabula-grid-pinned {
	position: sticky;
	z-index: 1;
	flex: none;
	box-shadow: inset -2px 0 0 var(--tabula-head-line);
}

.tabula-grid-head-pinned {
	height: 100%;
	background: var(--tabula-head-bg);
}

.tabula-grid-pinned {
	background: var(--tabula-bg);
}

.tabula-grid.is-scrolled-x .tabula-grid-head-pinned,
.tabula-grid.is-scrolled-x .tabula-grid-pinned {
	box-shadow:
		inset -2px 0 0 var(--tabula-head-line),
		4px 0 6px -3px rgb(0 0 0 / 22%);
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

/* The columns the active cell's formula reads, each in its colour; its own row's cells stronger. */
.tabula-grid-th.is-ref {
	box-shadow: inset 0 3px 0 var(--tabula-ref);
	color: var(--tabula-ref);
}

.tabula-grid-cell.is-ref {
	box-shadow:
		inset 2px 0 0 color-mix(in srgb, var(--tabula-ref) 55%, transparent),
		inset -2px 0 0 color-mix(in srgb, var(--tabula-ref) 55%, transparent);
	background: color-mix(in srgb, var(--tabula-ref) 5%, var(--tabula-bg));
}

.tabula-grid-cell.is-ref-here {
	background: color-mix(in srgb, var(--tabula-ref) 16%, var(--tabula-bg));
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

/* A cell the user changed since the sheet was loaded: a mark in the top left, apart from an issue's. */
.tabula-grid-cell.is-changed::before {
	content: "";
	position: absolute;
	top: 0;
	left: 0;
	border-width: 6px 6px 0 0;
	border-style: solid;
	border-color: var(--tabula-changed-mark) transparent transparent transparent;
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

/* While a filter leaves rows out, the row numbers, which then skip, say so, as a spreadsheet's do. */
.tabula-grid.is-filtered .tabula-grid-rh {
	color: var(--tabula-accent);
}

/* The worst issue anywhere on the row colours its number: no mark of its own beside it. */
.tabula-grid-rh.is-error {
	color: var(--tabula-error-mark);
	font-weight: 600;
}

.tabula-grid-rh.is-warning {
	color: var(--tabula-warning-mark);
	font-weight: 600;
}

/* A server's word on a row changed since: waits to be checked again. */
.tabula-grid-rh.is-stale {
	text-decoration: underline dotted;
	text-underline-offset: 3px;
}

.tabula-grid-cell.is-readonly {
	background: var(--tabula-readonly-bg);
	color: var(--tabula-readonly-fg);
}

/*
 * A cell its row's record filled, such as a product's code: drawn as a read-only one; the link in
 * its header and its tooltip say where it came from.
 */
.tabula-grid-cell.is-filled {
	background: var(--tabula-filled-bg);
	color: var(--tabula-filled-fg);
}

/* A column coloured by its numbers' sign: a rise and a fall, read or not. */
.tabula-grid-cell.is-positive {
	color: var(--tabula-positive);
}

.tabula-grid-cell.is-negative {
	color: var(--tabula-negative);
}

/*
 * What the user put on a cell, and what the template's colour rules do: a fill under an issue's tint,
 * which is never hidden, and a text colour over the sign's and a read-only column's.
 */
.tabula-grid-cell.is-fill-yellow {
	--tabula-fill-look: var(--tabula-mark-yellow);
}

.tabula-grid-cell.is-fill-green {
	--tabula-fill-look: var(--tabula-mark-green);
}

.tabula-grid-cell.is-fill-blue {
	--tabula-fill-look: var(--tabula-mark-blue);
}

.tabula-grid-cell.is-fill-purple {
	--tabula-fill-look: var(--tabula-mark-purple);
}

.tabula-grid-cell.is-fill-pink {
	--tabula-fill-look: var(--tabula-mark-pink);
}

.tabula-grid-cell.is-fill-orange {
	--tabula-fill-look: var(--tabula-mark-orange);
}

.tabula-grid-cell.is-fill-grey {
	--tabula-fill-look: var(--tabula-mark-grey);
}

.tabula-grid-cell.is-fill-red {
	--tabula-fill-look: var(--tabula-mark-red);
}

.tabula-grid-cell.is-text-yellow {
	--tabula-text-look: var(--tabula-mark-yellow);
}

.tabula-grid-cell.is-text-green {
	--tabula-text-look: var(--tabula-mark-green);
}

.tabula-grid-cell.is-text-blue {
	--tabula-text-look: var(--tabula-mark-blue);
}

.tabula-grid-cell.is-text-purple {
	--tabula-text-look: var(--tabula-mark-purple);
}

.tabula-grid-cell.is-text-pink {
	--tabula-text-look: var(--tabula-mark-pink);
}

.tabula-grid-cell.is-text-orange {
	--tabula-text-look: var(--tabula-mark-orange);
}

.tabula-grid-cell.is-text-grey {
	--tabula-text-look: var(--tabula-mark-grey);
}

.tabula-grid-cell.is-text-red {
	--tabula-text-look: var(--tabula-mark-red);
}

.tabula-grid .tabula-grid-cell[class*="is-fill-"]:not(.is-error, .is-warning) {
	background: color-mix(in srgb, var(--tabula-fill-look) 24%, var(--tabula-bg));
}

.tabula-grid .tabula-grid-cell[class*="is-text-"] {
	color: color-mix(in srgb, var(--tabula-text-look) 58%, var(--tabula-fg));
}

.tabula-grid-cell.is-bold {
	font-weight: 700;
}

.tabula-grid-cell.is-italic {
	font-style: italic;
}

/* What a find found, over every other look while it is open; the one it is on outlined. */
.tabula-grid .tabula-grid-cell.is-found,
.tabula-grid .tabula-grid-cell.is-found-current {
	background: color-mix(in srgb, var(--tabula-mark-yellow) 38%, var(--tabula-bg));
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tabula-mark-yellow) 75%, var(--tabula-fg));
}

.tabula-grid .tabula-grid-cell.is-found-current {
	box-shadow: inset 0 0 0 2px var(--tabula-accent);
}

/* The totals, under the rows and held in place, each under its column. */
.tabula-grid-totals {
	position: relative;
	flex: none;
	overflow: hidden;
	border-top: 1px solid var(--tabula-head-line);
	background: var(--tabula-head-bg);
	font-weight: 600;
}

.tabula-grid-totals-cell {
	position: absolute;
	top: 0;
	box-sizing: border-box;
	height: 100%;
	padding: 0 9px;
	overflow: hidden;
	border-right: 1px solid var(--tabula-line);
	background: var(--tabula-head-bg);
	line-height: calc(var(--tabula-row-height) - 1px);
	text-align: right;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-grid-totals-cell.is-pinned {
	z-index: 1;
}

.tabula-grid-totals-kind {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 2;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	height: 100%;
	padding: 0 6px;
	border-right: 1px solid var(--tabula-head-line);
	background: var(--tabula-head-bg);
}

/*
 * What the totals row shows: the row's own words and a chevron, not a field; a press opens the list
 * above. Only the pointer or the focus draws its edge.
 */
.tabula-grid-totals-pick {
	display: flex;
	flex: none;
	gap: 4px;
	align-items: center;
	box-sizing: border-box;
	min-width: 0;
	max-width: 100%;
	height: calc(100% - 8px);
	padding: 0 6px;
	border: 0;
	border-radius: var(--tabula-radius);
	background: transparent;
	color: var(--tabula-fg);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.tabula-grid-totals-pick:hover,
.tabula-grid-totals-pick.is-open {
	background: var(--tabula-hover-bg);
}

.tabula-grid-totals-pick:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: -2px;
}

.tabula-grid-totals-word {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-grid-totals-chevron,
.tabula-grid-totals-tick {
	flex: none;
	width: 14px;
	height: 14px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.tabula-grid-totals-chevron {
	color: var(--tabula-muted);
	transition: transform 0.15s ease;
}

.tabula-grid-totals-pick.is-open .tabula-grid-totals-chevron {
	transform: rotate(180deg);
}

.tabula-grid-totals-menu {
	position: absolute;
	z-index: 6;
	box-sizing: border-box;
	margin: 0;
	padding: 4px;
	list-style: none;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
	animation: tabula-grid-rise 0.14s ease-out;
}

.tabula-grid-totals-menu li {
	display: flex;
	gap: 16px;
	align-items: center;
	justify-content: space-between;
	padding: 7px 10px;
	border-radius: var(--tabula-radius-small);
	cursor: pointer;
}

.tabula-grid-totals-menu li.is-active {
	background: var(--tabula-range-bg);
}

.tabula-grid-totals-menu li.is-selected {
	color: var(--tabula-accent-text);
	font-weight: 600;
}

/* A list opening above what opened it. */
@keyframes tabula-grid-rise {
	from {
		opacity: 0;
		transform: translateY(4px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

/* A menu or a list opening under what opened it. */
@keyframes tabula-grid-drop {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@media (prefers-reduced-motion: reduce) {
	.tabula-grid-totals-menu,
	.tabula-grid-menu,
	.tabula-grid-filter,
	.tabula-grid-list {
		animation: none;
	}
}

.tabula-grid-sr {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

/* The worst issue on any of the row's cells, by its number. */
/* A cell no one types into can still be wrong, such as a formula that cannot be worked out. */
.tabula-grid-cell.is-readonly.is-error,
.tabula-grid-cell.is-filled.is-error {
	background: var(--tabula-error-bg);
}

.tabula-grid-cell.is-readonly.is-warning,
.tabula-grid-cell.is-filled.is-warning {
	background: var(--tabula-warning-bg);
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

/* The fill handle: the small square on the selection's corner, as in Excel. */
.tabula-grid-fill {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 3;
	box-sizing: border-box;
	width: 7px;
	height: 7px;
	margin: -4px 0 0 -4px;
	border: 1px solid var(--tabula-bg);
	background: var(--tabula-muted);
	cursor: crosshair;
}

.tabula-grid:focus-within .tabula-grid-fill {
	background: var(--tabula-accent);
}

/* Easier to catch than to see. */
.tabula-grid-fill::before {
	position: absolute;
	inset: -4px;
	content: "";
}

.tabula-grid.is-filling,
.tabula-grid.is-filling * {
	cursor: crosshair;
}

/* Where letting go of the handle would fill. */
.tabula-grid-fill-preview {
	position: absolute;
	top: 0;
	left: 0;
	box-sizing: border-box;
	border: 1px dashed var(--tabula-fg);
	pointer-events: none;
}

/* A finger cannot hold a square this small; on a touch screen, filling is a paste. */
@media not (any-pointer: fine) {
	.tabula-grid-fill {
		display: none;
	}
}

/* Waiting on the active cell for whatever is typed: there, focused, and not seen. */
.tabula-grid-input {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 2;
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

/* A formula typed with "=": its result over the editor, its help under it. */
.tabula-grid-entry-result {
	animation: tabula-grid-drop 0.12s ease-out;
	position: absolute;
	z-index: 6;
	max-width: 520px;
	margin: 0;
	padding: 4px 10px;
	overflow: hidden;
	border-radius: var(--tabula-radius);
	background: color-mix(in srgb, var(--tabula-fg) 88%, var(--tabula-bg));
	color: var(--tabula-bg);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
	text-overflow: ellipsis;
	box-shadow: 0 6px 16px rgb(0 0 0 / 20%);
	transform: translateY(-100%);
	pointer-events: none;
}

.tabula-grid-entry-result.is-below {
	transform: none;
}

.tabula-grid-entry-result.is-bad {
	background: var(--tabula-error-bg);
	color: var(--tabula-required);
	box-shadow:
		inset 0 0 0 1px color-mix(in srgb, var(--tabula-error) 40%, var(--tabula-bg)),
		0 6px 16px rgb(0 0 0 / 12%);
}

.tabula-grid-entry-note {
	opacity: 0.72;
}

.tabula-grid-entry {
	animation: tabula-grid-drop 0.12s ease-out;
	position: absolute;
	z-index: 6;
	width: max-content;
}

.tabula-grid-entry.is-above {
	transform: translateY(-100%);
}

/* On a touch screen: over the keyboard, the width of the screen. */
.tabula-grid-entry.is-docked {
	position: fixed;
	right: 8px;
	left: 8px;
	width: auto;
	max-width: none;
	padding: 8px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	box-shadow: 0 -8px 24px rgb(0 0 0 / 14%);
}

/* What Ctrl+Enter wrote, and the cells it could not: until it is closed. */
.tabula-grid-entry-notice {
	animation: tabula-grid-drop 0.12s ease-out;
	position: absolute;
	bottom: 12px;
	left: 12px;
	z-index: 7;
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-width: min(460px, calc(100% - 24px));
	padding: 10px 40px 10px 14px;
	border-radius: var(--tabula-radius);
	background: color-mix(in srgb, var(--tabula-fg) 90%, var(--tabula-bg));
	color: var(--tabula-bg);
	box-shadow: 0 10px 28px rgb(0 0 0 / 25%);
}

.tabula-grid-entry-line {
	display: flex;
	gap: 10px;
	align-items: baseline;
	margin: 0;
}

.tabula-grid-entry-line > span {
	flex: 1;
}

.tabula-grid-entry-line.is-bad > span {
	color: color-mix(in srgb, var(--tabula-error) 55%, var(--tabula-bg));
}

.tabula-grid-entry-action {
	flex: none;
	padding: 2px 4px;
	border: 0;
	border-radius: var(--tabula-radius-small);
	background: transparent;
	color: color-mix(in srgb, var(--tabula-accent) 60%, var(--tabula-bg));
	font: inherit;
	font-weight: 600;
	cursor: pointer;
	transition: background-color 0.12s ease;
}

.tabula-grid-entry-action:hover {
	background: color-mix(in srgb, var(--tabula-bg) 14%, transparent);
}

.tabula-grid-entry-close {
	position: absolute;
	top: 6px;
	right: 6px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border: 0;
	border-radius: var(--tabula-radius-small);
	background: transparent;
	color: inherit;
	cursor: pointer;
	opacity: 0.7;
	transition: opacity 0.12s ease;
}

.tabula-grid-entry-close:hover {
	opacity: 1;
}

.tabula-grid-entry-close svg {
	width: 16px;
	height: 16px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
}

.tabula-grid-cell.is-entry-failed {
	background: var(--tabula-error-bg);
	box-shadow: inset 0 0 0 1px var(--tabula-error-mark);
}

/* The list under the editor: options, or a lookup's records. */
.tabula-grid-list {
	animation: tabula-grid-drop 0.12s ease-out;
	position: absolute;
	z-index: 5;
	box-sizing: border-box;
	max-width: 420px;
	max-height: 280px;
	margin: 0;
	padding: 2px 0;
	overflow: auto;
	border: 1px solid var(--tabula-head-line);
	border-radius: 0 0 var(--tabula-radius) var(--tabula-radius);
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

/* What is typed, where an entry holds it. */
.tabula-grid-option-hit {
	border-radius: 2px;
	background: color-mix(in srgb, var(--tabula-warning) 32%, transparent);
	color: inherit;
}

.tabula-grid-option.is-highlighted {
	background: var(--tabula-range-bg);
	box-shadow: inset 2px 0 0 var(--tabula-accent);
}

/* Several options: each a box to tick, before its label. */
.tabula-grid-list.is-multiple .tabula-grid-option {
	align-items: center;
	justify-content: flex-start;
}

.tabula-grid-option-check {
	position: relative;
	box-sizing: border-box;
	flex: none;
	width: 14px;
	height: 14px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius-small);
	background: var(--tabula-bg);
}

.tabula-grid-option.is-picked .tabula-grid-option-check {
	border-color: var(--tabula-accent);
	background: var(--tabula-accent);
}

.tabula-grid-option.is-picked .tabula-grid-option-check::after {
	position: absolute;
	top: 1px;
	left: 4px;
	width: 3px;
	height: 7px;
	border: solid var(--tabula-bg);
	border-width: 0 2px 2px 0;
	transform: rotate(45deg);
	content: "";
}

.tabula-grid-list.is-multiple .tabula-grid-option-label {
	flex: 1;
}

/* The keys' hint reads in two lines, however narrow the cell. */
.tabula-grid-list.is-multiple .tabula-grid-list-note {
	min-width: 210px;
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
