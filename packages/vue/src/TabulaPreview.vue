<script setup lang="ts">
import {
	formatCell,
	VALUE_SETTINGS,
	type CellValue,
	type Issue,
	type PlannedAction,
	type PlannedChange,
	type ProcessPlan,
	type RowId,
	type RowPlan,
	type SheetSession,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { computed, ref, toRaw, watch, type PropType } from "vue"
import { issueText, PREVIEW_TEXT, type GridLocale } from "./messages.js"
import type { GridTheme } from "./types.js"

/**
 * What a run would do, before it is sent: how many rows become new records, change one or leave one
 * as it is, and on each row what changes, from the backend's value to the sheet's. The host puts it
 * in a window of its own, with the buttons to go on or not; choosing a row emits `select`, for the
 * host to close the window and hand the row to the grid's `goTo()`.
 */
const props = defineProps({
	/** The session to be run. Its issues give each row's warnings. */
	session: { type: Object as PropType<SheetSession>, required: true },
	/** What `session.plan()` gave as the preview opened. */
	plan: { type: Object as PropType<ProcessPlan>, required: true },
	/** A field that names a row, such as its product, shown above the row's number. */
	nameField: { type: String as PropType<string | null>, default: null },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	valueSettings: { type: Object as PropType<ValueSettings>, default: () => VALUE_SETTINGS.tr },
	theme: { type: String as PropType<GridTheme>, default: "light" },
	/** How many rows are drawn at first, and how many more each time more are asked for. */
	limit: { type: Number, default: 100 }
})

const emit = defineEmits<{ select: [rowId: RowId] }>()

type Filter = "all" | PlannedAction | "warned"

const ACTIONS: readonly PlannedAction[] = ["create", "update", "unchanged", "unknown"]
const FILTER_WORDS: Readonly<Record<Filter, string>> = {
	all: "all",
	create: "filterCreate",
	update: "filterUpdate",
	unchanged: "filterUnchanged",
	unknown: "filterUnknown",
	warned: "filterWarned"
}

const filter = ref<Filter>("all")
const count = ref(props.limit)
const text = computed(() => PREVIEW_TEXT[props.locale])

watch([() => props.plan, filter], () => {
	count.value = props.limit
})

/** The warnings standing on each row: they do not stop the run, so they are shown before it. */
const warnings = computed(() => {
	const session = toRaw(props.session)
	const found = new Map<RowId, Issue[]>()

	for (const row of props.plan.rows) {
		const issues = [
			...session.issues.rowIssues(row.rowId),
			...session.schema.fields.flatMap(field => session.issues.issuesAt(row.rowId, field.key))
		].filter(issue => issue.severity === "warning" && !issue.stale)

		if (issues.length > 0) {
			found.set(row.rowId, issues)
		}
	}

	return found
})

/** The backend said nothing of what the rows would do: only their number can be shown. */
const blind = computed(() => props.plan.rows.length > 0 && props.plan.counts.unknown === props.plan.rows.length)

const filters = computed(() => {
	const shown: { key: Filter; count: number }[] = [{ key: "all", count: props.plan.rows.length }]

	for (const action of ACTIONS) {
		if (props.plan.counts[action] > 0) {
			shown.push({ key: action, count: props.plan.counts[action] })
		}
	}

	if (warnings.value.size > 0) {
		shown.push({ key: "warned", count: warnings.value.size })
	}

	return shown
})

const filtered = computed(() => {
	const rows = props.plan.rows

	if (filter.value === "all") {
		return rows
	}

	if (filter.value === "warned") {
		return rows.filter(row => warnings.value.has(row.rowId))
	}

	return rows.filter(row => row.action === filter.value)
})

const drawn = computed(() => filtered.value.slice(0, count.value))
const next = computed(() => Math.min(props.limit, filtered.value.length - drawn.value.length))

function name(rowId: RowId): string {
	const session = toRaw(props.session)

	if (props.nameField === null || !session.schema.has(props.nameField)) {
		return ""
	}

	return formatCell(
		session.schema.field(props.nameField),
		session.store.get(rowId, props.nameField),
		props.valueSettings
	)
}

function number(rowId: RowId): string {
	return `${text.value.row} ${toRaw(props.session).store.indexOf(rowId) + 1}`
}

function label(change: PlannedChange): string {
	const schema = toRaw(props.session).schema

	return schema.has(change.field) ? schema.field(change.field).label : change.field
}

/** A value the way its cell shows it; an empty one as a word, so a change to nothing is still seen. */
function shown(change: PlannedChange, value: CellValue): string {
	const schema = toRaw(props.session).schema
	const written = schema.has(change.field) ? formatCell(schema.field(change.field), value, props.valueSettings) : ""

	return written === "" ? (text.value.empty ?? "") : written
}

/** A new record's name is already its row's heading: it is not listed again among its fields. */
function changesOf(row: RowPlan): readonly PlannedChange[] {
	return row.action === "create" ? row.changes.filter(change => change.field !== props.nameField) : row.changes
}

function isEmpty(value: CellValue): boolean {
	return value === null || value === ""
}

function note(row: RowPlan): string {
	switch (row.action) {
		case "unchanged":
			return text.value.same ?? ""
		case "unknown":
			return text.value.unknownRow ?? ""
		case "update":
			return row.changes.length === 0 ? (text.value.noChanges ?? "") : ""
		default:
			return ""
	}
}

function chip(action: PlannedAction): string {
	return `${props.plan.counts[action]} ${text.value[action]}`
}

function filterText(key: Filter, total: number): string {
	const word = text.value[FILTER_WORDS[key]] ?? ""

	return key === "all" ? word : `${word} · ${total}`
}

function warningText(issue: Issue): string {
	return issueText(issue, props.locale, props.valueSettings)
}
</script>

<template>
	<section class="tabula-preview tabula-theme" :data-tabula-theme="theme" :aria-label="text.title">
		<p v-if="!plan.current" class="tabula-preview-stale" role="status" v-text="text.stale" />

		<div class="tabula-preview-counts">
			<template v-if="blind">
				<span class="tabula-preview-chip is-unknown" v-text="`${plan.rows.length} ${text.sent}`" />
			</template>
			<template v-else>
				<template v-for="action in ACTIONS" :key="action">
					<span
						v-if="plan.counts[action] > 0"
						class="tabula-preview-chip"
						:class="`is-${action}`"
						v-text="chip(action)"
					/>
				</template>
			</template>
			<span
				v-if="warnings.size > 0"
				class="tabula-preview-chip is-warned"
				v-text="`${warnings.size} ${text.warned}`"
			/>
		</div>

		<p v-if="blind" class="tabula-preview-note" v-text="text.noPlan" />

		<div v-if="filters.length > 2" class="tabula-preview-filters" role="group" :aria-label="text.filters">
			<button
				v-for="item in filters"
				:key="item.key"
				type="button"
				:class="{ 'is-on': filter === item.key }"
				:aria-pressed="filter === item.key"
				@click="filter = item.key"
				v-text="filterText(item.key, item.count)"
			/>
		</div>

		<ul v-if="!blind || warnings.size > 0" class="tabula-preview-list">
			<li v-for="row in drawn" :key="row.rowId">
				<button
					type="button"
					class="tabula-preview-row"
					:class="`is-${row.action}`"
					:data-row-id="row.rowId"
					@click="emit('select', row.rowId)"
				>
					<span class="tabula-preview-name">
						<strong v-if="name(row.rowId)" v-text="name(row.rowId)" />
						<span class="tabula-preview-number" v-text="number(row.rowId)" />
					</span>
					<span class="tabula-preview-action" :class="`is-${row.action}`" v-text="text[`${row.action}One`]" />
					<span class="tabula-preview-changes">
						<span v-for="change in changesOf(row)" :key="change.field" class="tabula-preview-change">
							<span class="tabula-preview-field" v-text="label(change)" />
							<template v-if="row.action === 'update'">
								<s
									class="tabula-preview-before"
									:class="{ 'is-empty': isEmpty(change.before) }"
									v-text="shown(change, change.before)"
								/>
								<span class="tabula-preview-arrow" aria-hidden="true">→</span>
							</template>
							<strong
								class="tabula-preview-after"
								:class="{ 'is-empty': isEmpty(change.after) }"
								v-text="shown(change, change.after)"
							/>
						</span>
						<span v-if="note(row)" class="tabula-preview-quiet" v-text="note(row)" />
						<span
							v-for="issue in warnings.get(row.rowId) ?? []"
							:key="issue.id"
							class="tabula-preview-warning"
							v-text="warningText(issue)"
						/>
					</span>
				</button>
			</li>
			<li v-if="filtered.length === 0" class="tabula-preview-quiet" v-text="text.none" />
			<li v-if="next > 0">
				<button
					type="button"
					class="tabula-preview-more"
					@click="count += limit"
					v-text="(text.more ?? '').replace('{n}', String(next))"
				/>
			</li>
		</ul>
	</section>
</template>

<style src="./theme.css"></style>

<style>
.tabula-preview {
	display: flex;
	flex-direction: column;
	gap: 12px;
	container-type: inline-size;
	color: var(--tabula-fg);
	line-height: 1.4;
}

.tabula-preview-stale,
.tabula-preview-note {
	margin: 0;
	color: var(--tabula-muted);
}

.tabula-preview-stale {
	padding: 8px 12px;
	border: 1px solid var(--tabula-issues-warning-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-issues-warning-bg);
	color: var(--tabula-issues-warning);
}

.tabula-preview-counts,
.tabula-preview-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.tabula-preview-chip,
.tabula-preview-action {
	display: inline-flex;
	align-items: center;
	box-sizing: border-box;
	height: 26px;
	padding: 0 10px;
	border-radius: 999px;
	font-weight: 600;
	white-space: nowrap;
}

.tabula-preview-action {
	justify-self: start;
	height: 24px;
	padding: 0 9px;
	font-size: 0.92em;
}

.is-create.tabula-preview-chip,
.is-create.tabula-preview-action {
	background: var(--tabula-info-bg);
	color: var(--tabula-info-text);
}

.is-update.tabula-preview-chip,
.is-update.tabula-preview-action {
	background: var(--tabula-success-bg);
	color: var(--tabula-accent-text);
}

.is-unchanged.tabula-preview-chip,
.is-unchanged.tabula-preview-action,
.is-unknown.tabula-preview-chip,
.is-unknown.tabula-preview-action {
	background: var(--tabula-hover-bg);
	color: var(--tabula-muted);
}

.is-warned.tabula-preview-chip {
	background: var(--tabula-issues-warning-bg);
	color: var(--tabula-issues-warning);
}

.tabula-preview-filters button,
.tabula-preview-more {
	box-sizing: border-box;
	min-height: 32px;
	padding: 0 12px;
	border: 1px solid var(--tabula-issues-line);
	border-radius: var(--tabula-radius);
	background: transparent;
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.tabula-preview-filters button.is-on {
	border-color: color-mix(in srgb, var(--tabula-accent) 45%, transparent);
	background: var(--tabula-success-bg);
	color: var(--tabula-accent-text);
	font-weight: 600;
}

.tabula-preview-list {
	display: flex;
	flex-direction: column;
	margin: 0;
	padding: 0;
	border-top: 1px solid var(--tabula-line);
	list-style: none;
}

.tabula-preview-list > li {
	border-bottom: 1px solid var(--tabula-line);
}

.tabula-preview-row {
	display: grid;
	grid-template-columns: minmax(120px, 0.28fr) 116px minmax(0, 1fr);
	gap: 6px 14px;
	align-items: start;
	box-sizing: border-box;
	width: 100%;
	padding: 10px 4px;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.tabula-preview-row:hover {
	background: var(--tabula-hover-bg);
}

.tabula-preview-row:focus-visible,
.tabula-preview-filters button:focus-visible,
.tabula-preview-more:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: 2px;
}

.tabula-preview-row.is-unchanged,
.tabula-preview-row.is-unknown {
	color: var(--tabula-muted);
}

.tabula-preview-name {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.tabula-preview-name strong {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-preview-number,
.tabula-preview-field,
.tabula-preview-arrow {
	color: var(--tabula-muted);
}

.tabula-preview-number {
	font-size: 0.92em;
}

.tabula-preview-changes {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	min-width: 0;
}

.tabula-preview-change {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 0 6px;
	align-items: baseline;
	min-width: 0;
}

.tabula-preview-before {
	color: var(--tabula-muted);
}

.tabula-preview-before.is-empty,
.tabula-preview-after.is-empty {
	font-style: italic;
	font-weight: 400;
}

.tabula-preview-quiet {
	color: var(--tabula-muted);
}

.tabula-preview-list > li.tabula-preview-quiet {
	padding: 12px 4px;
}

.tabula-preview-warning {
	flex-basis: 100%;
	color: var(--tabula-issues-warning);
}

.tabula-preview-list > li:last-child:has(.tabula-preview-more) {
	padding: 10px 0;
	border-bottom: 0;
}

/* Narrow: the name and the kind on one line, the changes under them. */
@container (max-width: 560px) {
	.tabula-preview-row {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.tabula-preview-changes {
		grid-column: 1 / -1;
	}
}
</style>
