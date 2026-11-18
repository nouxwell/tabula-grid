<script setup lang="ts">
import {
	VALUE_SETTINGS,
	type Issue,
	type IssueSet,
	type ModuleSchema,
	type RowStore,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { computed, shallowRef, toRaw, watch, type PropType } from "vue"
import { issueText, PANEL_TEXT, type GridLocale } from "./messages.js"
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
	limit: { type: Number, default: 500 }
})

const emit = defineEmits<{ select: [issue: Issue]; refreshRows: [] }>()

/**
 * Whether only the rows with issues are shown. Bound with `v-model:only-issue-rows`, it puts a switch
 * in the panel's head, and a button that emits `refresh-rows` while it is on; the host filters its
 * `RowView` by them. Left unbound, there is no switch.
 */
const onlyIssueRows = defineModel<boolean>("onlyIssueRows")

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

function choose(issue: Issue): void {
	current.value = issue.id
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
	<section class="tabula-issues" :data-tabula-theme="theme" :aria-label="text.title">
		<header class="tabula-issues-head">
			<strong>{{ text.title }}</strong>
			<span class="tabula-issues-count is-error">{{ summary.errors }} {{ text.errors }}</span>
			<span v-if="summary.warnings > 0" class="tabula-issues-count is-warning">
				{{ summary.warnings }} {{ text.warnings }}
			</span>
			<span v-if="summary.stale > 0" class="tabula-issues-count is-stale">
				{{ summary.stale }} {{ text.stale }}
			</span>
			<span class="tabula-issues-rows">{{ summary.rows }} {{ text.rows }}</span>
			<span class="tabula-issues-nav">
				<button type="button" :disabled="issues.length === 0" @click="step(-1)">{{ text.previous }}</button>
				<button type="button" :disabled="issues.length === 0" @click="step(1)">{{ text.next }}</button>
			</span>
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
		<ul v-else class="tabula-issues-list">
			<li v-for="issue in shown" :key="issue.id">
				<button type="button" class="tabula-issues-item" :class="itemClass(issue)" @click="choose(issue)">
					<span class="tabula-issues-where">{{ label(issue) }}</span>
					<span class="tabula-issues-text">{{ issueText(issue, locale, valueSettings) }}</span>
					<span v-if="issue.stale" class="tabula-issues-recheck">{{ text.recheck }}</span>
				</button>
			</li>
			<li v-if="issues.length > shown.length" class="tabula-issues-more">
				+{{ issues.length - shown.length }} {{ text.more }}
			</li>
		</ul>
	</section>
</template>

<style>
.tabula-issues {
	--tabula-issues-bg: #ffffff;
	--tabula-issues-fg: #161922;
	--tabula-issues-muted: #586074;
	--tabula-issues-line: #d6dae4;
	--tabula-issues-hover: #f1f3f8;
	--tabula-issues-current: #dbe1f6;
	--tabula-issues-error: #c0392b;
	--tabula-issues-warning: #a15c00;

	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	min-height: 0;
	border: 1px solid var(--tabula-issues-line);
	background: var(--tabula-issues-bg);
	color: var(--tabula-issues-fg);
	font-size: 13px;
	line-height: 1.4;
}

.tabula-issues[data-tabula-theme="dark"] {
	--tabula-issues-bg: #191c24;
	--tabula-issues-fg: #e7e9f0;
	--tabula-issues-muted: #9aa2b6;
	--tabula-issues-line: #343a4c;
	--tabula-issues-hover: #222632;
	--tabula-issues-current: #2c3660;
	--tabula-issues-error: #ff8a80;
	--tabula-issues-warning: #f0b860;

	color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
	.tabula-issues[data-tabula-theme="auto"] {
		--tabula-issues-bg: #191c24;
		--tabula-issues-fg: #e7e9f0;
		--tabula-issues-muted: #9aa2b6;
		--tabula-issues-line: #343a4c;
		--tabula-issues-hover: #222632;
		--tabula-issues-current: #2c3660;
		--tabula-issues-error: #ff8a80;
		--tabula-issues-warning: #f0b860;

		color-scheme: dark;
	}
}

.tabula-issues-head {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 10px;
	align-items: center;
	padding: 10px 12px;
	border-bottom: 1px solid var(--tabula-issues-line);
}

.tabula-issues-count.is-error {
	color: var(--tabula-issues-error);
	font-weight: 600;
}

.tabula-issues-count.is-warning {
	color: var(--tabula-issues-warning);
	font-weight: 600;
}

.tabula-issues-rows {
	color: var(--tabula-issues-muted);
}

.tabula-issues-nav {
	display: flex;
	gap: 6px;
	margin-left: auto;
}

.tabula-issues-filter {
	display: flex;
	flex-basis: 100%;
	gap: 8px;
	align-items: center;
}

.tabula-issues-filter label {
	display: inline-flex;
	gap: 5px;
	align-items: center;
	cursor: pointer;
}

.tabula-issues-nav button,
.tabula-issues-filter button {
	padding: 2px 9px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: 4px;
	background: var(--tabula-issues-bg);
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.tabula-issues-none {
	margin: 0;
	padding: 12px;
	color: var(--tabula-issues-muted);
}

.tabula-issues-list {
	flex: 1;
	min-height: 0;
	margin: 0;
	padding: 0;
	overflow: auto;
	list-style: none;
}

.tabula-issues-item {
	display: flex;
	flex-direction: column;
	gap: 2px;
	box-sizing: border-box;
	width: 100%;
	padding: 8px 12px;
	border: 0;
	border-bottom: 1px solid var(--tabula-issues-line);
	border-left: 3px solid var(--tabula-issues-error);
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.tabula-issues-item.is-warning {
	border-left-color: var(--tabula-issues-warning);
}

.tabula-issues-item.is-stale {
	border-left-color: var(--tabula-issues-muted);
	border-left-style: dashed;
}

.tabula-issues-item.is-stale .tabula-issues-text {
	color: var(--tabula-issues-muted);
}

.tabula-issues-count.is-stale,
.tabula-issues-recheck {
	color: var(--tabula-issues-muted);
	font-size: 12px;
}

.tabula-issues-item:hover {
	background: var(--tabula-issues-hover);
}

.tabula-issues-item.is-current {
	background: var(--tabula-issues-current);
}

.tabula-issues-item:focus-visible,
.tabula-issues-nav button:focus-visible {
	outline: 2px solid var(--tabula-issues-error);
	outline-offset: -2px;
}

.tabula-issues-where {
	color: var(--tabula-issues-muted);
	font-size: 12px;
}

.tabula-issues-more {
	padding: 8px 12px;
	color: var(--tabula-issues-muted);
}
</style>
