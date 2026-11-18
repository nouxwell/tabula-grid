<script setup lang="ts">
import {
	findCells,
	replaceCells,
	VALUE_SETTINGS,
	type FoundCell,
	type ModuleSchema,
	type RowStore,
	type RowView,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, toRaw, watch, type PropType } from "vue"
import { FIND_TEXT, type GridLocale } from "./messages.js"
import type TabulaGrid from "./TabulaGrid.vue"
import type { GridTheme } from "./types.js"

/**
 * Find and replace over a sheet, as a strip above it: what Ctrl+H opens in a spreadsheet. Text is
 * looked for in the cells as they show it, among the cells selected, in the active cell's column or
 * in the whole sheet. Bind `found` to the grid's `found` and the cells are tinted there; Enter goes
 * to the next, Shift+Enter to the one before. A replacement is written as typing it would be, and
 * every cell of "Replace all" in one step: one Ctrl+Z takes it back. A column that cannot be typed
 * into, or a row a run has locked, is left as it is.
 */
const props = defineProps({
	/** The grid it works on: its template ref. */
	grid: { type: Object as PropType<InstanceType<typeof TabulaGrid> | null>, default: null },
	store: { type: Object as PropType<RowStore>, required: true },
	schema: { type: Object as PropType<ModuleSchema>, required: true },
	/** The rows looked through, in their order: the grid's `view`. Left out, every row of the store. */
	view: { type: Object as PropType<RowView>, default: undefined },
	valueSettings: { type: Object as PropType<ValueSettings>, default: () => VALUE_SETTINGS.tr },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	theme: { type: String as PropType<GridTheme>, default: "light" }
})

const emit = defineEmits<{
	/** Cells were replaced: how many, and how many were left because they cannot be written. */
	replaced: [count: number, skipped: number]
}>()

/** Whether the strip is shown. Closing it takes the tint off the cells found. */
const open = defineModel<boolean>("open", { default: false })

/** The cells found and the one gone to: bind it to the grid's `found`. */
const found = defineModel<{ readonly cells: readonly FoundCell[]; readonly current: FoundCell | null } | null>(
	"found",
	{ default: null }
)

type Scope = "selection" | "column" | "sheet"

const SEARCH_DELAY = 120

const text = computed(() => FIND_TEXT[props.locale])
const query = ref("")
const replacement = ref("")
const scope = ref<Scope>("sheet")
const matchCase = ref(false)
const whole = ref(false)
const index = ref(0)
const cells = shallowRef<readonly FoundCell[]>([])
const note = ref<string | null>(null)
/** The cells selected when the strip opened: where "In the selection" looks. */
const selected = shallowRef<readonly FoundCell[]>([])
/** The active cell's column when the strip opened: where "In the column" looks. */
const column = ref<string | null>(null)
const findInput = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let stopStore: (() => void) | null = null

const columnLabel = computed(() =>
	column.value && props.schema.has(column.value) ? props.schema.field(column.value).label : null
)
const countText = computed(() => {
	if (query.value === "") {
		return ""
	}

	return cells.value.length === 0
		? text.value.none
		: (text.value.count ?? "")
				.replace("{current}", String(index.value + 1))
				.replace("{total}", String(cells.value.length))
})

function cellKey(cell: FoundCell): string {
	return JSON.stringify([cell.rowId, cell.field])
}

function options() {
	return {
		settings: props.valueSettings,
		matchCase: matchCase.value,
		whole: whole.value,
		locale: props.locale === "tr" ? "tr-TR" : "en"
	}
}

/** Looks again, now: after a change to what is looked for, or to the rows. */
function search(): void {
	const store = toRaw(props.store)
	const schema = toRaw(props.schema)
	const view = toRaw(props.view)
	const rows = view
		? Array.from({ length: view.size }, (_, at) => view.rowIdAt(at)).filter((id): id is string => id !== undefined)
		: store.rowIds()
	const shown = props.grid?.shownFields() ?? schema.keys()
	let list: FoundCell[]

	if (scope.value === "selection") {
		const keep = new Set(selected.value.map(cellKey))
		const rowIds = new Set(selected.value.map(cell => cell.rowId))
		const fields = new Set(selected.value.map(cell => cell.field))

		list = findCells(
			store,
			schema,
			rows.filter(rowId => rowIds.has(rowId)),
			shown.filter(key => fields.has(key)),
			query.value,
			options()
		).filter(cell => keep.has(cellKey(cell)))
	} else {
		const fields = scope.value === "column" ? (column.value ? [column.value] : []) : shown

		list = findCells(store, schema, rows, fields, query.value, options())
	}

	cells.value = list
	index.value = Math.min(index.value, Math.max(0, list.length - 1))
	publish()
}

