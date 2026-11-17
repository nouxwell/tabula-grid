<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import type { SpikeColumn } from "../data"

const props = defineProps<{
	columns: SpikeColumn[]
	rows: string[][]
	errors: Set<number>
}>()

const ROW_HEIGHT = 30
const OVERSCAN_ROWS = 6
const OVERSCAN_COLS = 2

// Plain references, taken once. The sheet is deliberately kept out of Vue's reactivity: the
// component re-renders when `dataVersion` moves, not when a cell is written.
const sheet = props.rows
const columnList = props.columns
const errorCells = props.errors

const rowCount = sheet.length
const colCount = columnList.length

/** The left edge of every column, and after them the right edge of the last. */
const offsets: number[] = [0]

for (const column of columnList) {
	offsets.push((offsets[offsets.length - 1] ?? 0) + column.width)
}

const totalWidth = offsets[colCount] ?? 0
const totalHeight = rowCount * ROW_HEIGHT
const narrowest = Math.min(...columnList.map(column => column.width))

const cellStyles = columnList.map((column, index) => `left:${offsets[index]}px;width:${column.width}px`)
const cellClasses = columnList.map(
	column => `${column.numeric ? "is-numeric " : ""}${column.readonly ? "is-readonly" : ""}`
)

const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const header = ref<HTMLElement | null>(null)
const editor = ref<HTMLInputElement | null>(null)

// The window of cells that exists in the DOM. Four numbers, so a scroll that stays inside the
// overscan changes none of them and renders nothing.
const firstRow = ref(0)
const lastRow = ref(-1)
const firstCol = ref(0)
const lastCol = ref(-1)

// How many rows and columns can be on screen at once. A cell's key is its index modulo this, so
// an element that scrolls out is handed to the row that scrolls in rather than destroyed.
const rowPool = ref(1)
const colPool = ref(1)

const dataVersion = ref(0)

const activeRow = ref(0)
const activeCol = ref(0)
const anchorRow = ref(0)
const anchorCol = ref(0)

const editing = ref(false)
const draft = ref("")

let viewWidth = 0
let viewHeight = 0
let resizeObserver: ResizeObserver | null = null

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

function span(first: number, last: number): number[] {
	const indexes: number[] = []

	for (let index = first; index <= last; index++) {
		indexes.push(index)
	}

	return indexes
}

/** The column under a horizontal position, by binary search over the offsets. */
function columnAt(x: number): number {
	let low = 0
	let high = colCount - 1

	while (low < high) {
		const middle = (low + high + 1) >> 1

		if ((offsets[middle] ?? 0) <= x) {
			low = middle
		} else {
			high = middle - 1
		}
	}

	return low
}

function updateWindow(): void {
	const element = scroller.value

	if (!element) {
		return
	}

	const top = element.scrollTop
	const left = element.scrollLeft

	firstRow.value = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN_ROWS)
	lastRow.value = Math.min(rowCount - 1, Math.floor((top + viewHeight) / ROW_HEIGHT) + OVERSCAN_ROWS)
	firstCol.value = Math.max(0, columnAt(left) - OVERSCAN_COLS)
	lastCol.value = Math.min(colCount - 1, columnAt(left + viewWidth) + OVERSCAN_COLS)

	// Written straight to the element: the header moves on every scroll event, and sending that
	// through a render would redo the whole grid for one transform.
	if (header.value) {
		header.value.style.transform = `translateX(${-left}px)`
	}
}

