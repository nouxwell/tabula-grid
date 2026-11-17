import { mulberry32 } from "./data"

/** What each page offers the measuring script. Both pages offer the same three calls. */
export interface SpikePage {
	/** Builds the sheet. Kept apart from `mount()` so generating data is not counted as rendering. */
	prepare(rows: number, columns: number): void
	/** Mounts the grid and resolves once the first row is on screen, with the time that took. */
	mount(): Promise<number>
	unmount(): void
}

export interface FrameStats {
	frames: number
	p50: number
	p95: number
	max: number
	/** Frames that took longer than one and a half refresh intervals: the ones a user sees as a stutter. */
	slow: number
	/** Where the scroll ended, so the caller can check the grid really followed. */
	position: number
}

const SLOW_FRAME_MS = 25

function frame(): Promise<number> {
	return new Promise(resolve => requestAnimationFrame(resolve))
}

function appRoot(): HTMLElement {
	const root = document.getElementById("app")

	if (!root) {
		throw new Error("no #app element")
	}

	return root
}

/**
 * The element that actually scrolls along one axis.
 *
 * Found by looking, not by name: the two pages are built differently, and a selector written for
 * one would quietly measure nothing on the other. Null when the sheet fits and nothing scrolls.
 */
function findScroller(axis: "x" | "y"): HTMLElement | null {
	let best: HTMLElement | null = null
	let bestRange = 0

	for (const element of appRoot().querySelectorAll<HTMLElement>("*")) {
		const range =
			axis === "y" ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth

		if (range <= bestRange) {
			continue
		}

		const style = getComputedStyle(element)
		const overflow = axis === "y" ? style.overflowY : style.overflowX

		if (overflow === "auto" || overflow === "scroll") {
			best = element
			bestRange = range
		}
	}

	return best
}

function summarise(intervals: number[], position: number): FrameStats {
	const sorted = [...intervals].sort((a, b) => a - b)
	const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0

	return {
		frames: intervals.length,
		p50: at(0.5),
		p95: at(0.95),
		max: sorted[sorted.length - 1] ?? 0,
		slow: intervals.filter(interval => interval > SLOW_FRAME_MS).length,
		position
	}
}

/** Scrolls by a fixed step on every frame and records how long each frame took. */
async function scrollRun(axis: "x" | "y", step: number, frames: number): Promise<FrameStats> {
	const scroller = findScroller(axis)

	if (!scroller) {
		return summarise([], 0)
	}

	const range =
		axis === "y" ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth
	const count = Math.min(frames, Math.floor(range / step))
	const intervals: number[] = []
	let last = await frame()

	for (let index = 0; index < count; index++) {
		if (axis === "y") {
			scroller.scrollTop += step
		} else {
			scroller.scrollLeft += step
		}

		const now = await frame()
		intervals.push(now - last)
		last = now
	}

	return summarise(intervals, axis === "y" ? scroller.scrollTop : scroller.scrollLeft)
}

/** Jumps to places far apart, the way dragging the scrollbar does: nothing on screen can be reused. */
async function jumpRun(count: number): Promise<number> {
	const scroller = findScroller("y")

	if (!scroller) {
		return 0
	}

	const range = scroller.scrollHeight - scroller.clientHeight
	const random = mulberry32(7)

	for (let index = 0; index < count; index++) {
		scroller.scrollTop = Math.floor(random() * range)
		await frame()
		await frame()
	}

	return scroller.scrollTop
}

function domCount(): number {
	return appRoot().querySelectorAll("*").length
}

/** Which element was picked as the scroller, for the report: a wrong pick should be visible, not silent. */
function scrollerName(axis: "x" | "y"): string {
	const scroller = findScroller(axis)

	if (!scroller) {
		return "none"
	}

	const classes = scroller.className ? `.${scroller.className.trim().split(/\s+/).join(".")}` : ""

	return `${scroller.tagName.toLowerCase()}${classes}`
}

function visibleText(): string {
	return appRoot().textContent ?? ""
}

/** Resolves on the first frame the text is in the page, plus one more so it has been painted. */
export async function waitForText(text: string, timeoutMs = 20000): Promise<void> {
	const deadline = performance.now() + timeoutMs

	while (!visibleText().includes(text)) {
		if (performance.now() > deadline) {
			throw new Error(`"${text}" never appeared`)
		}

		await frame()
	}

	await frame()
}

const tools = { scrollRun, jumpRun, domCount, scrollerName, visibleText, waitForText }

declare global {
	interface Window {
		__spike: SpikePage
		__tools: typeof tools
	}
}

export function installTools(): void {
	window.__tools = tools
}
