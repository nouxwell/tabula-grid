<template>
	<div
		v-if="vertical"
		class="tabula-thumb is-vertical"
		:class="{ 'is-dragging': dragging === 'y' }"
		:style="[vertical, layer === undefined ? {} : { zIndex: layer }]"
		aria-hidden="true"
		@pointerdown="grab($event, 'y')"
		@pointermove="follow"
		@pointerup="release"
		@pointercancel="release"
		@mousedown.prevent.stop
	/>
	<div
		v-if="horizontal"
		class="tabula-thumb is-horizontal"
		:class="{ 'is-dragging': dragging === 'x' }"
		:style="[horizontal, layer === undefined ? {} : { zIndex: layer }]"
		aria-hidden="true"
		@pointerdown="grab($event, 'x')"
		@pointermove="follow"
		@pointerup="release"
		@pointercancel="release"
		@mousedown.prevent.stop
	/>
</template>

<script setup lang="ts">
/**
 * The scroll bars of an area of ours that scrolls, drawn as the IONSIS CRM's `AppScrollbar` draws
 * them: a thin rounded thumb that turns the pointer into a hand and darkens under it, and can be
 * dragged. A browser draws its own bars with the arrow whatever a page asks, so the area's own are
 * hidden (`tabula-scroll`) and these are drawn over its edges. The area still scrolls as the
 * browser scrolls it: wheel, keys, touch.
 *
 * Placed beside the area, in the same positioned parent; it follows the area's place and size.
 * `insetTop` and `insetLeft` keep the bars clear of what does not scroll, such as a sheet's header
 * and its pinned columns.
 */
import { onBeforeUnmount, shallowRef, watch, type CSSProperties } from "vue"

const props = withDefaults(
	defineProps<{
		target: HTMLElement | null
		insetTop?: number
		insetLeft?: number
		/** The bars' z-index, over an area that floats over others, such as a list of suggestions. */
		layer?: number
	}>(),
	{ insetTop: 0, insetLeft: 0, layer: undefined }
)

/** Room kept between a bar and the area's edge, and between the two bars' ends. */
const GAP = 2
/** The room one bar leaves at the end of the other, where they would meet. */
const CORNER = 9
/** A thumb never gets shorter than this, so even a sheet of 50,000 rows has one to hold. */
const SHORTEST = 24

const vertical = shallowRef<CSSProperties | null>(null)
const horizontal = shallowRef<CSSProperties | null>(null)
const dragging = shallowRef<"x" | "y" | null>(null)

let frame = 0
let resizes: ResizeObserver | null = null
let changes: MutationObserver | null = null
let grabbed: { axis: "x" | "y"; from: number; scroll: number; ratio: number } | null = null

interface Track {
	/** Where the track starts, and how long it is. */
	readonly start: number
	readonly length: number
	readonly thumb: number
	/** How far the area scrolls, and how far it has. */
	readonly range: number
	readonly at: number
}

function track(client: number, scroll: number, at: number, inset: number, end: number): Track | null {
	const range = scroll - client
	const length = client - inset - GAP * 2 - end

	if (range < 1 || length < SHORTEST) {
		return null
	}

	// What shows of the part that scrolls, over all of it: a header that stays is not part of it.
	const shown = Math.max(0, client - inset) / Math.max(1, scroll - inset)
	const thumb = Math.min(length, Math.max(SHORTEST, Math.round(length * shown)))

	return { start: inset + GAP, length, thumb, range, at }
}

let tracks: { x: Track | null; y: Track | null } = { x: null, y: null }

function measure(): void {
	frame = 0

	const area = props.target

	if (!area) {
		vertical.value = horizontal.value = null
		tracks = { x: null, y: null }

		return
	}

	const canX = area.scrollWidth - area.clientWidth >= 1
	const canY = area.scrollHeight - area.clientHeight >= 1
	const y = track(area.clientHeight, area.scrollHeight, area.scrollTop, props.insetTop, canX ? CORNER : 0)
	const x = track(area.clientWidth, area.scrollWidth, area.scrollLeft, props.insetLeft, canY ? CORNER : 0)

	tracks = { x, y }
	vertical.value = y
		? {
				top: `${area.offsetTop + y.start + ((y.length - y.thumb) * y.at) / y.range}px`,
				left: `${area.offsetLeft + area.clientWidth}px`,
				height: `${y.thumb}px`
			}
		: null
	horizontal.value = x
		? {
				top: `${area.offsetTop + area.clientHeight}px`,
				left: `${area.offsetLeft + x.start + ((x.length - x.thumb) * x.at) / x.range}px`,
				width: `${x.thumb}px`
			}
		: null
}

/** Measures once before the next frame, however many changes asked for it. */
function schedule(): void {
	if (frame === 0) {
		frame = requestAnimationFrame(measure)
	}
}

function observe(area: HTMLElement): void {
	resizes = new ResizeObserver(schedule)
	resizes.observe(area)

	// What it scrolls through: the sheet, which grows with its rows and columns.
	for (const child of Array.from(area.children)) {
		resizes.observe(child)
	}

	// Items added to a list, and the area moved without changing its size.
	changes = new MutationObserver(schedule)
	changes.observe(area, { childList: true, attributes: true, attributeFilter: ["style", "class"] })
	area.addEventListener("scroll", schedule, { passive: true })
}

function forget(area: HTMLElement | null): void {
	resizes?.disconnect()
	changes?.disconnect()
	resizes = changes = null
	area?.removeEventListener("scroll", schedule)
}

watch(
	() => props.target,
	(area, before) => {
		forget(before ?? null)

		if (area) {
			observe(area)
		}

		schedule()
	},
	{ immediate: true }
)

watch(() => [props.insetTop, props.insetLeft], schedule)

/** Holds a thumb: dragging it scrolls the area as far as the thumb goes along its track. */
function grab(event: PointerEvent, axis: "x" | "y"): void {
	const area = props.target
	const line = tracks[axis]

	if (event.button !== 0 || !area || !line) {
		return
	}

	event.preventDefault()
	event.stopPropagation()
	;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
	grabbed = {
		axis,
		from: axis === "y" ? event.clientY : event.clientX,
		scroll: axis === "y" ? area.scrollTop : area.scrollLeft,
		ratio: line.range / Math.max(1, line.length - line.thumb)
	}
	dragging.value = axis
}

function follow(event: PointerEvent): void {
	const area = props.target

	if (!grabbed || !area) {
		return
	}

	const moved = (grabbed.axis === "y" ? event.clientY : event.clientX) - grabbed.from

	if (grabbed.axis === "y") {
		area.scrollTop = grabbed.scroll + moved * grabbed.ratio
	} else {
		area.scrollLeft = grabbed.scroll + moved * grabbed.ratio
	}
}

function release(): void {
	grabbed = null
	dragging.value = null
}

onBeforeUnmount(() => {
	forget(props.target)
	cancelAnimationFrame(frame)
})
</script>