function later(): void {
	if (timer !== null) {
		clearTimeout(timer)
	}

	timer = setTimeout(() => {
		timer = null
		search()
	}, SEARCH_DELAY)
}

function publish(): void {
	found.value =
		open.value && query.value !== "" ? { cells: cells.value, current: cells.value[index.value] ?? null } : null
}

/** The next cell found, or the one before; round from the last to the first. */
function go(by: 1 | -1): void {
	const count = cells.value.length

	if (count === 0) {
		return
	}

	index.value = (index.value + by + count) % count
	publish()
	show()
}

function show(): void {
	const cell = cells.value[index.value]

	if (cell) {
		props.grid?.showCell(cell.rowId, cell.field)
	}
}

function replace(list: readonly FoundCell[]): void {
	const result = replaceCells(toRaw(props.store), toRaw(props.schema), list, query.value, replacement.value, {
		...options(),
		editable: (rowId, field) => props.grid?.canEdit(rowId, field) ?? true
	})

	note.value =
		result.skipped > 0
			? `${(text.value.replaced ?? "").replace("{n}", String(result.replaced))} · ${(text.value.skipped ?? "").replace("{n}", String(result.skipped))}`
			: (text.value.replaced ?? "").replace("{n}", String(result.replaced))
	emit("replaced", result.replaced, result.skipped)
	search()
}

/** Replaces the cell gone to, and goes to the next. */
function replaceOne(): void {
	const cell = cells.value[index.value]

	if (cell) {
		replace([cell])
		show()
	}
}

function replaceAll(): void {
	replace(cells.value)
}

function close(): void {
	open.value = false
	props.grid?.focus()
}

function onFindKeydown(event: KeyboardEvent): void {
	if (event.key === "Enter") {
		event.preventDefault()
		go(event.shiftKey ? -1 : 1)
	} else if (event.key === "Escape") {
		event.preventDefault()
		close()
	}
}

function onReplaceKeydown(event: KeyboardEvent): void {
	if (event.key === "Enter") {
		event.preventDefault()
		replaceOne()
	} else if (event.key === "Escape") {
		event.preventDefault()
		close()
	}
}

watch(query, () => {
	index.value = 0
	note.value = null
	later()
})
watch([scope, matchCase, whole], () => {
	index.value = 0
	search()
})

watch(
	open,
	isOpen => {
		stopStore?.()
		stopStore = null

		if (!isOpen) {
			found.value = null
			note.value = null

			return
		}

		// Where it looks is taken as the strip opens: going to a cell found moves the selection.
		selected.value = props.grid?.selectedCells() ?? []
		column.value = props.grid?.selectedFields()[0] ?? null
		scope.value = selected.value.length > 1 ? "selection" : "sheet"
		stopStore = toRaw(props.store).subscribe(() => later())
		search()
		void nextTick(() => {
			findInput.value?.focus()
			findInput.value?.select()
		})
	},
	{ immediate: true }
)

onBeforeUnmount(() => {
	stopStore?.()

	if (timer !== null) {
		clearTimeout(timer)
	}
})
</script>