function measure(): void {
	const element = scroller.value

	if (!element) {
		return
	}

	viewWidth = element.clientWidth
	viewHeight = element.clientHeight
	rowPool.value = Math.ceil(viewHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2 + 2
	colPool.value = Math.min(colCount, Math.ceil(viewWidth / narrowest) + OVERSCAN_COLS * 2 + 2)
	updateWindow()
}

const visibleRows = computed(() => span(firstRow.value, lastRow.value))
const visibleCols = computed(() => span(firstCol.value, lastCol.value))

function cellClass(row: number, col: number): string {
	const base = cellClasses[col] ?? ""

	return errorCells.has(row * colCount + col) ? `${base} is-error` : base
}

function bounds(): { top: number; bottom: number; left: number; right: number } {
	return {
		top: Math.min(anchorRow.value, activeRow.value),
		bottom: Math.max(anchorRow.value, activeRow.value),
		left: Math.min(anchorCol.value, activeCol.value),
		right: Math.max(anchorCol.value, activeCol.value)
	}
}

function boxStyle(top: number, bottom: number, left: number, right: number): Record<string, string> {
	const x = offsets[left] ?? 0

	return {
		transform: `translate(${x}px, ${top * ROW_HEIGHT}px)`,
		width: `${(offsets[right + 1] ?? 0) - x}px`,
		height: `${(bottom - top + 1) * ROW_HEIGHT}px`
	}
}

const selectionStyle = computed(() => {
	const { top, bottom, left, right } = bounds()

	return boxStyle(top, bottom, left, right)
})

const activeStyle = computed(() => boxStyle(activeRow.value, activeRow.value, activeCol.value, activeCol.value))

/** Scrolls just far enough for the active cell to be fully on screen. */
function reveal(): void {
	const element = scroller.value

	if (!element) {
		return
	}

	const top = activeRow.value * ROW_HEIGHT
	const left = offsets[activeCol.value] ?? 0
	const right = offsets[activeCol.value + 1] ?? 0

	if (top < element.scrollTop) {
		element.scrollTop = top
	} else if (top + ROW_HEIGHT > element.scrollTop + viewHeight) {
		element.scrollTop = top + ROW_HEIGHT - viewHeight
	}

	if (left < element.scrollLeft) {
		element.scrollLeft = left
	} else if (right > element.scrollLeft + viewWidth) {
		element.scrollLeft = right - viewWidth
	}
}

function move(rows: number, cols: number, extend: boolean): void {
	activeRow.value = clamp(activeRow.value + rows, 0, rowCount - 1)
	activeCol.value = clamp(activeCol.value + cols, 0, colCount - 1)

	if (!extend) {
		anchorRow.value = activeRow.value
		anchorCol.value = activeCol.value
	}

	reveal()
}

function cellFromEvent(event: MouseEvent): { row: number; col: number } | null {
	const element = scroller.value

	if (!element) {
		return null
	}

	const box = element.getBoundingClientRect()

	return {
		row: clamp(Math.floor((event.clientY - box.top + element.scrollTop) / ROW_HEIGHT), 0, rowCount - 1),
		col: columnAt(clamp(event.clientX - box.left + element.scrollLeft, 0, totalWidth - 1))
	}
}

function onDrag(event: MouseEvent): void {
	const cell = cellFromEvent(event)

	if (cell) {
		activeRow.value = cell.row
		activeCol.value = cell.col
	}
}

function onDragEnd(): void {
	window.removeEventListener("mousemove", onDrag)
}

function onMousedown(event: MouseEvent): void {
	// The scroller itself is the target only when the scrollbar was pressed.
	if (event.button !== 0 || event.target === scroller.value || event.target === editor.value) {
		return
	}

	commit()

	const cell = cellFromEvent(event)

	if (!cell) {
		return
	}

	activeRow.value = cell.row
	activeCol.value = cell.col

	if (!event.shiftKey) {
		anchorRow.value = cell.row
		anchorCol.value = cell.col
	}

	window.addEventListener("mousemove", onDrag)
	window.addEventListener("mouseup", onDragEnd, { once: true })
}

function startEdit(seed?: string): void {
	if (columnList[activeCol.value]?.readonly) {
		return
	}

	draft.value = seed ?? sheet[activeRow.value]?.[activeCol.value] ?? ""
	editing.value = true

	void nextTick(() => {
		editor.value?.focus()

		if (seed === undefined) {
			editor.value?.select()
		}
	})
}

function commit(): void {
	if (!editing.value) {
		return
	}

	const row = sheet[activeRow.value]

	if (row) {
		row[activeCol.value] = draft.value
	}

	editing.value = false
	dataVersion.value++
	root.value?.focus()
}

function cancel(): void {
	editing.value = false
	root.value?.focus()
}

function clearSelection(): void {
	const { top, bottom, left, right } = bounds()

	for (let r = top; r <= bottom; r++) {
		const row = sheet[r]

		if (!row) {
			continue
		}

		for (let c = left; c <= right; c++) {
			if (!columnList[c]?.readonly) {
				row[c] = ""
			}
		}
	}

	dataVersion.value++
}

function onKeydown(event: KeyboardEvent): void {
	if (editing.value) {
		return
	}

	const page = Math.max(1, Math.floor(viewHeight / ROW_HEIGHT) - 1)

	switch (event.key) {
		case "ArrowDown":
			move(1, 0, event.shiftKey)
			break
		case "ArrowUp":
			move(-1, 0, event.shiftKey)
			break
		case "ArrowRight":
			move(0, 1, event.shiftKey)
			break
		case "ArrowLeft":
			move(0, -1, event.shiftKey)
			break
		case "Tab":
			move(0, event.shiftKey ? -1 : 1, false)
			break
		case "Enter":
			move(event.shiftKey ? -1 : 1, 0, false)
			break
		case "PageDown":
			move(page, 0, event.shiftKey)
			break
		case "PageUp":
			move(-page, 0, event.shiftKey)
			break
		case "Home":
			move(event.ctrlKey ? -rowCount : 0, -colCount, event.shiftKey)
			break
		case "End":
			move(event.ctrlKey ? rowCount : 0, colCount, event.shiftKey)
			break
		case "F2":
			startEdit()
			break
		case "Delete":
		case "Backspace":
			clearSelection()
			break
		default:
			// A plain character starts an edit and replaces the cell. Anything with Ctrl or Meta is
			// left alone, so the browser still raises its own copy and paste events.
			if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
				return
			}

			startEdit(event.key)
	}

	event.preventDefault()
}

