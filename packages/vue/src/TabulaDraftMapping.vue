<script setup lang="ts">
import {
	formatCell,
	mapDraft,
	suggestRenames,
	VALUE_SETTINGS,
	valueProblem,
	type CellValue,
	type Draft,
	type DraftFieldMapping,
	type ModuleSchema,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { computed, toRaw, type PropType } from "vue"
import { DRAFT_TEXT, type GridLocale } from "./messages.js"
import type { GridTheme } from "./types.js"

/**
 * A draft saved under another version of the schema, before it opens: each of its fields that the
 * schema no longer has, with its first values, mapped to a new field or dropped; the fields whose
 * type changed, with how many values the new type cannot read; and the new fields, which open empty.
 * Bind `v-model:rename` and pass it to `openDraft` with `accept` once the user goes on. The host puts
 * it in a window of its own, with the buttons to open the draft or to let it go.
 */
const props = defineProps({
	draft: { type: Object as PropType<Draft>, required: true },
	/** The schema the draft would open under. */
	schema: { type: Object as PropType<ModuleSchema>, required: true },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	valueSettings: { type: Object as PropType<ValueSettings>, default: () => VALUE_SETTINGS.tr },
	theme: { type: String as PropType<GridTheme>, default: "light" }
})

/** Where the fields the schema no longer has go, by their keys in the draft; \`suggestRenames\` to start with. */
const rename = defineModel<Readonly<Record<string, string>>>("rename", { default: () => ({}) })

const text = computed(() => DRAFT_TEXT[props.locale])
const schema = computed(() => toRaw(props.schema))
const mapping = computed(() =>
	mapDraft(toRaw(props.draft), schema.value, { rename: rename.value, settings: props.valueSettings })
)
const suggested = computed(() => suggestRenames(toRaw(props.draft), schema.value))
/** The fields the schema no longer has: each to map or drop. */
const gone = computed(() => mapping.value.fields.filter(field => !schema.value.has(field.key)))
/** Fields still there under their own key, but of another type now. */
const retyped = computed(() =>
	mapping.value.fields.filter(
		field => schema.value.has(field.key) && schema.value.field(field.key).type !== field.type
	)
)
const same = computed(() =>
	mapping.value.fields.filter(
		field => schema.value.has(field.key) && schema.value.field(field.key).type === field.type
	)
)
/** The new fields no field of the draft goes to. */
const added = computed(() => mapping.value.added.map(key => schema.value.field(key)))
const draftKeys = computed(() => new Set(toRaw(props.draft).fields.map(field => field.key)))

const savedLine = computed(() => {
	const draft = toRaw(props.draft)
	const date = new Intl.DateTimeFormat(props.locale === "tr" ? "tr-TR" : "en-GB", {
		dateStyle: "long",
		timeStyle: "short"
	}).format(new Date(draft.savedAt))

	return fill(text.value.saved, {
		date,
		rows: draft.rows.length,
		from: draft.schemaVersion,
		to: schema.value.schemaVersion
	})
})

const summary = computed(() => {
	const mapped = gone.value.filter(field => field.target !== null).length
	const dropped = gone.value.length - mapped

	return [
		mapped > 0 ? fill(text.value.mapped, { n: mapped }) : "",
		dropped > 0 ? fill(text.value.dropped, { n: dropped }) : ""
	]
		.filter(Boolean)
		.join(" · ")
})

/** The new fields a field the schema lost may go to: those no other field of the draft takes already. */
function choices(field: DraftFieldMapping): { key: string; label: string }[] {
	const taken = new Set(Object.entries(rename.value).flatMap(([from, to]) => (from === field.key ? [] : [to])))

	return schema.value.fields
		.filter(candidate => !draftKeys.value.has(candidate.key) && !taken.has(candidate.key))
		.map(candidate => ({
			key: candidate.key,
			label: candidate.type === field.type ? candidate.label : `${candidate.label} (${text.value.otherType})`
		}))
}

function choose(field: DraftFieldMapping, target: string): void {
	const next: Record<string, string> = { ...rename.value }

	if (target === "") {
		delete next[field.key]
	} else {
		next[field.key] = target
	}

	rename.value = next
}

function nameOf(field: DraftFieldMapping): string {
	return field.label ?? field.key
}

function typeWord(type: string): string {
	return text.value[type] ?? type
}

/** A value of the draft as the field it goes to would show it; as it was written otherwise. */
function sample(field: DraftFieldMapping, value: CellValue): string {
	const target = field.target === null ? null : schema.value.field(field.target)

	if (target && valueProblem(target, value, props.valueSettings) === null) {
		return formatCell(target, value, props.valueSettings)
	}

	// A record, by its name.
	if (typeof value === "object" && value !== null && !Array.isArray(value) && "label" in value) {
		return String(value.label)
	}

	return Array.isArray(value) ? value.join(", ") : String(value)
}

function samples(field: DraftFieldMapping): string {
	const shown = field.samples.map(value => sample(field, value)).join(" · ")

	return field.filled > field.samples.length ? `${shown} …` : shown
}

/** Puts the values in a sentence, a count written the language's way: "1.000". */
function fill(template: string | undefined, values: Readonly<Record<string, string | number>>): string {
	const numbers = new Intl.NumberFormat(props.locale === "tr" ? "tr-TR" : "en-GB")

	return (template ?? "").replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = values[name]

		return typeof value === "number" ? numbers.format(value) : (value ?? "")
	})
}
</script>

