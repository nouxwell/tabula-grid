<template>
	<div ref="box" class="relative flex flex-col gap-1.5">
		<!-- The call the caret is in: its arguments, the one being written in bold, and what it does. -->
		<div
			v-if="hint"
			class="flex flex-col gap-0.5 rounded-app border border-divider bg-surface-alt px-2.5 py-1.5 text-xs"
			aria-live="polite"
		>
			<span>
				<span
					v-for="(part, index) in hint.parts"
					:key="index"
					:class="part.current ? 'font-bold underline' : ''"
					v-text="part.text"
				/>
			</span>
			<span class="text-muted">{{ hint.text }}</span>
		</div>

		<AppInput
			:value="text"
			size="small"
			:placeholder="placeholder"
			:input-props="{
				id: inputId,
				role: 'combobox',
				'aria-autocomplete': 'list',
				'aria-expanded': open,
				'aria-controls': listId,
				'aria-activedescendant': open ? `${listId}-${highlighted}` : undefined
			}"
			@update:value="typed"
			@keydown="keydown"
			@click="follow"
			@keyup="follow"
			@focus="focused = true"
			@blur="settle"
		/>

		<ul
			v-if="open"
			:id="listId"
			role="listbox"
			class="absolute top-full right-0 left-0 z-10 m-0 mt-1 list-none overflow-hidden rounded-app border border-divider bg-surface p-0 shadow-lg"
		>
			<li
				class="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase"
				role="presentation"
			>
				{{ listTitle }}
			</li>
			<li
				v-for="(item, index) in suggestions"
				:id="`${listId}-${index}`"
				:key="item.insert"
				role="option"
				:aria-selected="index === highlighted"
				class="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm"
				:class="index === highlighted ? 'bg-primary/10 shadow-[inset_2px_0_0_var(--app-primary)]' : ''"
				@mousedown.prevent="insert(index)"
				@mousemove="highlighted = index"
			>
				<span
					v-if="item.letter"
					class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-divider px-1 text-xs text-muted"
					aria-hidden="true"
				>
					{{ item.letter }}
				</span>
				<AppIcon v-else-if="item.sheet" name="table" class="size-4 flex-none text-sheet" aria-hidden="true" />
				<span :class="item.mono ? 'font-medium tabular-nums' : 'font-semibold'">{{ item.label }}</span>
				<span class="text-xs text-muted">{{ item.detail }}</span>
				<span v-if="item.kind" class="ml-auto text-xs text-muted">{{ item.kind }}</span>
			</li>
			<li class="border-t border-divider px-3 py-1.5 text-xs text-muted" role="presentation">
				↑↓ seç · Enter ya da Tab ekler · Esc kapatır
			</li>
		</ul>
	</div>
</template>

<script setup lang="ts">
/**
 * A formula field that helps as it is written: after "[" it lists the fields by their labels, each
 * with its column's letter, on a letter the functions that start with it, and above it the call the
 * caret is in, with the argument being written in bold and what the function does. Fields are
 * written by their labels here; the form turns them into keys when it saves.
 *
 * An address, "D" or "D2", reads this row's column D: the list offers that column first, and leaving
 * the field writes every address as its field's label, so moving a column changes nothing.
 *
 * In SHEET's first place it lists the workbook's sheets, with how many products each holds; one
 * picked is written in quotes, and the list of fields follows for the field read there.
 */
import { FORMULA_FUNCTIONS, formulaCaret, formulaFromAddresses } from "@nouxwell/tabula-core"
import { functionHelp, type GridLocale } from "@nouxwell/tabula-vue"
import { columnsByLetter } from "~/utils/columns"

const text = defineModel<string>({ required: true })

