/**
 * Measures the two spike pages in a real browser and writes `results.json`.
 *
 *     corepack pnpm --filter spike-render measure
 *
 * It drives the Edge that is already installed, headless, so nothing is downloaded. Each run is a
 * fresh page: build the sheet, mount the grid, scroll down, scroll right, jump around. Frame times
 * come from the page; main-thread time comes from the browser's own counters, which is what tells
 * two pages apart when both hold sixty frames a second.
 *
 * SPIKE_RUNS=5 changes how many runs each case gets (the median is reported).
 * SPIKE_QUICK=1 runs one small case once, to check the script itself.
 */
import { readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import { chromium, type Browser, type CDPSession } from "playwright-core"
import { build, preview } from "vite"

const root = path.dirname(fileURLToPath(import.meta.url))
const QUICK = process.env.SPIKE_QUICK === "1"
const RUNS = QUICK ? 1 : Number(process.env.SPIKE_RUNS ?? 3)

const ROW_HEIGHT = 30
const VIEWPORT = { width: 1440, height: 900 }

/** Pixels per frame and frame count. 120 px is four rows a frame, a fast drag of the scrollbar. */
const VERTICAL = { step: 120, frames: 300 }
const HORIZONTAL = { step: 30, frames: 200 }
const JUMPS = 20

const DATASETS = QUICK
	? [{ rows: 10_000, columns: 12 }]
	: [
			{ rows: 10_000, columns: 12 },
			{ rows: 50_000, columns: 10 },
			{ rows: 5_000, columns: 60 }
		]
const PAGES = ["own", "engine"]

/** 1 is this machine as it is; 4 slows the main thread fourfold, standing in for a modest office laptop. */
const THROTTLES = QUICK ? [1] : [1, 4]

interface Times {
	task: number
	script: number
	layout: number
	style: number
}

interface FrameStats {
	frames: number
	p50: number
	p95: number
	max: number
	slow: number
	position: number
}

function marker(row: number): string {
	return `Ürün ${String(row + 1).padStart(6, "0")}`
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)

	return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function round(value: number, digits = 1): number {
	const factor = 10 ** digits

	return Math.round(value * factor) / factor
}

/** The browser's running totals for the page's main thread, in milliseconds. */
async function times(cdp: CDPSession): Promise<Times> {
	const { metrics } = await cdp.send("Performance.getMetrics")
	const pick = (name: string): number => (metrics.find(metric => metric.name === name)?.value ?? 0) * 1000

	return {
		task: pick("TaskDuration"),
		script: pick("ScriptDuration"),
		layout: pick("LayoutDuration"),
		style: pick("RecalcStyleDuration")
	}
}

function since(before: Times, after: Times): Times {
	return {
		task: after.task - before.task,
		script: after.script - before.script,
		layout: after.layout - before.layout,
		style: after.style - before.style
	}
}

async function heapMb(cdp: CDPSession): Promise<number> {
	await cdp.send("HeapProfiler.collectGarbage")
	const { usedSize } = await cdp.send("Runtime.getHeapUsage")

	return usedSize / 1048576
}

async function run(
	browser: Browser,
	base: string,
	pageName: string,
	dataset: { rows: number; columns: number },
	throttle: number
) {
	const context = await browser.newContext({ viewport: VIEWPORT })
	const page = await context.newPage()
	const pageErrors: string[] = []

	page.on("pageerror", error => pageErrors.push(String(error)))

	const cdp = await context.newCDPSession(page)
	await cdp.send("Performance.enable")
	await page.goto(`${base}${pageName}.html`)
	await page.waitForFunction(() => Boolean(window.__spike))
	await page.evaluate(([rows, columns]) => window.__spike.prepare(rows, columns), [
		dataset.rows,
		dataset.columns
	] as const)

	const heapBefore = await heapMb(cdp)

	if (throttle > 1) {
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })
	}

	let before = await times(cdp)
	const mountMs = await page.evaluate(() => window.__spike.mount())
	const mount = since(before, await times(cdp))

	await page.waitForTimeout(300)

	const domNodes = await page.evaluate(() => window.__tools.domCount())
	const scrollers = await page.evaluate(() => ({
		y: window.__tools.scrollerName("y"),
		x: window.__tools.scrollerName("x")
	}))

	before = await times(cdp)
	const vertical: FrameStats = await page.evaluate(
		({ step, frames }) => window.__tools.scrollRun("y", step, frames),
		VERTICAL
	)
	const verticalCost = since(before, await times(cdp))

	// The row a little below the top edge has to be on screen now. If it is not, the page did not
	// follow the scroll and every number above describes a grid standing still.
	const expected = marker(Math.floor(vertical.position / ROW_HEIGHT) + 3)
	const followed = await page.evaluate(
		text =>
			window.__tools.waitForText(text, 3000).then(
				() => true,
				() => false
			),
		expected
	)

	before = await times(cdp)
	const horizontal: FrameStats = await page.evaluate(
		({ step, frames }) => window.__tools.scrollRun("x", step, frames),
		HORIZONTAL
	)
	const horizontalCost = since(before, await times(cdp))

	before = await times(cdp)
	await page.evaluate(count => window.__tools.jumpRun(count), JUMPS)
	const jumpCost = since(before, await times(cdp))

	if (throttle > 1) {
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
	}

	const heapAfter = await heapMb(cdp)
	const assets: string[] = await page.evaluate(() =>
		performance
			.getEntriesByType("resource")
			.map(entry => new URL(entry.name).pathname)
			.filter(name => name.includes("/assets/"))
	)

	await context.close()

	return {
		mountMs,
		mountTask: mount.task,
		domNodes,
		scrollers,
		followed,
		pageErrors,
		vertical,
		verticalTaskPerFrame: vertical.frames > 0 ? verticalCost.task / vertical.frames : 0,
		verticalScriptPerFrame: vertical.frames > 0 ? verticalCost.script / vertical.frames : 0,
		horizontal,
		horizontalTaskPerFrame: horizontal.frames > 0 ? horizontalCost.task / horizontal.frames : 0,
		jumpTaskPerJump: jumpCost.task / JUMPS,
		heapMb: heapAfter - heapBefore,
		assets
	}
}

