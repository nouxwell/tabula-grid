<template>
	<div ref="box" class="relative flex flex-col gap-1.5">
		<!-- The call the caret is in: its arguments, the one being written in bold, and what it does. -->
		<div
			v-if="hint"
			class="flex flex-col gap-0.5 rounded-app border border-divider bg-surface-alt px-2.5 py-1.5 text-xs"
			aria-live="polite"
		>
			<span class="font-mono">
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
			class="font-mono"
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
			@blur="focused = false"
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
				{{ context.token?.kind === "field" ? "Alanlar" : "Fonksiyonlar" }}
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
				<span :class="item.mono ? 'font-mono font-medium' : 'font-semibold'">{{ item.label }}</span>
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
 * A formula field that helps as it is written: after "[" it lists the fields by their labels, on a
 * letter the functions that start with it, and above it the call the caret is in, with the argument
 * being written in bold and what the function does. Fields are written by their labels here; the
 * form turns them into keys when it saves.
 */
import { FORMULA_FUNCTIONS, formulaCaret } from "@nouxwell/tabula-core"
import { functionHelp, type GridLocale } from "@nouxwell/tabula-vue"

const text = defineModel<string>({ required: true })

const props = withDefaults(
	defineProps<{
		/** The fields a formula may read, with a word for their kind. */
		fields: readonly { readonly key: string; readonly label: string; readonly kind: string }[]
		locale?: GridLocale
		inputId?: string
		placeholder?: string
	}>(),
	{ locale: "tr", inputId: undefined, placeholder: "ROUND([Aralık fiyatı] * 1.2, 2)" }
)

const box = ref<HTMLElement | null>(null)
const listId = useId()
const caret = ref(0)
const focused = ref(false)
const highlighted = ref(0)
/** Escape closes the list until something else is typed. */
const dismissed = ref(false)

const context = computed(() => formulaCaret(text.value, caret.value))

/** Folded as a Turkish reader folds: "I" is "ı", "İ" is "i". */
function fold(value: string): string {
	return value.toLocaleLowerCase("tr")
}

const suggestions = computed(() => {
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
					insert: `[${field.label}]`,
					mono: false
				}))
		)
	}

	const prefix = token.query.toUpperCase()

	return FORMULA_FUNCTIONS.filter(name => name.startsWith(prefix) && name !== prefix)
		.slice(0, 8)
		.map(name => ({
			label: name,
			detail: functionHelp(name, props.locale)?.short ?? "",
			kind: "",
			insert: `${name}(`,
			mono: true
		}))
})

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
	const token = context.value.token

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