const props = withDefaults(
	defineProps<{
		/** The fields a formula may read, with a word for their kind and their column's letter on screen. */
		fields: readonly {
			readonly key: string
			readonly label: string
			readonly kind: string
			readonly letter?: string | null
		}[]
		/** The workbook's sheets, for SHEET's first argument, with how many products each holds. */
		sheets?: readonly { readonly name: string; readonly rows: number }[]
		locale?: GridLocale
		inputId?: string
		placeholder?: string
	}>(),
	{ sheets: () => [], locale: "tr", inputId: undefined, placeholder: "ROUND([Aralık fiyatı] * 1.2, 2)" }
)

const box = ref<HTMLElement | null>(null)
const listId = useId()
const caret = ref(0)
const focused = ref(false)
const highlighted = ref(0)
/** Escape closes the list until something else is typed. */
const dismissed = ref(false)

const context = computed(() => formulaCaret(text.value, caret.value))

/** A sheet's name as SHEET's first argument is written: after its "(", or inside its quotes. */
const SHEET_NAME = /SHEET\s*\(\s*("(?:[^"]|"")*)?$/i
/** The sheet a SHEET call names, when its field is being written: "Mart" in SHEET("Mart"; [Ye. */
const SHEET_FIELD = /SHEET\s*\(\s*"((?:[^"]|"")*)"\s*[;,]\s*\[[^\]]*$/i