/** What a page downloaded, as the files stand on disk and as they would travel compressed. */
function weigh(assets: string[]): { files: number; rawKb: number; gzipKb: number } {
	let raw = 0
	let gzip = 0
	const unique = [...new Set(assets)]

	for (const asset of unique) {
		const bytes = readFileSync(path.join(root, "dist", asset))
		raw += bytes.length
		gzip += gzipSync(bytes).length
	}

	return { files: unique.length, rawKb: round(raw / 1024), gzipKb: round(gzip / 1024) }
}

await build({ root, logLevel: "warn" })

const server = await preview({ root, logLevel: "warn", preview: { port: 4317, strictPort: false } })
const base = server.resolvedUrls?.local[0]

if (!base) {
	throw new Error("the preview server did not report an address")
}

const browser = await chromium.launch({ channel: "msedge", headless: true })
const results = []

try {
	for (const dataset of DATASETS) {
		for (const throttle of THROTTLES) {
			for (const pageName of PAGES) {
				const runs = []

				for (let index = 0; index < RUNS; index++) {
					runs.push(await run(browser, base, pageName, dataset, throttle))
				}

				const first = runs[0]

				if (!first) {
					continue
				}

				const result = {
					page: pageName,
					rows: dataset.rows,
					columns: dataset.columns,
					throttle,
					runs: runs.length,
					followedScroll: runs.every(entry => entry.followed),
					pageErrors: [...new Set(runs.flatMap(entry => entry.pageErrors))],
					scrollers: first.scrollers,
					mountMs: round(median(runs.map(entry => entry.mountMs))),
					mountTaskMs: round(median(runs.map(entry => entry.mountTask))),
					domNodes: median(runs.map(entry => entry.domNodes)),
					heapMb: round(median(runs.map(entry => entry.heapMb))),
					vertical: {
						frames: first.vertical.frames,
						p50: round(median(runs.map(entry => entry.vertical.p50))),
						p95: round(median(runs.map(entry => entry.vertical.p95))),
						max: round(median(runs.map(entry => entry.vertical.max))),
						slowFrames: median(runs.map(entry => entry.vertical.slow)),
						taskPerFrameMs: round(median(runs.map(entry => entry.verticalTaskPerFrame)), 2),
						scriptPerFrameMs: round(median(runs.map(entry => entry.verticalScriptPerFrame)), 2)
					},
					horizontal: {
						frames: first.horizontal.frames,
						p95: round(median(runs.map(entry => entry.horizontal.p95))),
						max: round(median(runs.map(entry => entry.horizontal.max))),
						slowFrames: median(runs.map(entry => entry.horizontal.slow)),
						taskPerFrameMs: round(median(runs.map(entry => entry.horizontalTaskPerFrame)), 2)
					},
					jumpTaskMs: round(median(runs.map(entry => entry.jumpTaskPerJump)), 2),
					download: weigh(first.assets)
				}

				results.push(result)
				console.log(JSON.stringify(result))
			}
		}
	}
} finally {
	await browser.close()
	await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
}

const report = {
	measuredAt: new Date().toISOString(),
	machine: {
		cpu: os.cpus()[0]?.model.trim() ?? "unknown",
		threads: os.cpus().length,
		memoryGb: round(os.totalmem() / 1024 ** 3),
		platform: `${os.type()} ${os.release()}`,
		node: process.version
	},
	browser: `Edge ${browser.version()}, headless`,
	viewport: VIEWPORT,
	vertical: VERTICAL,
	horizontal: HORIZONTAL,
	jumps: JUMPS,
	runsPerCase: RUNS,
	results
}

if (!QUICK) {
	writeFileSync(path.join(root, "results.json"), `${JSON.stringify(report, null, "\t")}\n`)
}

console.log(`\n${report.browser} · ${report.machine.cpu} · ${RUNS} run(s) per case`)
