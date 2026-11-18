<script setup lang="ts">
import { computed, ref, shallowRef, watch, type PropType } from "vue"
import { BAR_TEXT, type GridLocale } from "./messages.js"
import type TabulaGrid from "./TabulaGrid.vue"
import type { GridTheme } from "./types.js"

/**
 * The active cell's address and value, above the grid, as a spreadsheet's formula bar has them.
 *
 * An address typed into the first box goes there on Enter. The value is edited in the second as in
 * the cell itself: Enter writes it and gives the grid the keyboard back, Escape leaves it as it was.
 * A column worked out by a formula shows its formula, which is not typed over.
 */
const props = defineProps({
	/** The grid it belongs to: its template ref. */
	grid: { type: Object as PropType<InstanceType<typeof TabulaGrid> | null>, default: null },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	theme: { type: String as PropType<GridTheme>, default: "light" }
})

const text = computed(() => BAR_TEXT[props.locale])
const cell = computed(() => props.grid?.cell ?? null)
/** A column worked out by a formula: its formula in pieces, with labels, each field in its colour. */
const formula = computed(() => cell.value?.formula ?? null)

function partClass(field: string | null): string[] | undefined {
	const index = field === null ? -1 : (cell.value?.references.indexOf(field) ?? -1)

	return index < 0 ? undefined : ["tabula-formula-ref", `tabula-ref-${index % 6}`]
}

/**
 * The cell being typed for, kept from the first key: a click on another cell moves the selection
 * before this box lets go, and what was typed belongs to the cell it was typed for.
 */
const target = shallowRef<{ readonly rowId: string; readonly key: string } | null>(null)
const draft = ref<string | null>(null)
const address = ref<string | null>(null)
const wrongAddress = ref(false)

const shownValue = computed(() => draft.value ?? cell.value?.text ?? "")

watch(
	() => cell.value?.address,
	() => {
		wrongAddress.value = false
	}
)

function onValueInput(event: Event): void {
	const now = cell.value

	if (!now?.editable) {
		return
	}

	if (draft.value === null) {
		target.value = { rowId: now.rowId, key: now.field.key }
	}

	draft.value = (event.target as HTMLInputElement).value
}

/** Writes what was typed into the cell it was typed for. */
function commit(refocus: boolean): void {
	const into = target.value
	const value = draft.value

	draft.value = null
	target.value = null

	if (into && value !== null) {
		props.grid?.writeCell(into.rowId, into.key, value)
	}

	if (refocus) {
		props.grid?.focus()
	}
}

function cancel(): void {
	draft.value = null
	target.value = null
	props.grid?.focus()
}

function onAddressKeydown(event: KeyboardEvent): void {
	if (event.key === "Enter") {
		event.preventDefault()

		const found = props.grid?.goToAddress(address.value ?? cell.value?.address ?? "") ?? false

		wrongAddress.value = !found

		if (found) {
			address.value = null
		}
	} else if (event.key === "Escape") {
		event.preventDefault()
		address.value = null
		wrongAddress.value = false
		props.grid?.focus()
	}
}

function onAddressBlur(): void {
	address.value = null
	wrongAddress.value = false
}

function selectAll(event: FocusEvent): void {
	;(event.target as HTMLInputElement).select()
}
</script>

<template>
	<div class="tabula-formula tabula-theme" :data-tabula-theme="theme" role="group" :aria-label="text.formulaBar">
		<input
			class="tabula-formula-address"
			:class="{ 'is-wrong': wrongAddress }"
			type="text"
			spellcheck="false"
			autocomplete="off"
			:value="address ?? cell?.address ?? ''"
			:aria-label="text.address"
			:aria-invalid="wrongAddress || undefined"
			:title="wrongAddress ? text.noAddress : text.addressHint"
			@focus="selectAll"
			@input="address = ($event.target as HTMLInputElement).value"
			@keydown="onAddressKeydown"
			@blur="onAddressBlur"
		/>
		<span class="tabula-formula-fx" aria-hidden="true">ƒx</span>
		<div
			v-if="formula !== null"
			class="tabula-formula-value is-formula"
			role="textbox"
			aria-readonly="true"
			tabindex="0"
			:aria-label="text.value"
			:title="text.formulaHint"
		>
			<span>=</span>
			<span v-for="(part, at) in formula" :key="at" :class="partClass(part.field)" v-text="part.text" />
		</div>
		<input
			v-else
			class="tabula-formula-value"
			type="text"
			spellcheck="false"
			autocomplete="off"
			:value="shownValue"
			:readonly="!cell?.editable"
			:aria-label="text.value"
			@input="onValueInput"
			@keydown.enter.prevent="commit(true)"
			@keydown.escape.prevent="cancel"
			@blur="commit(false)"
		/>
	</div>
</template>

<style src="./theme.css"></style>

<style>
.tabula-formula {
	display: flex;
	gap: 8px;
	align-items: stretch;
	min-width: 0;
	background: transparent;
	font-size: var(--tabula-font-size);
}

.tabula-formula-address,
.tabula-formula-value {
	box-sizing: border-box;
	height: 32px;
	padding: 0 10px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	outline: none;
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
	font-size: inherit;
}

.tabula-formula-address {
	flex: none;
	width: 96px;
}

.tabula-formula-address.is-wrong {
	border-color: var(--tabula-error-mark);
}

.tabula-formula-value {
	flex: 1;
	min-width: 0;
}

/* A formula: read only, each field it reads in the colour its column has in the sheet. */
.tabula-formula-value.is-formula {
	display: block;
	overflow: hidden;
	line-height: 30px;
	text-overflow: ellipsis;
	background: var(--tabula-readonly-bg);
	white-space: pre;
}

.tabula-formula-ref {
	color: var(--tabula-ref);
	font-weight: 600;
}

.tabula-formula-value[readonly] {
	background: var(--tabula-readonly-bg);
	color: var(--tabula-muted);
}

.tabula-formula-address:focus,
.tabula-formula-value:focus {
	border-color: var(--tabula-accent);
	box-shadow: 0 0 0 1px var(--tabula-accent);
}

.tabula-formula-fx {
	align-self: center;
	color: var(--tabula-muted);
	font-family: Georgia, "Times New Roman", serif;
	font-style: italic;
}
</style>