<template>
	<section class="tabula-mapping tabula-theme" :data-tabula-theme="theme">
		<p class="tabula-mapping-saved" v-text="savedLine" />

		<div class="tabula-mapping-head" aria-hidden="true">
			<span v-text="text.fromHead" />
			<span />
			<span v-text="text.toHead" />
		</div>

		<div v-for="field in gone" :key="field.key" class="tabula-mapping-row">
			<span class="tabula-mapping-name">
				<strong v-text="nameOf(field)" />
				<span class="tabula-mapping-kind" v-text="`${typeWord(field.type)} · ${field.key}`" />
				<span v-if="field.filled > 0" class="tabula-mapping-samples" v-text="samples(field)" />
			</span>
			<span class="tabula-mapping-arrow" aria-hidden="true">→</span>
			<span class="tabula-mapping-target">
				<select
					class="tabula-mapping-select"
					:class="{
						'is-dropped': field.target === null,
						'is-suggested': field.target !== null && suggested[field.key] === field.target
					}"
					:aria-label="`${nameOf(field)}: ${text.toHead}`"
					:value="field.target ?? ''"
					@change="choose(field, ($event.target as HTMLSelectElement).value)"
				>
					<option value="" v-text="text.drop" />
					<option
						v-for="choice in choices(field)"
						:key="choice.key"
						:value="choice.key"
						v-text="choice.label"
					/>
				</select>
				<span class="tabula-mapping-notes">
					<template v-if="field.target === null">
						<span
							v-if="field.filled > 0"
							class="tabula-mapping-tag is-lost"
							v-text="fill(text.losing, { n: field.filled })"
						/>
						<span v-else class="tabula-mapping-quiet" v-text="text.noValues" />
					</template>
					<template v-else>
						<span
							v-if="suggested[field.key] === field.target"
							class="tabula-mapping-tag is-suggested"
							v-text="text.suggested"
						/>
						<span class="tabula-mapping-quiet" v-text="fill(text.moves, { n: field.filled })" />
						<span
							v-if="field.unreadable > 0"
							class="tabula-mapping-tag is-warned"
							v-text="fill(text.unreadable, { n: field.unreadable })"
						/>
					</template>
				</span>
			</span>
		</div>

		<div v-for="field in retyped" :key="field.key" class="tabula-mapping-row">
			<span class="tabula-mapping-name">
				<strong v-text="nameOf(field)" />
				<span class="tabula-mapping-kind" v-text="field.key" />
				<span v-if="field.filled > 0" class="tabula-mapping-samples" v-text="samples(field)" />
			</span>
			<span class="tabula-mapping-arrow" aria-hidden="true">→</span>
			<span class="tabula-mapping-target">
				<strong class="tabula-mapping-fixed" v-text="schema.field(field.key).label" />
				<span class="tabula-mapping-notes">
					<span
						class="tabula-mapping-tag is-warned"
						v-text="
							fill(text.retyped, {
								from: typeWord(field.type),
								to: typeWord(schema.field(field.key).type)
							})
						"
					/>
					<span
						v-if="field.unreadable > 0"
						class="tabula-mapping-quiet"
						v-text="fill(text.unreadable, { n: field.unreadable })"
					/>
				</span>
			</span>
		</div>

		<div v-for="field in added" :key="field.key" class="tabula-mapping-row">
			<span class="tabula-mapping-quiet">—</span>
			<span class="tabula-mapping-arrow" aria-hidden="true">→</span>
			<span class="tabula-mapping-target">
				<strong class="tabula-mapping-fixed" v-text="field.label" />
				<span class="tabula-mapping-notes">
					<span class="tabula-mapping-tag is-new" v-text="text.added" />
					<span class="tabula-mapping-quiet" v-text="text.addedNote" />
				</span>
			</span>
		</div>

		<p v-if="same.length > 0" class="tabula-mapping-same">
			<span class="tabula-mapping-tag" v-text="fill(text.same, { n: same.length })" />
			<span v-text="same.map(nameOf).join(', ')" />
		</p>

		<p v-if="summary" class="tabula-mapping-summary" role="status" v-text="summary" />
	</section>