function onEditorKeydown(event: KeyboardEvent): void {
	if (event.key === "Enter") {
		commit()
		move(event.shiftKey ? -1 : 1, 0, false)
		event.preventDefault()
	} else if (event.key === "Tab") {
		commit()
		move(0, event.shiftKey ? -1 : 1, false)
		event.preventDefault()
	} else if (event.key === "Escape") {
		cancel()
	}
}

function onCopy(event: ClipboardEvent): void {
	if (editing.value) {
		return
	}

	const { top, bottom, left, right } = bounds()
	const lines: string[] = []

	for (let r = top; r <= bottom; r++) {
		lines.push((sheet[r] ?? []).slice(left, right + 1).join("\t"))
	}

	event.clipboardData?.setData("text/plain", lines.join("\n"))
	event.preventDefault()
}

/** Tab and line separated text, the way a spreadsheet puts a block on the clipboard. Quoted cells are not handled. */
function onPaste(event: ClipboardEvent): void {
	if (editing.value) {
		return
	}

	const text = event.clipboardData?.getData("text/plain") ?? ""

	if (text === "") {
		return
	}

	const { top, left } = bounds()
	const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n")

	lines.forEach((line, lineIndex) => {
		const row = sheet[top + lineIndex]

		if (!row) {
			return
		}

		line.split("\t").forEach((value, valueIndex) => {
			const col = left + valueIndex

			if (col < colCount && !columnList[col]?.readonly) {
				row[col] = value
			}
		})
	})

	dataVersion.value++
	event.preventDefault()
}

onMounted(() => {
	measure()

	if (scroller.value) {
		resizeObserver = new ResizeObserver(measure)
		resizeObserver.observe(scroller.value)
	}
})