/** SHEET's first argument being written, to complete with a sheet's name: what is typed and what it replaces. */
const sheetToken = computed(() => {
	if (props.sheets.length === 0) {
		return null
	}

	const match = SHEET_NAME.exec(text.value.slice(0, caret.value))

	if (!match) {
		return null
	}

	const quoted = match[1] ?? ""
	// The rest of a name already written goes too, to its closing quote.
	const rest = quoted === "" ? "" : (/^(?:[^"]|"")*"?/.exec(text.value.slice(caret.value))?.[0] ?? "")

	return {
		query: quoted.slice(1).replaceAll('""', '"'),
		start: caret.value - quoted.length,
		end: caret.value + rest.length
	}
})

/** The sheet whose field is being written, in SHEET's second place; null anywhere else. */
const sheetOfField = computed(() => {
	const match = context.value.token?.kind === "field" ? SHEET_FIELD.exec(text.value.slice(0, caret.value)) : null

	return match ? (match[1] ?? "").replaceAll('""', '"') : null
})

/** What a suggestion takes the place of: a sheet's name, a field, or a function's name. */
const replacing = computed(() => sheetToken.value ?? context.value.token)

const listTitle = computed(() => {
	if (sheetToken.value) {
		return "Sayfalar"
	}

	if (context.value.token?.kind === "field") {
		return sheetOfField.value === null ? "Alanlar" : `“${sheetOfField.value}” sayfasının alanları`
	}

	return suggestions.value[0]?.letter ? "Sütun ve fonksiyonlar" : "Fonksiyonlar"
})

/** Folded as a Turkish reader folds: "I" is "ı", "İ" is "i". */
function fold(value: string): string {
	return value.toLocaleLowerCase("tr")
}

const suggestions = computed(() => {
	const named = sheetToken.value

	if (named) {
		const needle = fold(named.query.trim())

		return props.sheets
			.filter(sheet => needle === "" || fold(sheet.name).includes(needle))
			.slice(0, 8)
			.map(sheet => ({
				label: sheet.name,
				detail: `${sheet.rows} ürün`,
				kind: "sayfa",
				letter: null as string | null,
				sheet: true,
				// The field read there comes next: its list opens after the "[".
				insert: `"${sheet.name.replaceAll('"', '""')}"; [`,
				mono: false
			}))
	}

	const token = context.value.token

	if (!token) {
		return []
	}

	if (token.kind === "field") {
		const needle = fold(token.query.trim())

		return (
			props.fields
				.filter(
					field => needle === "" || fold(field.label).includes(needle) || fold(field.key).includes(needle)
				)
				// Those whose label starts with what is typed first: "Ara" is Aralık fiyatı before Para birimi.
				.sort((a, b) => Number(!fold(a.label).startsWith(needle)) - Number(!fold(b.label).startsWith(needle)))
				.slice(0, 8)
				.map(field => ({
					label: field.label,
					detail: `[${field.key}]`,
					kind: field.kind,
					// Another sheet's field is not this row's column: no letter for it.
					letter: sheetOfField.value === null ? (field.letter ?? null) : null,
					sheet: false,
					insert: `[${field.label}]`,
					mono: false
				}))
		)
	}

	const prefix = token.query.toUpperCase()
	// "D" or "D2": the field of that column, in this row, before the functions.
	const address = /^([A-Z]{1,3})[0-9]*$/.exec(prefix)
	const column = address ? props.fields.find(field => field.letter === address[1]) : undefined
	const functions = FORMULA_FUNCTIONS.filter(name => name.startsWith(prefix) && name !== prefix)
		.slice(0, column ? 7 : 8)
		.map(name => ({
			label: name,
			detail: functionHelp(name, props.locale)?.short ?? "",
			kind: "",
			letter: null as string | null,
			sheet: false,
			insert: `${name}(`,
			mono: true
		}))

	return column
		? [
				{
					label: column.label,
					detail: "bu satırın hücresi",
					kind: column.kind,
					letter: column.letter ?? null,
					sheet: false,
					insert: `[${column.label}]`,
					mono: false
				},
				...functions
			]
		: functions
})

/** The fields by where their columns stand, A first, for the addresses in what is typed. */
const columns = computed(() =>
	columnsByLetter(props.fields.map(field => ({ key: field.key, label: field.label, letter: field.letter ?? null })))
)

/** Leaving the field writes each address as its field's label: what it reads, for good. */
function settle(): void {
	focused.value = false

	const settled = formulaFromAddresses(text.value, columns.value)

	if (settled !== text.value) {
		text.value = settled
	}
}

const open = computed(() => focused.value && !dismissed.value && suggestions.value.length > 0)

const hint = computed(() => {
	const call = context.value.call
	const help = call ? functionHelp(call.name, props.locale) : null

	if (!call || !help) {
		return null
	}

	const current = Math.min(call.argument, help.params.length - 1)

	// The signature in parts, so its spaces are written as they are: "ROUND(" "sayı" ", " "basamak" ")".
	const parts = [{ text: `${call.name}(`, current: false }]

	help.params.forEach((param, index) => {
		if (index > 0) {
			parts.push({ text: ", ", current: false })
		}

		parts.push({ text: param, current: index === current })
	})
	parts.push({ text: ")", current: false })

	return { parts, text: help.text }
})

watch(suggestions, () => {
	highlighted.value = 0
})

function inputOf(): HTMLInputElement | null {
	return box.value?.querySelector("input") ?? null
}

/** Where the caret is, read after every key and click: a hint follows it. */
function follow(): void {
	caret.value = inputOf()?.selectionStart ?? text.value.length
}

function typed(value: string): void {
	text.value = value
	dismissed.value = false
	void nextTick(follow)
}

/** Puts a suggestion in place of what it completes, and the caret after it. */
function insert(index: number): void {
	const item = suggestions.value[index]
	const token = replacing.value

	if (!item || !token) {
		return
	}

	const next = `${text.value.slice(0, token.start)}${item.insert}${text.value.slice(token.end)}`
	const at = token.start + item.insert.length

	text.value = next
	caret.value = at

	void nextTick(() => {
		const input = inputOf()

		input?.focus()
		input?.setSelectionRange(at, at)
	})
}

function keydown(event: KeyboardEvent): void {
	if (!open.value) {
		return
	}

	const count = suggestions.value.length

	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		highlighted.value = (highlighted.value + (event.key === "ArrowDown" ? 1 : -1) + count) % count
	} else if (event.key === "Enter" || event.key === "Tab") {
		insert(highlighted.value)
	} else if (event.key === "Escape") {
		dismissed.value = true
		// Only the list closes: the drawer the field is in stays open.
		event.stopPropagation()
	} else {
		return
	}

	event.preventDefault()
}
</script>
