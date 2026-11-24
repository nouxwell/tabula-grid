<script setup lang="ts">
import { computed, type PropType } from "vue"
import { BAR_TEXT, type GridLocale } from "./messages.js"
import type TabulaGrid from "./TabulaGrid.vue"
import type { GridTheme } from "./types.js"

/**
 * The line under a sheet, as a spreadsheet's status bar: how many rows and issues there are, which
 * cells are selected, and the sum and average of their numbers. What an application adds, such as
 * whether its draft was saved, goes in the `start` and `end` slots.
 */
const props = defineProps({
	/** The grid it belongs to: its template ref. */
	grid: { type: Object as PropType<InstanceType<typeof TabulaGrid> | null>, default: null },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	theme: { type: String as PropType<GridTheme>, default: "light" }
})

const text = computed(() => BAR_TEXT[props.locale])

function count(value: number): string {
	return value.toLocaleString(props.locale === "tr" ? "tr-TR" : "en-US")
}

const rowsText = computed(() => {
	const rows = props.grid?.rows

	if (!rows) {
		return ""
	}

	return rows.shown === rows.total
		? `${count(rows.total)} ${text.value.rows}`
		: `${count(rows.shown)} / ${count(rows.total)} ${text.value.rows}`
})

const issueCount = computed(() => {
	const summary = props.grid?.issueSummary

	return summary ? summary.errors + summary.warnings : 0
})

const selected = computed(() => props.grid?.selected ?? null)

/** The sum and average, once more than one cell is selected and a number is among them. */
const numbers = computed(() => {
	const area = selected.value
	const grid = props.grid

	if (!grid || !area || area.field === null || area.sum === null || area.rows * area.columns < 2) {
		return null
	}

	return {
		sum: grid.formatValue(area.field, area.sum),
		average: area.average === null ? null : grid.formatValue(area.field, area.average)
	}
})
</script>

<template>
	<div class="tabula-status tabula-theme" :data-tabula-theme="theme" role="group" :aria-label="text.statusBar">
		<div v-if="$slots.start" class="tabula-status-start"><slot name="start" /></div>
		<div class="tabula-status-info">
			<span class="tabula-status-rows">
				{{ rowsText }}
				<template v-if="issueCount > 0">· {{ count(issueCount) }} {{ text.issues }}</template>
			</span>
			<template v-if="selected">
				<span class="tabula-status-sep" aria-hidden="true" />
				<span class="tabula-status-selected">
					{{ text.selected }}:
					<span class="tabula-status-address">{{ selected.address }}</span>
				</span>
			</template>
			<template v-if="numbers">
				<span class="tabula-status-sum">
					{{ text.sum }}:
					<strong>{{ numbers.sum }}</strong>
				</span>
				<span v-if="numbers.average" class="tabula-status-average">
					{{ text.average }}:
					<strong>{{ numbers.average }}</strong>
				</span>
			</template>
		</div>
		<div v-if="$slots.end" class="tabula-status-end"><slot name="end" /></div>
	</div>
</template>

<style src="./theme.css"></style>

<style>
.tabula-status {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 16px;
	align-items: center;
	box-sizing: border-box;
	min-height: 40px;
	padding: 6px 12px;
	background: var(--tabula-bg);
	color: var(--tabula-muted);
	line-height: 1.35;
}

.tabula-status-start,
.tabula-status-end {
	display: flex;
	gap: 8px;
	align-items: center;
}

.tabula-status-info {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 16px;
	align-items: center;
	margin-left: auto;
}

.tabula-status strong {
	color: var(--tabula-fg);
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.tabula-status-address {
	color: var(--tabula-fg);
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.tabula-status-sep {
	width: 1px;
	height: 18px;
	background: var(--tabula-head-line);
}
</style>
