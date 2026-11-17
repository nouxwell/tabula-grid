<script setup lang="ts">
import { ModuleSchema, RowStore, SheetValidator, UndoHistory, VALUE_SETTINGS, type Issue } from "@nouxwell/tabula-core"
import { TabulaGrid, TabulaIssues, type GridTheme } from "@nouxwell/tabula-vue"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { priceUpdate, sampleRows } from "./sample"

const params = new URLSearchParams(location.search)
const rowCount = Number(params.get("rows") ?? 10_000)
const initialTheme = params.get("theme")

const schema = ModuleSchema.from(priceUpdate)
const store = new RowStore({ rows: sampleRows(rowCount) })

const theme = ref<GridTheme>(initialTheme === "dark" || initialTheme === "auto" ? initialTheme : "light")
const language = ref<keyof typeof VALUE_SETTINGS>(params.get("values") === "en" ? "en" : "tr")
const valueSettings = computed(() => VALUE_SETTINGS[language.value])

// One validator for the grid and the panel, so both tell the same story.
const validator = new SheetValidator(schema, store, valueSettings.value)

watch(valueSettings, settings => validator.setSettings(settings))

// The playground's own history, so its buttons know when there is something to undo or redo.
const history = new UndoHistory(store)
const historyVersion = shallowRef(history.version)
const canUndo = computed(() => historyVersion.value >= 0 && history.canUndo)
const canRedo = computed(() => historyVersion.value >= 0 && history.canRedo)

history.subscribe(() => (historyVersion.value = history.version))

const undoLabels = computed(() =>
	language.value === "en" ? { undo: "Undo", redo: "Redo" } : { undo: "Geri al", redo: "Yinele" }
)

onBeforeUnmount(() => {
	validator.dispose()
	history.dispose()
})

const widths = ref<Readonly<Record<string, number>>>({})
const grid = ref<InstanceType<typeof TabulaGrid> | null>(null)
const revision = shallowRef(store.revision)
const size = shallowRef(store.size)
const position = shallowRef("")

store.subscribe(change => {
	revision.value = change.revision
	size.value = store.size
})

const dark = computed(() => theme.value === "dark")

function goTo(issue: Issue): void {
	if (issue.rowId !== null) {
		grid.value?.goTo(issue.rowId, issue.field)
	}
}

onMounted(() => {
	const selection = grid.value?.selection

	if (!selection) {
		return
	}

	const describe = (): void => {
		const range = selection.range

		position.value = range ? `R${range.top + 1}C${range.left + 1}:R${range.bottom + 1}C${range.right + 1}` : ""
	}

	selection.subscribe(describe)
	describe()

	window.__playground = { schema, store, selection, validator, history, widths: () => widths.value }
	grid.value?.focus()
})
</script>

<template>
	<div class="playground" :class="{ 'is-dark': dark }">
		<header class="playground-bar">
			<strong>{{ schema.title }}</strong>
			<span class="playground-buttons">
				<button type="button" class="playground-undo" :disabled="!canUndo" title="Ctrl+Z" @click="grid?.undo()">
					{{ undoLabels.undo }}
				</button>
				<button type="button" class="playground-redo" :disabled="!canRedo" title="Ctrl+Y" @click="grid?.redo()">
					{{ undoLabels.redo }}
				</button>
			</span>
			<span>{{ size.toLocaleString("tr-TR") }} satır</span>
			<span>Seçim {{ position }}</span>
			<span>Sürüm {{ revision }}</span>
			<label>
				Tema
				<select v-model="theme">
					<option value="light">Açık</option>
					<option value="dark">Koyu</option>
					<option value="auto">Sistem</option>
				</select>
			</label>
			<label>
				Dil ve biçim
				<select v-model="language">
					<option value="tr">Türkçe</option>
					<option value="en">English</option>
				</select>
			</label>
		</header>
		<main class="playground-main">
			<TabulaGrid
				ref="grid"
				v-model:column-widths="widths"
				class="playground-grid"
				:schema="schema"
				:store="store"
				:validator="validator"
				:history="history"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
			/>
			<TabulaIssues
				class="playground-issues"
				:validator="validator"
				:schema="schema"
				:store="store"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
				@select="goTo"
			/>
		</main>
	</div>
</template>

<style>
html,
body,
#app {
	height: 100%;
	margin: 0;
}

body {
	font-family: system-ui, "Segoe UI", sans-serif;
}

.playground {
	display: flex;
	flex-direction: column;
	gap: 10px;
	box-sizing: border-box;
	height: 100%;
	padding: 12px 16px 16px;
	background: #f5f6f9;
	color: #161922;
}

.playground.is-dark {
	background: #111318;
	color: #e7e9f0;
}

.playground-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 18px;
	align-items: center;
	font-size: 13px;
}

.playground-buttons {
	display: inline-flex;
	gap: 6px;
}

.playground-main {
	display: grid;
	flex: 1;
	grid-template-columns: minmax(0, 1fr) 320px;
	gap: 12px;
	min-height: 0;
}

.playground-grid,
.playground-issues {
	min-height: 0;
}
</style>
