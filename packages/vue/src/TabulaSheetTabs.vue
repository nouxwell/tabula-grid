<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, type PropType } from "vue"
import { TABS_TEXT, type GridLocale } from "./messages.js"
import type { GridTheme, SheetAddOption, SheetTab } from "./types.js"

/**
 * A workbook's sheets as tabs under the sheet, as a spreadsheet has them: one open, each with its
 * errors counted or a tick once processed, and + to add one, or to choose how from `addOptions`. A
 * double click or F2 renames a tab in
 * place; a right click opens its menu: rename, duplicate, move left or right, delete. A tab is
 * dragged to another place, or moved with Ctrl+Shift and an arrow. Arrows move between the tabs,
 * Enter or Space opens one.
 *
 * The tabs only say what the user asked for; the host keeps the workbook and does it.
 */
const props = defineProps({
	tabs: { type: Array as PropType<readonly SheetTab[]>, required: true },
	/** No tab is opened, added or changed meanwhile, such as while a run is under way. */
	disabled: { type: Boolean, default: false },
	locale: { type: String as PropType<GridLocale>, default: "tr" },
	theme: { type: String as PropType<GridTheme>, default: "light" },
	/**
	 * Ways to add a sheet, such as from the server's rows or empty: + then opens a menu of them, and
	 * `add` is emitted with the key chosen. Left empty, + emits `add` at once.
	 */
	addOptions: { type: Array as PropType<readonly SheetAddOption[]>, default: () => [] }
})

const emit = defineEmits<{
	/** + was pressed, or one of `addOptions` chosen, by its key. */
	add: [key?: string]
	rename: [id: string, name: string]
	duplicate: [id: string]
	remove: [id: string]
	/** The tab moved to place `to`, counted among the others: 0 first. */
	move: [id: string, to: number]
}>()

/** The open tab, by its id. */
const active = defineModel<string>("active", { required: true })

const text = computed(() => TABS_TEXT[props.locale])
const list = ref<HTMLElement | null>(null)
/** The tab being renamed, and what is typed. */
const renaming = ref<string | null>(null)
const draftName = ref("")
const menu = ref<{ readonly id: string; readonly left: number; readonly top: number } | null>(null)
/** The menu + opens when there are `addOptions`, placed above it. */
const addMenu = ref<{ readonly left: number; readonly top: number } | null>(null)
const addButton = ref<HTMLButtonElement | null>(null)
let stopMenu: (() => void) | null = null

function open(id: string): void {
	if (!props.disabled && id !== active.value) {
		active.value = id
	}
}

function startRename(id: string): void {
	const tab = props.tabs.find(each => each.id === id)

	if (props.disabled || !tab) {
		return
	}

	closeMenu()
	renaming.value = id
	draftName.value = tab.name
	void nextTick(() => {
		const input = list.value?.querySelector<HTMLInputElement>(".tabula-tabs-rename")

		input?.focus()
		input?.select()
	})
}

/** Writes the name typed; an empty one, or the same one, changes nothing. */
function commitRename(): void {
	const id = renaming.value
	const name = draftName.value.trim()
	const tab = props.tabs.find(each => each.id === id)

	renaming.value = null

	if (id !== null && tab && name !== "" && name !== tab.name) {
		emit("rename", id, name)
	}

	focusTab(id)
}

function cancelRename(): void {
	const id = renaming.value

	renaming.value = null
	focusTab(id)
}