</template>

<style src="./theme.css"></style>

<style>
.tabula-mapping {
	display: flex;
	flex-direction: column;
	container-type: inline-size;
	color: var(--tabula-fg);
	line-height: 1.4;
}

.tabula-mapping p {
	margin: 0;
}

.tabula-mapping-saved,
.tabula-mapping-quiet,
.tabula-mapping-kind,
.tabula-mapping-samples,
.tabula-mapping-arrow,
.tabula-mapping-summary {
	color: var(--tabula-muted);
}

.tabula-mapping-saved {
	padding-bottom: 12px;
}

.tabula-mapping-head,
.tabula-mapping-row {
	display: grid;
	grid-template-columns: minmax(0, 1.1fr) 24px minmax(0, 1fr);
	gap: 12px;
	align-items: start;
}

.tabula-mapping-head {
	padding: 6px 0;
	color: var(--tabula-muted);
	font-size: 0.92em;
	font-weight: 600;
}

.tabula-mapping-row {
	padding: 12px 0;
	border-top: 1px solid var(--tabula-line);
}

.tabula-mapping-name,
.tabula-mapping-target {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
}

.tabula-mapping-kind,
.tabula-mapping-samples {
	font-size: 0.92em;
}

.tabula-mapping-samples {
	overflow: hidden;
	font-variant-numeric: tabular-nums;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tabula-mapping-arrow {
	padding-top: 7px;
	text-align: center;
}

.tabula-mapping-select {
	box-sizing: border-box;
	width: 100%;
	height: 34px;
	padding: 0 8px;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.tabula-mapping-select.is-suggested {
	border-color: color-mix(in srgb, var(--tabula-accent) 60%, transparent);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--tabula-accent) 15%, transparent);
}

.tabula-mapping-select.is-dropped {
	color: var(--tabula-required);
}

.tabula-mapping-select:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: 1px;
}

.tabula-mapping-fixed {
	display: flex;
	align-items: center;
	min-height: 34px;
}

.tabula-mapping-notes {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 8px;
	align-items: center;
	padding-top: 3px;
	font-size: 0.92em;
}

.tabula-mapping-tag {
	display: inline-flex;
	align-items: center;
	height: 22px;
	padding: 0 8px;
	border-radius: 999px;
	background: var(--tabula-hover-bg);
	color: var(--tabula-muted);
	font-weight: 600;
	white-space: nowrap;
}

.tabula-mapping-tag.is-suggested {
	background: var(--tabula-success-bg);
	color: var(--tabula-accent-text);
}

.tabula-mapping-tag.is-lost {
	background: var(--tabula-issues-error-bg);
	color: var(--tabula-issues-error);
}

.tabula-mapping-tag.is-warned {
	background: var(--tabula-issues-warning-bg);
	color: var(--tabula-issues-warning);
	white-space: normal;
}

.tabula-mapping-tag.is-new {
	background: var(--tabula-info-bg);
	color: var(--tabula-info-text);
}

.tabula-mapping-same {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 8px;
	align-items: center;
	padding: 12px 0;
	border-top: 1px solid var(--tabula-line);
	color: var(--tabula-muted);
}

.tabula-mapping-summary {
	padding-top: 10px;
	border-top: 1px solid var(--tabula-line);
	text-align: right;
}

/* Narrow: what the draft had over where it goes. */
@container (max-width: 520px) {
	.tabula-mapping-head {
		display: none;
	}

	.tabula-mapping-row {
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
	}

	.tabula-mapping-arrow {
		display: none;
	}
}
</style>
