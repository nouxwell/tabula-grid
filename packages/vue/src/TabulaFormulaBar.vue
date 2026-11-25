<script setup lang="ts">
import type { FormulaPart } from "@nouxwell/tabula-core"
import { computed, nextTick, ref, shallowRef, useId, watch, type PropType } from "vue"
import FormulaHelp from "./FormulaHelp.vue"
import { isEntryFormula, type EntryResult } from "./formulaEntry.js"
import { BAR_TEXT, GRID_TEXT, type GridLocale } from "./messages.js"
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

/** A field in the colour its column has; another sheet's name as a chip, and the field read there in its colour. */
function partClass(part: FormulaPart): string[] | undefined {
	if (part.sheet !== undefined) {
		return [part.field === null ? "tabula-formula-sheet" : "tabula-formula-sheet-field"]
	}

	const field = part.field
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

// ---------------------------------------------------------------- a formula typed with "="

const valueInput = ref<HTMLInputElement | null>(null)
const listId = `${useId()}-formula`
/** Where the caret stands: the suggestions follow it. */
const caret = ref(0)
const highlighted = ref(0)
/** Escape closed the suggestions; they open again with what is typed next. */
const dismissed = ref(false)

/** A formula typed here: its suggestions, its help and its result for the active cell, from the grid. */
const entry = computed(() => {
	const typed = draft.value

	return typed !== null && isEntryFormula(typed) ? (props.grid?.entryFor(typed, caret.value) ?? null) : null
})

const listOpen = computed(() => entry.value !== null && !dismissed.value && entry.value.help.items.length > 0)

/** The result, with the cell Enter writes into after it. */
const result = computed<EntryResult | null>(() => {
	const now = entry.value

	if (!now?.result) {
		return null
	}

	return now.result.ok ? { ...now.result, text: `${now.result.text} · ${now.note}` } : now.result
})

watch(
	() => entry.value?.help.items,
	() => {
		highlighted.value = 0
	}
)

function followCaret(): void {
	caret.value = valueInput.value?.selectionStart ?? draft.value?.length ?? 0
}

/** Puts text in place of `start`..`end` of what is typed, the caret after it. */
function replaceDraft(start: number, end: number, insert: string): void {
	const typed = draft.value ?? ""
	const at = start + insert.length

	draft.value = `${typed.slice(0, start)}${insert}${typed.slice(end)}`
	caret.value = at
	props.grid?.showEntry(draft.value)

	void nextTick(() => {
		valueInput.value?.focus()
		valueInput.value?.setSelectionRange(at, at)
	})
}

function pickEntry(index: number): void {
	const help = entry.value?.help
	const item = help?.items[index]

	if (help && item) {
		replaceDraft(help.start, help.end, item.insert)
	}
}

function onValueInput(event: Event): void {
	const now = cell.value

	if (!now?.editable) {
		return
	}

	if (draft.value === null) {
		target.value = { rowId: now.rowId, key: now.field.key }
	}

	draft.value = (event.target as HTMLInputElement).value
	dismissed.value = false
	followCaret()
	// The columns a formula reads are coloured in the grid while it is typed.
	props.grid?.showEntry(isEntryFormula(draft.value) ? draft.value : null)
}

function onValueKeydown(event: KeyboardEvent): void {
	const help = entry.value?.help

	if (listOpen.value && help) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			const count = help.items.length

			event.preventDefault()
			highlighted.value = (highlighted.value + (event.key === "ArrowDown" ? 1 : -1) + count) % count

			return
		}

		if ((event.key === "Enter" && !(event.ctrlKey || event.metaKey)) || event.key === "Tab") {
			event.preventDefault()
			pickEntry(highlighted.value)

			return
		}

		if (event.key === "Escape") {
			event.preventDefault()
			dismissed.value = true

			return
		}
	}

	if (event.key === "Enter") {
		event.preventDefault()

		if (event.ctrlKey || event.metaKey) {
			commitAll()
		} else {
			commit(true)
		}
	} else if (event.key === "Escape") {
		event.preventDefault()
		cancel()
	}
}

function end(): void {
	draft.value = null
	target.value = null
	dismissed.value = false
	props.grid?.showEntry(null)
}

/**
 * Writes what was typed into the cell it was typed for. A formula that gives no value writes
 * nothing; on Enter it stays here, its reason under it, to be put right.
 */
