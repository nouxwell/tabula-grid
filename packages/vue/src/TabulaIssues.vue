<script setup lang="ts">
import {
	formatCell,
	VALUE_SETTINGS,
	type Issue,
	type IssueSet,
	type ModuleSchema,
	type RowId,
	type RowStore,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { computed, ref, shallowRef, toRaw, watch, type PropType } from "vue"
import { issueText, PANEL_TEXT, type GridLocale } from "./messages.js"
import ScrollThumbs from "./ScrollThumbs.vue"
import type { GridTheme } from "./types.js"

/**
 * The list of a sheet's issues: how many there are, what each says, and where. Choosing one emits
 * `select`; the host hands it to the grid's `goTo()`, so the panel can sit anywhere on the page.
 */
const props = defineProps({
	/** A `SheetValidator`, or a `SheetSession`'s `issues`: the same the grid is given. */
	issues: { type: Object as PropType<IssueSet>, required: true },
	schema: { type: Object as PropType<ModuleSchema>, required: true },
	/** For the row numbers shown, which follow the rows as they stand now. */
	store: { type: Object as PropType<RowStore>, required: true },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	valueSettings: { type: Object as PropType<ValueSettings>, default: () => VALUE_SETTINGS.tr },
	theme: { type: String as PropType<GridTheme>, default: "light" },
	/** How many issues are listed; the rest are counted. Drawing 50,000 of them helps nobody. */
	limit: { type: Number, default: 500 },
	/**
	 * `panel`: the list beside or under the sheet. `sheet`, for a phone: a bar with the counts, which
	 * opens the list from the bottom of the screen over the sheet; choosing an issue closes it again.
	 */
	variant: { type: String as PropType<"panel" | "sheet">, default: "panel" },
	/** The grid's `addressOf`: each issue on a cell then shows the cell's address, "D8". */
	addressOf: {
		type: Function as PropType<(rowId: RowId, field: string) => string | null>,
		default: undefined
	},
	/** A field that names a row, such as its product, shown on each issue about the row. */
	nameField: { type: String as PropType<string | null>, default: null },
	/**
	 * A close button in the `panel` variant's head too, as the `sheet` variant has. It emits `close`,
	 * for a host that shows the panel only while it is wanted.
	 */
	closable: { type: Boolean, default: false },
	/**
	 * The `sheet` variant's bar with the counts. A host that shows the state elsewhere, such as an
	 * icon by its own buttons, turns it off and opens the list with `v-model:open`.
	 */
	bar: { type: Boolean, default: true },
	/**
	 * Whether the `sheet` variant covers the page while open. Off, it takes the lower part of the
	 * screen only (`--tabula-issues-sheet-height`), with nothing over the rest, and stays open when an
	 * issue is chosen: the host keeps its sheet above it, where the cell then shows.
	 */
	modal: { type: Boolean, default: true }
})

const emit = defineEmits<{
	select: [issue: Issue]
	refreshRows: []
	/** The close button was pressed: the `sheet` variant's, or a `closable` panel's. */
	close: []
}>()

/**
 * Whether only the rows with issues are shown. Bound with `v-model:only-issue-rows`, it puts a switch
 * in the panel's head, and a button that emits `refresh-rows` while it is on; the host filters its
 * `RowView` by them. Left unbound, there is no switch.
 */
const onlyIssueRows = defineModel<boolean>("onlyIssueRows")

/** Whether the `sheet` variant's list is open. Bind it with `v-model:open` to open it from elsewhere. */
const open = defineModel<boolean>("open", { default: false })

const sheet = computed(() => props.variant === "sheet")

function close(): void {
	open.value = false
	emit("close")
}

const version = shallowRef(0)
/** The issue chosen last, so Previous and Next have somewhere to start. */
const current = shallowRef<string | null>(null)

watch(
	() => toRaw(props.issues),
	(set, _previous, onCleanup) => {
		version.value++
		onCleanup(set.subscribe(() => version.value++))
	},
	{ immediate: true }
)

// Each reads the version itself. A computed handing back the issue set would not do: it is the same
// object every time, and Vue does not wake what depends on a value that did not change.
const issues = computed(() => {
	void version.value

	return toRaw(props.issues).issues()
})

const summary = computed(() => {
	void version.value

	return toRaw(props.issues).summary()
})
/** Which issues are listed: all of them, or the errors or the warnings only. */
const kind = shallowRef<"all" | "error" | "warning">("all")

/** The issues of the kind chosen; the arrows walk these. */
const listed = computed(() =>
	kind.value === "all" ? issues.value : issues.value.filter(issue => issue.severity === kind.value)
)

const shown = computed(() => listed.value.slice(0, props.limit))
const text = computed(() => PANEL_TEXT[props.locale])

/** The filters over the list, each with how many it would show. */
const kinds = computed(() => {
	const counts = summary.value

	return [
		{ value: "all", label: text.value.all, count: issues.value.length },
		{ value: "error", label: text.value.error, count: counts.errors },
		{ value: "warning", label: text.value.warning, count: counts.warnings }
	] as const
})

function count(value: number): string {
	return value.toLocaleString(props.locale === "tr" ? "tr-TR" : "en-US")
}
/** The list of issues, for the scroll bar drawn over its edge. */
const list = ref<HTMLElement | null>(null)

/** Where the issue is: the sheet, a row, or a row and a column. */
function label(issue: Issue): string {
	if (issue.rowId === null) {
		return text.value.sheet ?? ""
	}

	const store = toRaw(props.store)
	const schema = toRaw(props.schema)
	const row = `${text.value.row} ${store.indexOf(issue.rowId) + 1}`
	const field = issue.field !== null && schema.has(issue.field) ? schema.field(issue.field).label : ""

	return [row, field].filter(Boolean).join(" · ")
}

/** The cell's address, "D8", when the host gave the grid's way to tell it. */
function address(issue: Issue): string | null {
	return issue.rowId !== null && issue.field !== null && props.addressOf
		? props.addressOf(issue.rowId, issue.field)
		: null
}

/** What the row is called, by the field the host named. */
function rowName(issue: Issue): string {
	const schema = toRaw(props.schema)

	if (issue.rowId === null || props.nameField === null || !schema.has(props.nameField)) {
		return ""
	}

	const value = toRaw(props.store).get(issue.rowId, props.nameField)

	return formatCell(schema.field(props.nameField), value, props.valueSettings)
}

function itemClass(issue: Issue): string[] {
	return [issue.stale ? "is-stale" : `is-${issue.severity}`, issue.id === current.value ? "is-current" : ""]
}

/** Who found it: the browser's own checks, or the application's server. */
function source(issue: Issue): string {
	return issue.source === "local" ? (text.value.local ?? "") : (text.value.server ?? "")
}

/** The counts in one line, for the `sheet` variant's bar. */
const barText = computed(() => {
	const counts = summary.value
	const parts = [
		counts.errors > 0 ? `${counts.errors} ${text.value.errors}` : "",
		counts.warnings > 0 ? `${counts.warnings} ${text.value.warnings}` : "",
		counts.stale > 0 ? `${counts.stale} ${text.value.stale}` : ""
	].filter(Boolean)

	return parts.length > 0 ? parts.join(" · ") : (text.value.none ?? "")
})

const barClass = computed(() => {
	const counts = summary.value

	return counts.errors > 0
		? "is-error"
		: counts.warnings > 0
			? "is-warning"
			: counts.stale > 0
				? "is-stale"
				: "is-clear"
})

function choose(issue: Issue): void {
	current.value = issue.id

	// On a phone a list covering the sheet steps aside for the cell it was chosen for; one that
	// leaves the sheet in view above it stays.
	if (props.modal) {
		open.value = false
	}

	emit("select", issue)
}

/** Walks the list shown, wrapping round at either end. */
function step(by: number): void {
	const list = listed.value

	if (list.length === 0) {
		return
	}

	const at = list.findIndex(issue => issue.id === current.value)
	const next = at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length
	const issue = list[next]

	if (issue) {
		choose(issue)
	}
}

defineExpose({ next: () => step(1), previous: () => step(-1) })
</script>

<template>
	<section
		class="tabula-issues tabula-theme"
		:class="{ 'is-sheet': sheet, 'is-open': sheet && open, 'is-half': sheet && !modal }"
		:data-tabula-theme="theme"
		:aria-label="text.title"
	>
		<button
			v-if="sheet && bar"
			type="button"
			class="tabula-issues-bar"
			:class="barClass"
			:aria-expanded="open"
			:aria-label="`${text.open}: ${barText}`"
			@click="open = true"
		>
			<span class="tabula-issues-dot" aria-hidden="true" />
			<span>{{ barText }}</span>
			<svg class="tabula-issues-chevron" viewBox="0 0 24 24" aria-hidden="true">
				<path d="m6 15 6-6 6 6" />
			</svg>
		</button>
		<Transition name="tabula-issues-fade">
			<div v-if="sheet && modal && open" class="tabula-issues-scrim" aria-hidden="true" @click="open = false" />
		</Transition>
		<Transition :name="sheet ? 'tabula-issues-rise' : ''">
			<div
				v-if="!sheet || open"
				class="tabula-issues-body"
				:role="sheet ? 'dialog' : undefined"
				:aria-modal="sheet ? modal : undefined"
				:aria-label="sheet ? text.title : undefined"
			>
				<span v-if="sheet" class="tabula-issues-handle" aria-hidden="true" />
				<header class="tabula-issues-head">
					<div class="tabula-issues-titles">
						<strong class="tabula-issues-title">{{ text.title }}</strong>
						<span v-if="issues.length > 0" class="tabula-issues-total">{{ count(issues.length) }}</span>
						<span v-if="summary.rows > 0" class="tabula-issues-rows">
							{{ count(summary.rows) }} {{ text.rows }}
						</span>
						<span class="tabula-issues-nav">
							<button
								type="button"
								class="tabula-issues-icon"
								:disabled="listed.length === 0"
								:aria-label="text.previous"
								:title="text.previous"
								@click="step(-1)"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
							</button>
							<button
								type="button"
								class="tabula-issues-icon"
								:disabled="listed.length === 0"
								:aria-label="text.next"
								:title="text.next"
								@click="step(1)"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
							</button>
							<button
								v-if="sheet || closable"
								type="button"
								class="tabula-issues-icon tabula-issues-close"
								:aria-label="text.close"
								:title="text.close"
								@click="close"
							>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
							</button>
						</span>
					</div>
					<div v-if="issues.length > 0" class="tabula-issues-counts" role="group" :aria-label="text.show">
						<button
							v-for="item in kinds"
							:key="item.value"
							type="button"
							class="tabula-issues-count"
							:class="[`is-${item.value}`, { 'is-on': kind === item.value }]"
							:aria-pressed="kind === item.value"
							@click="kind = item.value"
						>
							{{ item.label }}
							<span class="tabula-issues-count-n">{{ count(item.count) }}</span>
						</button>
						<span v-if="summary.stale > 0" class="tabula-issues-count is-stale">
							{{ count(summary.stale) }} {{ text.stale }}
						</span>
					</div>
					<div v-if="onlyIssueRows !== undefined" class="tabula-issues-filter">
						<label class="tabula-issues-switch">
							<input v-model="onlyIssueRows" type="checkbox" role="switch" />
							{{ text.onlyIssueRows }}
						</label>
						<Transition name="tabula-issues-fade">
							<button
								v-if="onlyIssueRows"
								type="button"
								class="tabula-issues-refresh"
								:title="text.refreshHint"
								@click="emit('refreshRows')"
							>
								{{ text.refresh }}
							</button>
						</Transition>
					</div>
				</header>
				<p v-if="issues.length === 0" class="tabula-issues-none">{{ text.none }}</p>
				<p v-else-if="listed.length === 0" class="tabula-issues-none">{{ text.noneOfKind }}</p>
				<ul v-else ref="list" class="tabula-issues-list tabula-scroll">
					<li v-for="issue in shown" :key="issue.id">
						<button
							type="button"
							class="tabula-issues-item"
							:class="itemClass(issue)"
							:aria-current="issue.id === current ? 'true' : undefined"
							@click="choose(issue)"
						>
							<span class="tabula-issues-dot" aria-hidden="true" />
							<span class="tabula-issues-content">
								<span class="tabula-issues-line">
									<span class="tabula-issues-where">{{ label(issue) }}</span>
									<span v-if="address(issue)" class="tabula-issues-address" v-text="address(issue)" />
									<span class="tabula-issues-source">{{ source(issue) }}</span>
								</span>
								<span v-if="rowName(issue)" class="tabula-issues-name" v-text="rowName(issue)" />
								<span class="tabula-issues-text">{{ issueText(issue, locale, valueSettings) }}</span>
								<span v-if="issue.stale" class="tabula-issues-recheck">{{ text.recheck }}</span>
							</span>
						</button>
					</li>
					<li v-if="listed.length > shown.length" class="tabula-issues-more">
						+{{ count(listed.length - shown.length) }} {{ text.more }}
					</li>
				</ul>
				<ScrollThumbs v-if="listed.length > 0" :target="list" />
				<div v-if="$slots.actions" class="tabula-issues-actions"><slot name="actions" /></div>
			</div>
		</Transition>
	</section>
</template>

<style src="./theme.css"></style>

<style>
/* The colours are in theme.css, shared with the grid. */
.tabula-issues {
	--tabula-issues-sheet-height: min(52vh, 460px);

	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	min-height: 0;
	border: 1px solid var(--tabula-issues-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-issues-bg);
	color: var(--tabula-issues-fg);
	line-height: 1.4;
}

.tabula-issues-body {
	position: relative;
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

.tabula-issues-head {
	display: flex;
	flex: none;
	flex-direction: column;
	gap: 10px;
	padding: 10px 8px 12px 14px;
	border-bottom: 1px solid var(--tabula-line);
}

.tabula-issues-titles {
	display: flex;
	gap: 8px;
	align-items: center;
	min-height: 28px;
}

.tabula-issues-title {
	font-size: 1.1em;
	font-weight: 600;
}

/* How many there are, in a small round badge: red while any is an error. */
.tabula-issues-total {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	min-width: 20px;
	height: 20px;
	padding: 0 6px;
	border-radius: 10px;
	background: var(--tabula-error-bg);
	color: var(--tabula-issues-error);
	font-size: 0.85em;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.tabula-issues-rows {
	color: var(--tabula-issues-muted);
	font-size: 0.92em;
	white-space: nowrap;
}

.tabula-issues-nav {
	display: flex;
	gap: 2px;
	align-items: center;
	margin-left: auto;
}

/* The arrows and the close button: icons only, no edge until the pointer is on them. */
.tabula-issues-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 30px;
	height: 30px;
	padding: 0;
	border: 0;
	border-radius: var(--tabula-radius);
	background: transparent;
	color: var(--tabula-issues-fg);
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.tabula-issues-icon:hover:not(:disabled) {
	background: var(--tabula-issues-hover);
}

.tabula-issues-icon:disabled {
	color: var(--tabula-issues-muted);
	opacity: 0.6;
	cursor: default;
}

.tabula-issues-icon svg,
.tabula-issues-chevron {
	width: 18px;
	height: 18px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
}

/* Which issues are listed: all, the errors, the warnings; each with its count. */
.tabula-issues-counts {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
}

.tabula-issues-count {
	display: inline-flex;
	gap: 6px;
	align-items: center;
	box-sizing: border-box;
	height: 26px;
	padding: 0 10px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: 999px;
	background: transparent;
	color: var(--tabula-issues-muted);
	font: inherit;
	font-size: 0.92em;
	white-space: nowrap;
	cursor: pointer;
	transition:
		background-color 0.15s ease,
		color 0.15s ease,
		border-color 0.15s ease;
}

.tabula-issues-count:hover {
	color: var(--tabula-issues-fg);
}

.tabula-issues-count.is-on {
	border-color: transparent;
	background: var(--tabula-issues-current);
	color: var(--tabula-issues-fg);
	font-weight: 600;
}

.tabula-issues-count-n {
	font-variant-numeric: tabular-nums;
}

.tabula-issues-count.is-error .tabula-issues-count-n {
	color: var(--tabula-issues-error);
	font-weight: 600;
}

.tabula-issues-count.is-warning .tabula-issues-count-n {
	color: var(--tabula-issues-warning);
	font-weight: 600;
}

.tabula-issues-count.is-stale {
	border-style: dashed;
	cursor: default;
}

/* Only the rows with issues in the sheet: a switch, and Yenile while it is on. */
.tabula-issues-filter {
	display: flex;
	gap: 8px;
	align-items: center;
	min-height: 28px;
}

.tabula-issues-switch {
	display: inline-flex;
	gap: 8px;
	align-items: center;
	color: var(--tabula-issues-muted);
	font-size: 0.92em;
	cursor: pointer;
}

/* The checkbox itself, drawn as a switch: a track and a knob that slides. */
.tabula-issues-switch input {
	position: relative;
	flex: none;
	width: 28px;
	height: 16px;
	margin: 0;
	border-radius: 8px;
	background: var(--tabula-head-line);
	cursor: pointer;
	appearance: none;
	transition: background-color 0.15s ease;
}

.tabula-issues-switch input::after {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: var(--tabula-bg);
	box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
	content: "";
	transition: transform 0.15s ease;
}

.tabula-issues-switch input:checked {
	background: var(--tabula-accent);
}

.tabula-issues-switch input:checked::after {
	transform: translateX(12px);
}

.tabula-issues-switch input:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: 2px;
}

.tabula-issues-refresh {
	margin-left: auto;
	padding: 2px 8px;
	border: 0;
	border-radius: var(--tabula-radius);
	background: transparent;
	color: var(--tabula-accent-text);
	font: inherit;
	font-size: 0.92em;
	font-weight: 600;
	cursor: pointer;
}

.tabula-issues-refresh:hover {
	background: var(--tabula-issues-hover);
}

.tabula-issues-none {
	margin: 0;
	padding: 14px;
	color: var(--tabula-issues-muted);
}

.tabula-issues-list {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 2px;
	min-height: 0;
	margin: 0;
	padding: 6px;
	overflow: auto;
	list-style: none;
}

/* An issue: a row of the list, the whole of it pressed to go to the cell. */
.tabula-issues-item {
	display: flex;
	gap: 10px;
	align-items: flex-start;
	box-sizing: border-box;
	width: 100%;
	padding: 10px;
	border: 0;
	border-radius: var(--tabula-radius);
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.15s ease;
}

.tabula-issues-item:hover {
	background: var(--tabula-issues-hover);
}

.tabula-issues-item.is-current {
	background: var(--tabula-issues-current);
}

.tabula-issues-item:focus-visible,
.tabula-issues-icon:focus-visible,
.tabula-issues-count:focus-visible,
.tabula-issues-refresh:focus-visible,
.tabula-issues-bar:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: -2px;
}

.tabula-issues-dot {
	flex: none;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--tabula-error-mark);
}