onBeforeUnmount(() => {
	resizeObserver?.disconnect()
	onDragEnd()
})
</script>

<template>
	<div ref="root" class="og" tabindex="0" @keydown="onKeydown" @copy="onCopy" @paste="onPaste">
		<div class="og-head">
			<div ref="header" class="og-head-inner" :style="{ width: `${totalWidth}px` }">
				<div
					v-for="c in visibleCols"
					:key="c % colPool"
					class="og-th"
					:class="{ 'is-numeric': columnList[c]?.numeric }"
					:style="cellStyles[c]"
				>
					{{ columnList[c]?.title }}
				</div>
			</div>
		</div>
		<div
			ref="scroller"
			class="og-body"
			@scroll.passive="updateWindow"
			@mousedown="onMousedown"
			@dblclick="startEdit()"
		>
			<div
				class="og-canvas"
				:data-version="dataVersion"
				:style="{ width: `${totalWidth}px`, height: `${totalHeight}px` }"
			>
				<div
					v-for="r in visibleRows"
					:key="r % rowPool"
					class="og-row"
					:style="{ transform: `translateY(${r * ROW_HEIGHT}px)` }"
				>
					<div
						v-for="c in visibleCols"
						:key="c % colPool"
						class="og-cell"
						:class="cellClass(r, c)"
						:style="cellStyles[c]"
					>
						{{ sheet[r]?.[c] }}
					</div>
				</div>
				<div class="og-selection" :style="selectionStyle" />
				<div class="og-active" :style="activeStyle" />
				<input
					v-if="editing"
					ref="editor"
					v-model="draft"
					class="og-editor"
					:style="activeStyle"
					@keydown.stop="onEditorKeydown"
					@blur="commit"
				/>
			</div>
		</div>
	</div>
</template>

<style>
.og {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	border: 1px solid #d6dae4;
	outline: none;
	background: #ffffff;
	color: #161922;
	font-variant-numeric: tabular-nums;
	user-select: none;
}

.og-head {
	flex: none;
	height: 32px;
	overflow: hidden;
	border-bottom: 1px solid #d6dae4;
	background: #eceef4;
}

.og-head-inner {
	position: relative;
	height: 100%;
}

.og-th {
	position: absolute;
	top: 0;
	box-sizing: border-box;
	height: 32px;
	padding: 0 9px;
	overflow: hidden;
	border-right: 1px solid #d6dae4;
	font-weight: 600;
	line-height: 32px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.og-body {
	position: relative;
	flex: 1;
	min-height: 0;
	overflow: auto;
}

.og-canvas {
	position: relative;
	overflow: hidden;
}

.og-row {
	position: absolute;
	top: 0;
	right: 0;
	left: 0;
	height: 30px;
	contain: layout style;
}

.og-cell {
	position: absolute;
	top: 0;
	box-sizing: border-box;
	height: 30px;
	padding: 0 9px;
	overflow: hidden;
	border-right: 1px solid #e3e6ee;
	border-bottom: 1px solid #e3e6ee;
	line-height: 29px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.og-cell.is-numeric,
.og-th.is-numeric {
	text-align: right;
}

.og-cell.is-readonly {
	background: #f6f7fa;
	color: #586074;
}

.og-cell.is-error {
	background: #fae2e0;
	box-shadow: inset 0 0 0 1.5px #ad2a22;
}

.og-selection,
.og-active {
	position: absolute;
	top: 0;
	left: 0;
	pointer-events: none;
}

.og-selection {
	background: rgb(41 70 201 / 10%);
}

.og-active {
	box-shadow: inset 0 0 0 2px #2946c9;
}

.og-editor {
	position: absolute;
	top: 0;
	left: 0;
	box-sizing: border-box;
	padding: 0 7px;
	border: 2px solid #2946c9;
	outline: none;
	font: inherit;
}
</style>