<template>
	<div v-if="open" class="tabula-find tabula-theme" :data-tabula-theme="theme" role="search" :aria-label="text.title">
		<label class="tabula-find-field">
			<span>{{ text.find }}</span>
			<input ref="findInput" v-model="query" type="text" spellcheck="false" @keydown="onFindKeydown" />
		</label>
		<label class="tabula-find-field">
			<span>{{ text.replace }}</span>
			<input v-model="replacement" type="text" spellcheck="false" @keydown="onReplaceKeydown" />
		</label>
		<span class="tabula-find-scope" role="group" :aria-label="text.where">
			<button
				type="button"
				:aria-pressed="scope === 'selection'"
				:disabled="selected.length < 2"
				@click="scope = 'selection'"
			>
				{{ text.selection }}
			</button>
			<button type="button" :aria-pressed="scope === 'column'" :disabled="!column" @click="scope = 'column'">
				{{ columnLabel ? `${text.column}: ${columnLabel}` : text.column }}
			</button>
			<button type="button" :aria-pressed="scope === 'sheet'" @click="scope = 'sheet'">{{ text.sheet }}</button>
		</span>
		<button
			type="button"
			class="tabula-find-toggle"
			:aria-pressed="matchCase"
			:title="text.matchCase"
			:aria-label="text.matchCase"
			@click="matchCase = !matchCase"
		>
			Aa
		</button>
		<button
			type="button"
			class="tabula-find-toggle"
			:aria-pressed="whole"
			:title="text.whole"
			@click="whole = !whole"
		>
			{{ text.wholeShort }}
		</button>
		<span class="tabula-find-count" role="status">{{ countText }}</span>
		<button
			type="button"
			class="tabula-find-icon"
			:aria-label="text.previous"
			:disabled="cells.length === 0"
			@click="go(-1)"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
		</button>
		<button
			type="button"
			class="tabula-find-icon"
			:aria-label="text.next"
			:disabled="cells.length === 0"
			@click="go(1)"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
		</button>
		<span class="tabula-find-actions">
			<span v-if="note" class="tabula-find-note" role="status">{{ note }}</span>
			<button type="button" class="tabula-find-button" :disabled="cells.length === 0" @click="replaceOne">
				{{ text.replaceOne }}
			</button>
			<button
				type="button"
				class="tabula-find-button is-primary"
				:disabled="cells.length === 0"
				@click="replaceAll"
			>
				{{ text.replaceAll }}
			</button>
			<button type="button" class="tabula-find-icon" :aria-label="text.close" @click="close">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
			</button>
		</span>
	</div>
</template>

<style src="./theme.css"></style>

<style>
.tabula-find {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
	min-width: 0;
	background: var(--tabula-bg-alt);
	color: var(--tabula-fg);
	font-size: var(--tabula-font-size);
}

.tabula-find-field {
	display: flex;
	gap: 8px;
	align-items: center;
	box-sizing: border-box;
	height: 32px;
	padding: 0 10px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	color: var(--tabula-muted);
	font-size: 0.92em;
}

.tabula-find-field:focus-within {
	border-color: var(--tabula-accent);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--tabula-accent) 20%, transparent);
}

.tabula-find-field input {
	width: 160px;
	min-width: 0;
	padding: 0;
	border: 0;
	outline: none;
	background: transparent;
	color: var(--tabula-fg);
	font: inherit;
	font-size: calc(1em / 0.92);
}

.tabula-find-scope {
	display: inline-flex;
	overflow: hidden;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
}

.tabula-find-scope button,
.tabula-find-toggle,
.tabula-find-button,
.tabula-find-icon {
	box-sizing: border-box;
	height: 30px;
	padding: 0 10px;
	border: 0;
	background: transparent;
	color: var(--tabula-fg);
	font: inherit;
	white-space: nowrap;
	cursor: pointer;
}

.tabula-find-scope button + button {
	border-left: 1px solid var(--tabula-head-line);
}

.tabula-find-scope button[aria-pressed="true"],
.tabula-find-toggle[aria-pressed="true"] {
	background: color-mix(in srgb, var(--tabula-accent) 12%, var(--tabula-bg));
	color: var(--tabula-accent-text);
	font-weight: 600;
}

.tabula-find-toggle,
.tabula-find-button,
.tabula-find-icon {
	height: 32px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
}

.tabula-find-toggle[aria-pressed="true"] {
	border-color: var(--tabula-accent);
}

.tabula-find-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	padding: 0;
}

.tabula-find-icon svg {
	width: 16px;
	height: 16px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.tabula-find-button.is-primary {
	border-color: var(--tabula-accent-text);
	background: var(--tabula-accent-text);
	color: var(--tabula-bg);
	font-weight: 600;
}

.tabula-find :is(button):disabled {
	opacity: 0.5;
	cursor: default;
}

.tabula-find-count,
.tabula-find-note {
	color: var(--tabula-muted);
	white-space: nowrap;
}

.tabula-find-actions {
	display: flex;
	gap: 8px;
	align-items: center;
	margin-left: auto;
}
</style>
