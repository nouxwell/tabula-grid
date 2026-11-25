<script setup lang="ts">
import type { PropType } from "vue"
import type { EntryColumn, EntryHelp, EntryResult } from "./formulaEntry.js"
import { GRID_TEXT, type GridLocale } from "./messages.js"

/**
 * What helps a formula typed into a cell or the formula bar along: the call's arguments with the one
 * being written in bold, the fields and functions to complete what is typed, and on a touch screen
 * buttons for the fields and the signs its keyboard hides. Docked, as over a phone's keyboard, it
 * says the result too. Nothing here takes focus: a press inserts and leaves the keyboard where it is.
 */
const props = defineProps({
	help: { type: Object as PropType<EntryHelp | null>, default: null },
	/** The list is shown: there is something to complete and Escape has not closed it. */
	listOpen: { type: Boolean, default: false },
	highlighted: { type: Number, default: 0 },
	listId: { type: String, required: true },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	/** Buttons for the fields and signs, for a keyboard that hides them; none without columns. */
	buttons: { type: Array as PropType<readonly EntryColumn[]>, default: () => [] },
	comma: { type: Boolean, default: true },
	/** The result, said in the panel when it is docked. */
	result: { type: Object as PropType<EntryResult | null>, default: null }
})

const emit = defineEmits<{
	/** A suggestion was chosen, by its place in the list. */
	pick: [index: number]
	hover: [index: number]
	/** Text to put at the caret: a field or a sign. */
	insert: [text: string]
}>()

const SIGNS = ["*", "/", "+", "-", "(", ")"]

function signs(): string[] {
	return [...SIGNS, props.comma ? ";" : ","]
}
</script>

<template>
	<div class="tabula-formula-help" @mousedown.prevent @pointerdown.prevent>
		<p v-if="result" class="tabula-formula-help-result" :class="{ 'is-bad': !result.ok }" role="status">
			{{ result.ok ? `= ${result.text}` : result.text }}
		</p>
		<div v-if="help?.hint" class="tabula-formula-help-hint" aria-live="polite">
			<span>
				<span
					v-for="(part, at) in help.hint.parts"
					:key="at"
					:class="{ 'is-current': part.current }"
					v-text="part.text"
				/>
			</span>
			<span class="tabula-formula-help-muted" v-text="help.hint.text" />
		</div>
		<ul
			v-if="listOpen && help"
			:id="listId"
			class="tabula-formula-help-list"
			role="listbox"
			:aria-label="help.title"
		>
			<li class="tabula-formula-help-title" role="presentation" v-text="help.title" />
			<li
				v-for="(item, index) in help.items"
				:id="`${listId}-${index}`"
				:key="`${item.insert}-${index}`"
				role="option"
				:aria-selected="index === highlighted"
				class="tabula-formula-help-item"
				:class="{ 'is-active': index === highlighted }"
				@click="emit('pick', index)"
				@mousemove="emit('hover', index)"
			>
				<span v-if="item.letter" class="tabula-formula-help-letter" aria-hidden="true" v-text="item.letter" />
				<span class="tabula-formula-help-label" :class="{ 'is-function': !item.letter }" v-text="item.label" />
				<span class="tabula-formula-help-muted" v-text="item.detail" />
			</li>
			<li class="tabula-formula-help-keys" role="presentation" v-text="GRID_TEXT[locale].formulaKeys" />
		</ul>
		<div v-if="buttons.length > 0" class="tabula-formula-help-buttons">
			<button
				v-for="column in buttons"
				:key="column.key"
				type="button"
				class="tabula-formula-help-button is-field"
				tabindex="-1"
				@click="emit('insert', `[${column.label}]`)"
			>
				<span class="tabula-formula-help-letter" aria-hidden="true" v-text="column.letter" />
				{{ column.label }}
			</button>
			<button
				v-for="sign in signs()"
				:key="sign"
				type="button"
				class="tabula-formula-help-button is-sign"
				tabindex="-1"
				@click="emit('insert', sign)"
				v-text="sign"
			/>
		</div>
	</div>
</template>

<style>
.tabula-formula-help {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-width: min(420px, calc(100vw - 32px));
	font-size: var(--tabula-font-size);
}

.tabula-formula-help-result {
	align-self: flex-start;
	margin: 0;
	padding: 4px 10px;
	border-radius: var(--tabula-radius);
	background: color-mix(in srgb, var(--tabula-fg) 88%, var(--tabula-bg));
	color: var(--tabula-bg);
	font-variant-numeric: tabular-nums;
}

.tabula-formula-help-result.is-bad {
	background: var(--tabula-error-bg);
	color: var(--tabula-required);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tabula-error) 40%, var(--tabula-bg));
}

.tabula-formula-help-hint {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 7px 10px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg-alt);
	color: var(--tabula-fg);
	box-shadow: 0 8px 20px rgba(16, 19, 24, 0.1);
}

.tabula-formula-help-hint .is-current {
	font-weight: 700;
	text-decoration: underline;
}

.tabula-formula-help-muted {
	color: var(--tabula-muted);
	font-size: 0.92em;
}

.tabula-formula-help-list {
	margin: 0;
	padding: 4px;
	list-style: none;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	box-shadow: 0 10px 28px rgba(16, 19, 24, 0.14);
}

.tabula-formula-help-title {
	padding: 5px 10px 3px;
	color: var(--tabula-muted);
	font-size: 0.8em;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.tabula-formula-help-item {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 6px 10px;
	border-radius: var(--tabula-radius-small);
	cursor: pointer;
	transition: background-color 0.12s ease;
}

.tabula-formula-help-item.is-active {
	background: var(--tabula-range-bg);
	box-shadow: inset 2px 0 0 var(--tabula-accent);
}

.tabula-formula-help-letter {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 18px;
	height: 18px;
	padding: 0 3px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius-small);
	color: var(--tabula-muted);
	font-size: 0.8em;
}

.tabula-formula-help-label {
	flex: 1;
	font-weight: 600;
}

.tabula-formula-help-label.is-function {
	font-weight: 500;
	letter-spacing: 0.02em;
}

.tabula-formula-help-keys {
	margin-top: 2px;
	padding: 5px 10px 3px;
	border-top: 1px solid var(--tabula-line);
	color: var(--tabula-muted);
	font-size: 0.85em;
}

.tabula-formula-help-buttons {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

/* For a finger: at least 44px, as a phone's own keys. */
.tabula-formula-help-button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	min-width: 44px;
	min-height: 44px;
	padding: 0 12px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	font: inherit;
	cursor: pointer;
	transition:
		background-color 0.12s ease,
		transform 0.12s ease;
}

.tabula-formula-help-button:active {
	background: var(--tabula-hover-bg);
	transform: scale(0.96);
}

.tabula-formula-help-button.is-field {
	color: var(--tabula-accent-text);
	font-weight: 600;
}

.tabula-formula-help-button.is-sign {
	font-weight: 600;
}
</style>