.tabula-issues-item > .tabula-issues-dot {
	margin-top: 6px;
}

.is-warning > .tabula-issues-dot {
	background: var(--tabula-warning-mark);
}

.is-stale > .tabula-issues-dot {
	background: var(--tabula-stale-mark);
}

.is-clear > .tabula-issues-dot {
	background: var(--tabula-success-mark);
}

.tabula-issues-content {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
}

.tabula-issues-line {
	display: flex;
	gap: 8px;
	align-items: baseline;
	min-width: 0;
}

.tabula-issues-where {
	overflow: hidden;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-issues-address {
	flex: none;
	color: var(--tabula-issues-muted);
	font-size: 0.92em;
	font-variant-numeric: tabular-nums;
}

.tabula-issues-source {
	flex: none;
	margin-left: auto;
	color: var(--tabula-issues-muted);
	font-size: 0.85em;
	white-space: nowrap;
}

.tabula-issues-name {
	overflow: hidden;
	color: var(--tabula-issues-muted);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-issues-item.is-stale .tabula-issues-text,
.tabula-issues-recheck {
	color: var(--tabula-issues-muted);
}

.tabula-issues-recheck {
	font-size: 0.9em;
}

.tabula-issues-more {
	padding: 8px 10px;
	color: var(--tabula-issues-muted);
}

/* What the host puts under the list: a line of its own takes the width, buttons go under it. */
.tabula-issues-actions {
	display: flex;
	flex: none;
	flex-wrap: wrap;
	gap: 8px;
	padding: 12px 14px 14px;
	border-top: 1px solid var(--tabula-line);
}

/* A phone: a bar with the counts, and the list as a sheet from the bottom of the screen. */
.tabula-issues.is-sheet {
	height: auto;
	border: 0;
	background: transparent;
}

.tabula-issues-bar {
	display: flex;
	gap: 10px;
	align-items: center;
	box-sizing: border-box;
	width: 100%;
	min-height: 48px;
	padding: 0 14px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-issues-bg);
	color: var(--tabula-issues-fg);
	font: inherit;
	font-weight: 600;
	text-align: left;
	cursor: pointer;
}

.tabula-issues-bar.is-error {
	color: var(--tabula-issues-error);
}

.tabula-issues-bar.is-warning {
	color: var(--tabula-issues-warning);
}

.tabula-issues-chevron {
	margin-left: auto;
}

.tabula-issues-scrim {
	position: fixed;
	z-index: 1000;
	inset: 0;
	background: rgb(0 0 0 / 35%);
}

.tabula-issues.is-sheet .tabula-issues-body {
	position: fixed;
	z-index: 1001;
	right: 0;
	bottom: 0;
	left: 0;
	max-height: 78vh;
	border-top: 1px solid var(--tabula-issues-line);
	border-radius: 16px 16px 0 0;
	background: var(--tabula-issues-bg);
	box-shadow: 0 -12px 30px rgb(0 0 0 / 25%);
}

/* The lower part of the screen only: the sheet above stays in view and in reach. */
.tabula-issues.is-half .tabula-issues-body {
	height: var(--tabula-issues-sheet-height);
	max-height: none;
	box-shadow: 0 -8px 24px rgb(0 0 0 / 16%);
}

.tabula-issues-handle {
	flex: none;
	align-self: center;
	width: 44px;
	height: 5px;
	margin-top: 8px;
	border-radius: 3px;
	background: var(--tabula-issues-line);
}

.tabula-issues.is-sheet .tabula-issues-head {
	padding: 8px 8px 12px 16px;
}

.tabula-issues.is-sheet .tabula-issues-icon {
	width: 44px;
	height: 44px;
}

.tabula-issues.is-sheet .tabula-issues-item {
	min-height: 44px;
	padding: 12px 10px;
}

.tabula-issues.is-sheet .tabula-issues-count {
	height: 32px;
}

.tabula-issues.is-sheet .tabula-issues-actions {
	padding: 12px 16px 16px;
}

/* Coming and going: the scrim fades, a sheet rises from the bottom. */
.tabula-issues-fade-enter-active,
.tabula-issues-fade-leave-active {
	transition: opacity 0.2s ease-out;
}

.tabula-issues-fade-enter-from,
.tabula-issues-fade-leave-to {
	opacity: 0;
}

.tabula-issues-rise-enter-active,
.tabula-issues-rise-leave-active {
	transition: transform 0.25s ease-out;
}

.tabula-issues-rise-enter-from,
.tabula-issues-rise-leave-to {
	transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
	.tabula-issues-icon,
	.tabula-issues-count,
	.tabula-issues-item,
	.tabula-issues-switch input,
	.tabula-issues-switch input::after,
	.tabula-issues-fade-enter-active,
	.tabula-issues-fade-leave-active,
	.tabula-issues-rise-enter-active,
	.tabula-issues-rise-leave-active {
		transition: none;
	}
}
</style>
