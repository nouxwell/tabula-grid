<script setup lang="ts">
import {
	VALUE_SETTINGS,
	type Issue,
	type IssueSet,
	type ModuleSchema,
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
	variant: { type: String as PropType<"panel" | "sheet">, default: "panel" }
})

const emit = defineEmits<{ select: [issue: Issue]; refreshRows: [] }>()

/**
 * Whether only the rows with issues are shown. Bound with `v-model:only-issue-rows`, it puts a switch
 * in the panel's head, and a button that emits `refresh-rows` while it is on; the host filters its
 * `RowView` by them. Left unbound, there is no switch.
 */
const onlyIssueRows = defineModel<boolean>("onlyIssueRows")

/** Whether the `sheet` variant's list is open. Bind it with `v-model:open` to open it from elsewhere. */
const open = defineModel<boolean>("open", { default: false })

const sheet = computed(() => props.variant === "sheet")

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
const shown = computed(() => issues.value.slice(0, props.limit))
const text = computed(() => PANEL_TEXT[props.locale])
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
	// On a phone the list covers the sheet: it steps aside for the cell it was chosen for.
	open.value = false
	emit("select", issue)
}

/** Walks the list, wrapping round at either end. */
function step(by: number): void {
	const list = issues.value

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
		:class="{ 'is-sheet': sheet, 'is-open': sheet && open }"
		:data-tabula-theme="theme"
		:aria-label="text.title"
	>
		<button
			v-if="sheet"
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
		<div v-if="sheet && open" class="tabula-issues-scrim" aria-hidden="true" @click="open = false" />
		<div
			v-if="!sheet || open"
			class="tabula-issues-body"
			:role="sheet ? 'dialog' : undefined"
			:aria-modal="sheet ? 'true' : undefined"
			:aria-label="sheet ? text.title : undefined"
		>
			<span v-if="sheet" class="tabula-issues-handle" aria-hidden="true" />
			<header class="tabula-issues-head">
				<div class="tabula-issues-titles">
					<strong class="tabula-issues-title">{{ text.title }}</strong>
					<span class="tabula-issues-nav">
						<button type="button" :disabled="issues.length === 0" @click="step(-1)">
							{{ text.previous }}
						</button>
						<button type="button" :disabled="issues.length === 0" @click="step(1)">{{ text.next }}</button>
					</span>
					<button
						v-if="sheet"
						type="button"
						class="tabula-issues-close"
						:aria-label="text.close"
						@click="open = false"
					>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
					</button>
				</div>
				<div class="tabula-issues-counts">
					<span class="tabula-issues-count is-error">
						<span class="tabula-issues-dot" aria-hidden="true" />
						{{ summary.errors }} {{ text.errors }}
					</span>
					<span v-if="summary.warnings > 0" class="tabula-issues-count is-warning">
						<span class="tabula-issues-dot" aria-hidden="true" />
						{{ summary.warnings }} {{ text.warnings }}
					</span>
					<span v-if="summary.stale > 0" class="tabula-issues-count is-stale">
						<span class="tabula-issues-dot" aria-hidden="true" />
						{{ summary.stale }} {{ text.stale }}
					</span>
					<span class="tabula-issues-rows">{{ summary.rows }} {{ text.rows }}</span>
				</div>
				<span v-if="onlyIssueRows !== undefined" class="tabula-issues-filter">
					<label>
						<input v-model="onlyIssueRows" type="checkbox" />
						{{ text.onlyIssueRows }}
					</label>
					<button v-if="onlyIssueRows" type="button" :title="text.refreshHint" @click="emit('refreshRows')">
						{{ text.refresh }}
					</button>
				</span>
			</header>
			<p v-if="issues.length === 0" class="tabula-issues-none">{{ text.none }}</p>
			<ul v-else ref="list" class="tabula-issues-list tabula-scroll">
				<li v-for="issue in shown" :key="issue.id">
					<button type="button" class="tabula-issues-item" :class="itemClass(issue)" @click="choose(issue)">
						<span class="tabula-issues-line">
							<span class="tabula-issues-dot" aria-hidden="true" />
							<span class="tabula-issues-where">{{ label(issue) }}</span>
							<span class="tabula-issues-source">{{ source(issue) }}</span>
						</span>
						<span class="tabula-issues-text">{{ issueText(issue, locale, valueSettings) }}</span>
						<span v-if="issue.stale" class="tabula-issues-recheck">{{ text.recheck }}</span>
						<span v-if="issue.rowId !== null" class="tabula-issues-go" aria-hidden="true">
							{{ text.goToCell }}
						</span>
					</button>
				</li>
				<li v-if="issues.length > shown.length" class="tabula-issues-more">
					+{{ issues.length - shown.length }} {{ text.more }}
				</li>
			</ul>
			<ScrollThumbs v-if="issues.length > 0" :target="list" />
			<div v-if="$slots.actions" class="tabula-issues-actions"><slot name="actions" /></div>
		</div>
	</section>
</template>

<style src="./theme.css"></style>

<style>
/* The colours are in theme.css, shared with the grid. */
.tabula-issues {
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
	gap: 12px;
	min-height: 0;
	padding: 14px;
}

.tabula-issues-head {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.tabula-issues-titles {
	display: flex;
	gap: 8px;
	align-items: center;
}

.tabula-issues-title {
	font-size: 1.15em;
	font-weight: 600;
}

.tabula-issues-nav {
	display: flex;
	gap: 6px;
	margin-left: auto;
}

.tabula-issues-counts {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 8px;
	align-items: center;
}

.tabula-issues-count {
	display: inline-flex;
	gap: 6px;
	align-items: center;
	box-sizing: border-box;
	height: 24px;
	padding: 0 9px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: 999px;
	font-size: 0.95em;
	font-weight: 600;
	white-space: nowrap;
}

.tabula-issues-count.is-error {
	border-color: var(--tabula-issues-error-line);
	background: var(--tabula-issues-error-bg);
	color: var(--tabula-issues-error);
}

.tabula-issues-count.is-warning {
	border-color: var(--tabula-issues-warning-line);
	background: var(--tabula-issues-warning-bg);
	color: var(--tabula-issues-warning);
}

.tabula-issues-count.is-stale {
	color: var(--tabula-issues-muted);
	font-weight: 500;
}

.tabula-issues-dot {
	flex: none;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--tabula-error-mark);
}

.is-warning > .tabula-issues-dot,
.is-warning > .tabula-issues-line > .tabula-issues-dot {
	background: var(--tabula-warning-mark);
}

.is-stale > .tabula-issues-dot,
.is-stale > .tabula-issues-line > .tabula-issues-dot {
	background: var(--tabula-stale-mark);
}

.is-clear > .tabula-issues-dot {
	background: var(--tabula-success-mark);
}

.tabula-issues-rows {
	color: var(--tabula-issues-muted);
}

.tabula-issues-filter {
	display: flex;
	gap: 8px;
	align-items: center;
}

.tabula-issues-filter label {
	display: inline-flex;
	gap: 6px;
	align-items: center;
	cursor: pointer;
}

.tabula-issues-filter input {
	accent-color: var(--tabula-accent-text);
}

.tabula-issues-nav button,
.tabula-issues-filter button {
	padding: 3px 10px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-issues-bg);
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.tabula-issues-nav button:disabled {
	color: var(--tabula-issues-muted);
	cursor: default;
}

.tabula-issues-none {
	margin: 0;
	color: var(--tabula-issues-muted);
}

.tabula-issues-list {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 8px;
	min-height: 0;
	/* Into the panel's padding, so the bar runs there and never against the cards. */
	margin: 0 -10px 0 0;
	padding: 0 10px 0 0;
	overflow: auto;
	list-style: none;
}

.tabula-issues-item {
	display: flex;
	flex-direction: column;
	gap: 4px;
	align-items: flex-start;
	box-sizing: border-box;
	width: 100%;
	padding: 10px 12px;
	border: 1px solid var(--tabula-issues-error-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-issues-error-bg);
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.tabula-issues-item.is-warning {
	border-color: var(--tabula-issues-warning-line);
	background: var(--tabula-issues-warning-bg);
}

.tabula-issues-item.is-stale {
	border-style: dashed;
	border-color: var(--tabula-issues-line);
	background: var(--tabula-issues-bg);
}

.tabula-issues-item:hover {
	filter: brightness(0.98);
}

.tabula-issues-item.is-current {
	box-shadow: 0 0 0 2px var(--tabula-accent);
}

.tabula-issues-item:focus-visible,
.tabula-issues-nav button:focus-visible,
.tabula-issues-bar:focus-visible,
.tabula-issues-close:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: 2px;
}

.tabula-issues-line {
	display: flex;
	gap: 8px;
	align-items: center;
	width: 100%;
}

.tabula-issues-where {
	color: var(--tabula-issues-error);
	font-weight: 600;
}

.is-warning .tabula-issues-where {
	color: var(--tabula-issues-warning);
}

.is-stale .tabula-issues-where {
	color: var(--tabula-issues-fg);
}

.tabula-issues-source {
	margin-left: auto;
	padding: 0 6px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: var(--tabula-radius-small);
	color: var(--tabula-issues-muted);
	font-size: 0.85em;
	white-space: nowrap;
}

.tabula-issues-item.is-stale .tabula-issues-text,
.tabula-issues-recheck {
	color: var(--tabula-issues-muted);
}

.tabula-issues-recheck {
	font-size: 0.9em;
}

.tabula-issues-go {
	color: var(--tabula-accent-text);
	font-size: 0.92em;
	font-weight: 600;
}

.tabula-issues-more {
	color: var(--tabula-issues-muted);
}

.tabula-issues-actions {
	display: flex;
	gap: 8px;
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
	border-color: var(--tabula-issues-error-line);
	background: var(--tabula-issues-error-bg);
	color: var(--tabula-issues-error);
}

.tabula-issues-bar.is-warning {
	border-color: var(--tabula-issues-warning-line);
	background: var(--tabula-issues-warning-bg);
	color: var(--tabula-issues-warning);
}

.tabula-issues-chevron,
.tabula-issues-close svg {
	width: 18px;
	height: 18px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
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
	padding: 10px 16px 16px;
	border-top: 1px solid var(--tabula-issues-line);
	border-radius: 16px 16px 0 0;
	background: var(--tabula-issues-bg);
	box-shadow: 0 -12px 30px rgb(0 0 0 / 25%);
}

.tabula-issues-handle {
	align-self: center;
	width: 44px;
	height: 5px;
	border-radius: 3px;
	background: var(--tabula-issues-line);
}

.tabula-issues-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	padding: 0;
	border: 0;
	border-radius: var(--tabula-radius);
	background: transparent;
	color: inherit;
	cursor: pointer;
}

.tabula-issues.is-sheet .tabula-issues-item {
	min-height: 44px;
}
</style>