function focusTab(id: string | null): void {
	void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-tab="${id ?? active.value}"]`)?.focus())
}

function onTabKeydown(event: KeyboardEvent, id: string): void {
	const at = props.tabs.findIndex(tab => tab.id === id)
	const mod = event.ctrlKey || event.metaKey

	if (mod && event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
		moveBy(id, event.key === "ArrowRight" ? 1 : -1)
	} else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
		const next = props.tabs[(at + (event.key === "ArrowRight" ? 1 : -1) + props.tabs.length) % props.tabs.length]

		focusTab(next?.id ?? null)
	} else if (event.key === "Home" || event.key === "End") {
		focusTab((event.key === "Home" ? props.tabs[0] : props.tabs[props.tabs.length - 1])?.id ?? null)
	} else if (event.key === "Enter" || event.key === " ") {
		open(id)
	} else if (event.key === "F2") {
		startRename(id)
	} else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect()

		openMenu(id, box.left, box.top)
	} else {
		return
	}

	event.preventDefault()
}

/** One place left or right, kept on the tab; nothing past either end. */
function moveBy(id: string, by: -1 | 1): void {
	const at = props.tabs.findIndex(tab => tab.id === id)
	const to = at + by

	if (!props.disabled && at >= 0 && to >= 0 && to < props.tabs.length) {
		emit("move", id, to)
		focusTab(id)
	}
}

// ---------------------------------------------------------------- dragging

/**
 * A tab being dragged: where it was, and where it would land, counted among the others. It is a
 * drag once the pointer has gone a few pixels; a shorter press is a click.
 */
const drag = ref<{ readonly id: string; readonly from: number; readonly to: number; readonly moved: boolean } | null>(
	null
)
let stopDrag: (() => void) | null = null
/** A drag just ended: the click it ends with opens nothing. */
let dragged = false

function onPointerDown(event: PointerEvent, id: string): void {
	if (event.button !== 0 || props.disabled || renaming.value !== null || props.tabs.length < 2) {
		return
	}

	const from = props.tabs.findIndex(tab => tab.id === id)
	const startX = event.clientX

	drag.value = { id, from, to: from, moved: false }

	const move = (moving: PointerEvent): void => {
		const current = drag.value

		if (current && (current.moved || Math.abs(moving.clientX - startX) >= 5)) {
			drag.value = { ...current, moved: true, to: dropAt(moving.clientX, current.from) }
		}
	}
	const up = (): void => {
		const current = drag.value

		endDrag()

		if (current?.moved) {
			dragged = true
			setTimeout(() => (dragged = false), 0)

			if (current.to !== current.from) {
				emit("move", current.id, current.to)
			}
		}
	}
	const escape = (key: KeyboardEvent): void => {
		if (key.key === "Escape") {
			key.preventDefault()
			endDrag()
		}
	}

	window.addEventListener("pointermove", move)
	window.addEventListener("pointerup", up)
	// A touch the browser took for scrolling ends the drag where it began.
	window.addEventListener("pointercancel", endDrag)
	window.addEventListener("keydown", escape, true)
	stopDrag = () => {
		window.removeEventListener("pointermove", move)
		window.removeEventListener("pointerup", up)
		window.removeEventListener("pointercancel", endDrag)
		window.removeEventListener("keydown", escape, true)
	}
}

onBeforeUnmount(endDrag)
onBeforeUnmount(closeMenu)

function endDrag(): void {
	stopDrag?.()
	stopDrag = null
	drag.value = null
}

/** Where a tab dropped at `x` lands, counted among the others: before the first tab whose middle is past it. */
function dropAt(x: number, from: number): number {
	const tabs = [...(list.value?.querySelectorAll<HTMLElement>(".tabula-tabs-tab") ?? [])]
	let slot = tabs.length

	for (const [index, element] of tabs.entries()) {
		const box = element.getBoundingClientRect()

		if (x < box.left + box.width / 2) {
			slot = index
			break
		}
	}

	return slot > from ? slot - 1 : slot
}

/** The line where the dragged tab would land: before this tab, or after the last. */
function dropClass(index: number): string | undefined {
	const current = drag.value

	if (!current?.moved || current.to === current.from) {
		return undefined
	}

	const slot = current.to > current.from ? current.to + 1 : current.to

	if (slot === index) {
		return "is-drop-before"
	}

	return slot === props.tabs.length && index === props.tabs.length - 1 ? "is-drop-after" : undefined
}

function onTabClick(id: string): void {
	if (!dragged) {
		open(id)
	}
}

function onContextMenu(event: MouseEvent, id: string): void {
	event.preventDefault()
	openMenu(id, event.clientX, event.clientY)
}

/** The tab's menu, above the point: the tabs sit at the bottom of the page. */
function openMenu(id: string, x: number, y: number): void {
	if (props.disabled) {
		return
	}

	closeMenu()
	menu.value = { id, left: x, top: y }

	const close = (down: MouseEvent): void => {
		if (!(down.target instanceof Element && down.target.closest(".tabula-tabs-menu"))) {
			closeMenu()
		}
	}

	window.addEventListener("mousedown", close, true)
	stopMenu = () => window.removeEventListener("mousedown", close, true)
	void nextTick(() => {
		const element = list.value?.parentElement?.querySelector<HTMLElement>(".tabula-tabs-menu")

		if (!element || !menu.value) {
			return
		}

		// Placed above the point, and kept on screen.
		const left = Math.max(8, Math.min(menu.value.left, window.innerWidth - element.offsetWidth - 8))
		const top = Math.max(8, menu.value.top - element.offsetHeight - 4)

		menu.value = { ...menu.value, left, top }
		element.querySelector<HTMLElement>("button")?.focus()
	})
}

function closeMenu(): void {
	stopMenu?.()
	stopMenu = null
	menu.value = null
	addMenu.value = null
}

/** + pressed: a sheet added at once, or the ways to add one offered above the button. */
function onAdd(): void {
	if (props.disabled) {
		return
	}

	if (props.addOptions.length === 0) {
		emit("add")

		return
	}

	if (addMenu.value) {
		closeMenu()

		return
	}

	const button = addButton.value?.getBoundingClientRect()

	closeMenu()
	addMenu.value = { left: button?.left ?? 0, top: button?.top ?? 0 }

	const close = (down: MouseEvent): void => {
		const target = down.target instanceof Element ? down.target : null

		if (!target?.closest(".tabula-tabs-menu") && !target?.closest(".tabula-tabs-add")) {
			closeMenu()
		}
	}

	window.addEventListener("mousedown", close, true)
	stopMenu = () => window.removeEventListener("mousedown", close, true)
	void nextTick(() => {
		const element = list.value?.parentElement?.querySelector<HTMLElement>(".tabula-tabs-menu.is-add")

		if (!element || !addMenu.value) {
			return
		}

		const left = Math.max(8, Math.min(addMenu.value.left, window.innerWidth - element.offsetWidth - 8))
		const top = Math.max(8, addMenu.value.top - element.offsetHeight - 4)

		addMenu.value = { left, top }
		element.querySelector<HTMLElement>("button")?.focus()
	})
}

function chooseAdd(key: string): void {
	closeMenu()
	emit("add", key)
}

function onAddMenuKeydown(event: KeyboardEvent): void {
	const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button")]
	const at = items.indexOf(document.activeElement as HTMLButtonElement)

	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
	} else if (event.key === "Escape" || event.key === "Tab") {
		closeMenu()
		addButton.value?.focus()
	} else {
		return
	}

	event.preventDefault()
}

function choose(action: "rename" | "duplicate" | "remove" | "left" | "right"): void {
	const id = menu.value?.id

	closeMenu()

	if (!id) {
		return
	}

	if (action === "rename") {
		startRename(id)
	} else if (action === "duplicate") {
		emit("duplicate", id)
	} else if (action === "left" || action === "right") {
		moveBy(id, action === "right" ? 1 : -1)
	} else {
		emit("remove", id)
	}
}

function onMenuKeydown(event: KeyboardEvent): void {
	const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
	const at = items.indexOf(document.activeElement as HTMLButtonElement)

	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
	} else if (event.key === "Escape" || event.key === "Tab") {
		const id = menu.value?.id ?? null

		closeMenu()
		focusTab(id)
	} else {
		return
	}

	event.preventDefault()
}

/** Where the tab whose menu is open stands. */
const menuAt = computed(() => (menu.value ? props.tabs.findIndex(tab => tab.id === menu.value?.id) : -1))

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

function moveKeys(arrow: string): string {
	return MAC ? `⌘⇧${arrow}` : `Ctrl+Shift+${arrow}`
}

function errorsText(count: number): string {
	return (text.value.errors ?? "").replace("{n}", String(count))
}
</script>

<template>
	<div class="tabula-tabs tabula-theme" :data-tabula-theme="theme" :class="{ 'is-disabled': disabled }">
		<div ref="list" class="tabula-tabs-list" role="tablist" :aria-label="text.sheets">
			<div
				v-for="(tab, index) in tabs"
				:key="tab.id"
				class="tabula-tabs-tab"
				:class="[
					{ 'is-active': tab.id === active, 'is-dragging': drag?.moved && drag.id === tab.id },
					dropClass(index)
				]"
				role="tab"
				:data-tab="tab.id"
				:aria-selected="tab.id === active"
				:aria-disabled="disabled || undefined"
				:tabindex="tab.id === active ? 0 : -1"
				@click="onTabClick(tab.id)"
				@pointerdown="onPointerDown($event, tab.id)"
				@dblclick="startRename(tab.id)"
				@keydown="onTabKeydown($event, tab.id)"
				@contextmenu="onContextMenu($event, tab.id)"
			>
				<input
					v-if="renaming === tab.id"
					v-model="draftName"
					class="tabula-tabs-rename"
					type="text"
					maxlength="60"
					:aria-label="text.name"
					@keydown.enter.prevent="commitRename"
					@keydown.escape.prevent="cancelRename"
					@keydown.stop
					@blur="commitRename"
					@click.stop
				/>
				<span v-else class="tabula-tabs-name" v-text="tab.name" />
				<span
					v-if="(tab.errors ?? 0) > 0"
					class="tabula-tabs-badge is-error"
					:title="errorsText(tab.errors ?? 0)"
					:aria-label="errorsText(tab.errors ?? 0)"
					v-text="tab.errors"
				/>
				<span
					v-else-if="tab.done"
					class="tabula-tabs-badge is-done"
					:title="text.done"
					:aria-label="text.done"
					v-text="'✓'"
				/>
			</div>
		</div>
		<button
			ref="addButton"
			type="button"
			class="tabula-tabs-add"
			:aria-label="text.add"
			:title="text.add"
			:aria-haspopup="addOptions.length > 0 ? 'menu' : undefined"
			:aria-expanded="addOptions.length > 0 ? addMenu !== null : undefined"
			:disabled="disabled"
			@click="onAdd"
		>
			+
		</button>
		<div
			v-if="addMenu"
			class="tabula-tabs-menu is-add"
			role="menu"
			:aria-label="text.add"
			:style="{ left: `${addMenu.left}px`, top: `${addMenu.top}px` }"
			@keydown="onAddMenuKeydown"
			@contextmenu.prevent
		>
			<button
				v-for="option in addOptions"
				:key="option.key"
				type="button"
				role="menuitem"
				@click="chooseAdd(option.key)"
			>
				<span class="tabula-tabs-option">
					<span v-text="option.label" />
					<span v-if="option.description" class="tabula-tabs-key" v-text="option.description" />
				</span>
			</button>
		</div>
		<div
			v-if="menu"
			class="tabula-tabs-menu"
			role="menu"
			:aria-label="text.menu"
			:style="{ left: `${menu.left}px`, top: `${menu.top}px` }"
			@keydown="onMenuKeydown"
			@contextmenu.prevent
		>
			<button type="button" role="menuitem" @click="choose('rename')">
				<span v-text="text.rename" />
				<span class="tabula-tabs-key" v-text="`F2 · ${text.doubleClick}`" />
			</button>
			<button type="button" role="menuitem" @click="choose('duplicate')" v-text="text.duplicate" />
			<button type="button" role="menuitem" :disabled="menuAt <= 0" @click="choose('left')">
				<span v-text="text.moveLeft" />
				<span class="tabula-tabs-key" v-text="moveKeys('←')" />
			</button>
			<button type="button" role="menuitem" :disabled="menuAt >= tabs.length - 1" @click="choose('right')">
				<span v-text="text.moveRight" />
				<span class="tabula-tabs-key" v-text="moveKeys('→')" />
			</button>
			<span class="tabula-tabs-line" role="separator" />
			<button
				type="button"
				role="menuitem"
				class="is-danger"
				:disabled="tabs.length <= 1"
				@click="choose('remove')"
				v-text="text.remove"
			/>
		</div>
	</div>
</template>

<style src="./theme.css"></style>

<style>
.tabula-tabs {
	display: flex;
	align-items: stretch;
	min-width: 0;
	height: 36px;
	color: var(--tabula-muted);
	font-size: var(--tabula-font-size);
}

.tabula-tabs-list {
	display: flex;
	gap: 2px;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;
}

.tabula-tabs-list::-webkit-scrollbar {
	display: none;
}

.tabula-tabs-tab {
	display: flex;
	flex: none;
	gap: 8px;
	align-items: center;
	padding: 0 14px;
	border: 1px solid transparent;
	border-top: 0;
	border-radius: 0 0 var(--tabula-radius) var(--tabula-radius);
	cursor: pointer;
	white-space: nowrap;
	user-select: none;
}

/* A tab being dragged, and the line where it would land. */
.tabula-tabs-tab.is-dragging {
	opacity: 0.55;
}

.tabula-tabs-tab.is-drop-before {
	box-shadow: inset 2px 0 0 var(--tabula-accent);
}

.tabula-tabs-tab.is-drop-after {
	box-shadow: inset -2px 0 0 var(--tabula-accent);
}

.tabula-tabs-tab:hover {
	background: var(--tabula-hover-bg);
	color: var(--tabula-fg);
}

.tabula-tabs-tab.is-active {
	border-color: var(--tabula-head-line);
	background: var(--tabula-bg);
	box-shadow: inset 0 -2px 0 var(--tabula-accent);
	color: var(--tabula-fg);
	font-weight: 600;
}

.tabula-tabs-tab:focus-visible,
.tabula-tabs-add:focus-visible {
	outline: 2px solid var(--tabula-accent);
	outline-offset: -2px;
}

.tabula-tabs.is-disabled .tabula-tabs-tab:not(.is-active) {
	cursor: default;
	opacity: 0.6;
}

.tabula-tabs-rename {
	width: 14ch;
	height: 24px;
	padding: 0 6px;
	border: 1px solid var(--tabula-accent);
	border-radius: var(--tabula-radius-small);
	outline: none;
	background: var(--tabula-bg);
	color: var(--tabula-fg);
	font: inherit;
	font-weight: 600;
}

.tabula-tabs-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	min-width: 18px;
	height: 18px;
	padding: 0 5px;
	border-radius: 999px;
	font-size: 0.85em;
	font-weight: 700;
}

.tabula-tabs-badge.is-error {
	background: var(--tabula-issues-error-bg);
	color: var(--tabula-issues-error);
}

.tabula-tabs-badge.is-done {
	background: var(--tabula-success-bg);
	color: var(--tabula-accent-text);
}

.tabula-tabs-add {
	flex: none;
	width: 36px;
	border: 0;
	background: transparent;
	color: var(--tabula-accent-text);
	font: inherit;
	font-size: 1.4em;
	line-height: 1;
	cursor: pointer;
}

.tabula-tabs-add:disabled {
	color: var(--tabula-muted);
	cursor: default;
}

.tabula-tabs-menu {
	animation: tabula-tabs-rise 0.14s ease-out;
	position: fixed;
	z-index: 1000;
	display: flex;
	flex-direction: column;
	min-width: 220px;
	padding: 3px 0;
	border: 1px solid var(--tabula-head-line);
	border-radius: var(--tabula-radius);
	background: var(--tabula-bg);
	box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
}

.tabula-tabs-menu button {
	display: flex;
	gap: 24px;
	justify-content: space-between;
	padding: 6px 12px;
	border: 0;
	background: transparent;
	color: var(--tabula-fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.tabula-tabs-menu button:hover,
.tabula-tabs-menu button:focus-visible {
	outline: none;
	background: var(--tabula-range-bg);
}

.tabula-tabs-menu button:disabled {
	color: var(--tabula-muted);
	cursor: default;
}

.tabula-tabs-menu button.is-danger:not(:disabled) {
	color: var(--tabula-required);
}

/* The tabs sit at the bottom: their menus rise into place. */
@keyframes tabula-tabs-rise {
	from {
		opacity: 0;
		transform: translateY(4px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@media (prefers-reduced-motion: reduce) {
	.tabula-tabs-menu {
		animation: none;
	}
}

.tabula-tabs-key {
	color: var(--tabula-muted);
	font-size: 0.9em;
}

.tabula-tabs-menu.is-add {
	max-width: 320px;
}

.tabula-tabs-menu.is-add button {
	padding: 8px 12px;
}

.tabula-tabs-option {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.tabula-tabs-line {
	height: 1px;
	margin: 3px 0;
	background: var(--tabula-line);
}
</style>