function commit(refocus: boolean): void {
	const into = target.value
	const value = draft.value

	if (into && value !== null) {
		const written = props.grid?.writeCell(into.rowId, into.key, value) ?? true

		if (!written && refocus && isEntryFormula(value)) {
			return
		}
	}

	end()

	if (refocus) {
		props.grid?.focus()
	}
}

/** Ctrl+Enter: into every cell selected, a formula worked out for each one's row. */
function commitAll(): void {
	const value = draft.value

	end()

	if (value !== null) {
		props.grid?.enterSelected(value)
	}

	props.grid?.focus()
}

function cancel(): void {
	end()
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
			<span v-for="(part, at) in formula" :key="at" :class="partClass(part)" v-text="part.text" />
		</div>
		<div v-else class="tabula-formula-value-wrap">
			<input
				ref="valueInput"
				class="tabula-formula-value"
				type="text"
				spellcheck="false"
				autocomplete="off"
				:value="shownValue"
				:readonly="!cell?.editable"
				:aria-label="text.value"
				:role="entry ? 'combobox' : undefined"
				:aria-autocomplete="entry ? 'list' : undefined"
				:aria-expanded="entry ? listOpen : undefined"
				:aria-controls="entry ? listId : undefined"
				:aria-activedescendant="listOpen ? `${listId}-${highlighted}` : undefined"
				:title="
					cell?.filledFrom
						? (GRID_TEXT[locale][cell.editable ? 'filledFromEditable' : 'filledFrom'] ?? '').replace(
								'{record}',
								cell.filledFrom
							)
						: undefined
				"
				@input="onValueInput"
				@keydown="onValueKeydown"
				@keyup="followCaret"
				@click="followCaret"
				@blur="commit(false)"
			/>
			<FormulaHelp
				v-if="entry"
				class="tabula-formula-entry"
				:help="entry.help"
				:list-open="listOpen"
				:highlighted="highlighted"
				:list-id="listId"
				:locale="locale"
				:result="result"
				@pick="pickEntry"
				@hover="highlighted = $event"
			/>
		</div>
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

/*
 * A strip, not two boxed fields: the address and the value lie flat, and show their edge only under
 * the pointer or while typed into.
 */
.tabula-formula-address,
.tabula-formula-value {
	box-sizing: border-box;
	height: 32px;
	padding: 0 10px;
	border: 1px solid transparent;
	border-radius: var(--tabula-radius);
	outline: none;
	background: transparent;
	color: var(--tabula-fg);
	font-family: inherit;
	font-size: inherit;
	font-variant-numeric: tabular-nums;
	transition:
		border-color 0.15s ease,
		box-shadow 0.15s ease;
}

.tabula-formula-address {
	flex: none;
	width: 80px;
	font-weight: 600;
}

.tabula-formula-address:hover,
.tabula-formula-value:not([readonly], .is-formula):hover {
	border-color: var(--tabula-head-line);
}

.tabula-formula-address.is-wrong {
	border-color: var(--tabula-error-mark);
}

.tabula-formula-value {
	flex: 1;
	min-width: 0;
}

.tabula-formula-value-wrap {
	position: relative;
	display: flex;
	flex: 1;
	min-width: 0;
}

/* A formula typed with "=": its result and help under the bar, over the sheet. */
.tabula-formula-entry {
	animation: tabula-formula-drop 0.12s ease-out;
	position: absolute;
	top: calc(100% + 4px);
	left: 0;
	z-index: 20;
	width: max-content;
}

@keyframes tabula-formula-drop {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
}

/* A formula: read only, each field it reads in the colour its column has in the sheet. */
.tabula-formula-value.is-formula {
	display: block;
	overflow: hidden;
	line-height: 30px;
	text-overflow: ellipsis;
	white-space: pre;
}

.tabula-formula-ref {
	color: var(--tabula-ref);
	font-weight: 600;
}

/* Another sheet a SHEET call reads: its name as a chip, the field read there in the same colour. */
.tabula-formula-sheet {
	padding: 1px 6px;
	border-radius: var(--tabula-radius-small);
	background: var(--tabula-sheet-bg);
	color: var(--tabula-sheet);
	font-weight: 600;
}

.tabula-formula-sheet-field {
	color: var(--tabula-sheet);
	font-weight: 600;
}

.tabula-formula-value[readonly] {
	color: var(--tabula-readonly-fg);
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

@media (prefers-reduced-motion: reduce) {
	.tabula-formula-address,
	.tabula-formula-value {
		transition: none;
	}
}
</style>
