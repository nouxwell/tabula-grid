<template>
	<n-tooltip
		ref="tooltipRef"
		:show="show"
		:style="shiftStyle"
		:content-style="mergedContentStyle"
		:content-class="mergedContentClass"
		@update:show="onUpdateShow"
	>
		<template #trigger>
			<slot name="trigger" />
		</template>
		<slot />
	</n-tooltip>
</template>

<script setup lang="ts">
/**
 * Every hint in the application: `n-tooltip`, kept on the screen of a phone. As the CRM's.
 *
 * Naive UI flips a tooltip vertically but never slides it sideways, so a hint by an icon near the
 * edge ran off the screen. Once open, the box is measured: wider than the screen, it is capped to
 * the screen less 32px; running over an edge, it slides sideways until it is 16px from each, and
 * the arrow keeps pointing at the trigger. A call therefore never carries phone code of its own:
 * no width by screen, no placement for phones. `content-style` passed in wins over the defaults.
 */
import { NTooltip } from "naive-ui"

const props = withDefaults(
	defineProps<{
		contentStyle?: string | Record<string, string | number>
		contentClass?: string
		show?: boolean
	}>(),
	{ contentStyle: undefined, contentClass: undefined, show: undefined }
)

const VIEWPORT_GAP = 16
const MIN_CONTENT_WIDTH = 120
const DEFAULT_MAX_WIDTH = "calc(100vw - 2rem)"
const FONT_SIZE_CLASS = /(^|\s)!?text-(xs|sm|base|lg|\d*xl|\[)/

// One class per tooltip, to find its box once it is open; the same on the server and in the browser.
const fitClass = `app-tooltip-fit-${useId().replace(/[^\w-]/g, "")}`
const tooltipRef = ref<{ syncPosition: () => void } | null>(null)
const fitMaxWidth = ref<number | null>(null)
// The slide goes on Naive UI's positioning box as `margin-left`; `--v-offset-left` takes it back
// from a start or end arrow, so the arrow stays on the trigger.
const arrowShift = ref(0)
const shiftStyle = computed(() => (arrowShift.value ? { "--v-offset-left": `${arrowShift.value}px` } : undefined))

const mergedContentClass = computed(() => {
	const incoming = props.contentClass?.trim()
	const base = !incoming ? "text-sm" : FONT_SIZE_CLASS.test(incoming) ? incoming : `text-sm ${incoming}`

	return `${base} ${fitClass}`
})

const mergedContentStyle = computed<string | Record<string, string | number>>(() => {
	const incoming = props.contentStyle
	const fit = fitMaxWidth.value === null ? null : `${fitMaxWidth.value}px`

	if (incoming == null) {
		return { maxWidth: fit ?? DEFAULT_MAX_WIDTH }
	}

	if (typeof incoming === "string") {
		return `max-width:${DEFAULT_MAX_WIDTH};${incoming}${fit ? `;max-width:${fit}` : ""}`
	}

	return { maxWidth: DEFAULT_MAX_WIDTH, ...incoming, ...(fit ? { maxWidth: fit } : {}) }
})

let fitRun = 0
let shown = false
let fittedViewport = 0
let shiftedFollower: HTMLElement | null = null

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

function findElements() {
	const content = document.querySelector<HTMLElement>(`.${fitClass}`)
	const popover = content?.closest<HTMLElement>(".n-popover")
	const follower = popover?.parentElement

	return content && popover && follower ? { content, popover, follower } : null
}

function applyShift(follower: HTMLElement | null, dx: number): void {
	if (shiftedFollower && shiftedFollower !== follower) {
		shiftedFollower.style.marginLeft = ""
	}

	if (follower) {
		follower.style.marginLeft = dx ? `${dx}px` : ""
	}

	shiftedFollower = dx ? follower : null
	arrowShift.value = dx
}

async function fitToViewport(): Promise<void> {
	const run = ++fitRun

	fitMaxWidth.value = null
	applyShift(shiftedFollower, 0)
	await nextTick()
	await nextFrame()

	if (run !== fitRun) {
		return
	}

	let found = findElements()

	if (!found) {
		return
	}

	// Naive UI can place the box before its content has its final width: place it again.
	tooltipRef.value?.syncPosition()

	const viewport = document.documentElement.clientWidth
	const room = viewport - 2 * VIEWPORT_GAP

	fittedViewport = viewport

	if (found.popover.offsetWidth > room) {
		const padding = found.popover.offsetWidth - found.content.offsetWidth

		fitMaxWidth.value = Math.max(MIN_CONTENT_WIDTH, Math.floor(room - padding))
		await nextTick()
		tooltipRef.value?.syncPosition()
		await nextFrame()

		if (run !== fitRun) {
			return
		}

		found = findElements()

		if (!found) {
			return
		}
	}

	// Beside the trigger the arrow is vertical: a sideways slide would part it from the trigger.
	const placement = found.follower.getAttribute("v-placement") ?? ""

	if (placement.startsWith("left") || placement.startsWith("right")) {
		return
	}

	const left = found.follower.getBoundingClientRect().left + found.popover.offsetLeft
	const right = left + found.popover.offsetWidth
	let dx = 0

	if (left < VIEWPORT_GAP) {
		dx = VIEWPORT_GAP - left
	} else if (right > viewport - VIEWPORT_GAP) {
		dx = viewport - VIEWPORT_GAP - right
	}

	dx = Math.round(dx)
	applyShift(found.follower, dx)

	// A centred arrow does not read `--v-offset-left`: it is moved back by hand.
	const arrow = found.popover.querySelector<HTMLElement>(".n-popover-arrow")

	if (arrow) {
		arrow.style.left = dx && (placement === "top" || placement === "bottom") ? `calc(50% - ${dx}px)` : ""
	}
}

function setShown(value: boolean): void {
	shown = value

	if (value) {
		void fitToViewport()
	} else {
		fitRun++
	}
}

function onUpdateShow(value: boolean): void {
	// Shown from outside (`:show`): the watch below follows it.
	if (props.show === undefined) {
		setShown(value)
	}
}

watch(
	() => props.show,
	value => {
		if (value !== undefined) {
			setShown(value)
		}
	},
	{ immediate: true }
)

function onResize(): void {
	if (shown && document.documentElement.clientWidth !== fittedViewport) {
		void fitToViewport()
	}
}

onMounted(() => window.addEventListener("resize", onResize, { passive: true }))
onBeforeUnmount(() => window.removeEventListener("resize", onResize))
</script>
