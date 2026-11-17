/**
 * Puts both spike pages through the same handful of user actions, with a real keyboard, mouse and
 * clipboard, and says which ones each page gets right.
 *
 *     corepack pnpm --filter spike-render check
 *
 * The measuring script says how fast a page draws. This one says whether what it draws can be
 * worked in: typing over a cell, pasting a block, copying a range, leaving a locked column alone.
 *
 * A page gets two seconds to show the result of an action. Keys are typed 40 ms apart, about the
 * pace of a quick typist, and 150 ms pass between one action and the next, less than a person
 * needs to move from Enter to Ctrl+V. One check drops both gaps on purpose, ten times over.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright-core"
import { build, preview } from "vite"

const root = path.dirname(fileURLToPath(import.meta.url))
const PAGES = ["own", "engine"]
const TYPING_GAP_MS = 40
const ACTION_GAP_MS = 150
const NO_GAP_ATTEMPTS = 10

/** True once the text is on the page; false if two seconds pass without it. */
function appears(page: Page, text: string): Promise<boolean> {
	return page.evaluate(
		wanted =>
			window.__tools.waitForText(wanted, 2000).then(
				() => true,
				() => false
			),
		text
	)
}

/** True if the text is still not on the page after half a second. */
async function staysAway(page: Page, text: string): Promise<boolean> {
	await page.waitForTimeout(500)

	return page.evaluate(wanted => !window.__tools.visibleText().includes(wanted), text)
}

function pause(page: Page): Promise<void> {
	return page.waitForTimeout(ACTION_GAP_MS)
}

async function clickCell(page: Page, text: string): Promise<void> {
	await page.getByText(text, { exact: true }).first().click()
	await pause(page)
}

async function press(page: Page, key: string, times = 1): Promise<void> {
	for (let index = 0; index < times; index++) {
		await page.keyboard.press(key, { delay: TYPING_GAP_MS })
	}

	await pause(page)
}

function verdict(passed: boolean): string {
	return passed ? "yes" : "NO"
}

async function check(page: Page): Promise<Record<string, string>> {
	const outcome: Record<string, string> = {}

	// Type over a cell: the eighth column of the third row, reached with the arrow keys.
	await clickCell(page, "Ürün 000003")
	await press(page, "ArrowRight", 7)
	await page.keyboard.type("abc", { delay: TYPING_GAP_MS })
	await press(page, "Enter")
	outcome["type over a cell, Enter commits"] = verdict(await appears(page, "abc"))

	// Paste a two by two block where the cursor now stands.
	await page.evaluate(() => navigator.clipboard.writeText("P1\tP2\nP3\tP4"))
	await press(page, "Control+V")
	outcome["paste a 2 × 2 block"] = verdict(
		(await appears(page, "P1")) &&
			(await appears(page, "P2")) &&
			(await appears(page, "P3")) &&
			(await appears(page, "P4"))
	)

	// Select two by two with Shift and the arrows, copy it, read the clipboard back.
	await clickCell(page, "Ürün 000010")
	await press(page, "Shift+ArrowRight")
	await press(page, "Shift+ArrowDown")
	await page.evaluate(() => navigator.clipboard.writeText(""))
	await press(page, "Control+C")
	const copied = (await page.evaluate(() => navigator.clipboard.readText()))
		.replace(/\r\n?/g, "\n")
		.replace(/\n$/, "")
	outcome["Shift+arrows select a range, copy gives tab-separated text"] = verdict(
		copied === "Ürün 000010\tSKU-000010\nÜrün 000011\tSKU-000011"
	)

	// A locked column takes no typing.
	await clickCell(page, "SKU-000005")
	await page.keyboard.type("zzz", { delay: TYPING_GAP_MS })
	await press(page, "Enter")
	outcome["a read-only column refuses typing"] = verdict(
		(await staysAway(page, "zzz")) && (await appears(page, "SKU-000005"))
	)

	// Three keys and Enter with no gap at all, the way a barcode reader or a macro sends them. A
	// grid that opens its editor a moment after the first key loses the rest. Ten cells, counted.
	let arrived = 0

	for (let attempt = 0; attempt < NO_GAP_ATTEMPTS; attempt++) {
		const text = `q${attempt}w`

		await clickCell(page, `Ürün ${String(12 + attempt).padStart(6, "0")}`)
		await press(page, "ArrowRight", 7)
		await page.keyboard.type(text)
		await page.keyboard.press("Enter")

		if (await appears(page, text)) {
			arrived++
		}
	}

	outcome["keys sent with no gap between them all arrive"] = `${arrived} of ${NO_GAP_ATTEMPTS}`

	// Page Down moves the view along with the cursor.
	await clickCell(page, "Ürün 000006")
	await press(page, "PageDown", 5)
	outcome["Page Down scrolls the view"] = verdict(await staysAway(page, "Ürün 000001"))

	return outcome
}

await build({ root, logLevel: "warn" })

const server = await preview({ root, logLevel: "warn", preview: { port: 4319, strictPort: false } })
const base = server.resolvedUrls?.local[0]

if (!base) {
	throw new Error("the preview server did not report an address")
}

const browser = await chromium.launch({ channel: "msedge", headless: true })

try {
	for (const pageName of PAGES) {
		const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
		await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin })

		const page = await context.newPage()
		const missing: string[] = []

		page.on("response", response => {
			if (response.status() === 404) {
				missing.push(new URL(response.url()).pathname)
			}
		})

		await page.goto(`${base}${pageName}.html`)
		await page.waitForFunction(() => Boolean(window.__spike))
		await page.evaluate(() => window.__spike.prepare(10000, 12))
		await page.evaluate(() => window.__spike.mount())

		console.log(`\n[${pageName}]`)

		for (const [name, result] of Object.entries(await check(page))) {
			console.log(`  ${result.padEnd(9)} ${name}`)
		}

		if (missing.length > 0) {
			console.log(`  requests answered 404: ${[...new Set(missing)].join(", ")}`)
		}

		await context.close()
	}
} finally {
	await browser.close()
	await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
}
