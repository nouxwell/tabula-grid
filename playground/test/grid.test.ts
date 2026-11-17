import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Locator, type Page } from "playwright-core"
import { build, preview, type PreviewServer } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { LONG_LABEL } from "../src/sample"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Field keys by column, as the playground's schema lays them out. */
const COLUMNS = [
	"productId",
	"sku",
	"currentPrice",
	"newPrice",
	"change",
	"currency",
	"validFrom",
	"active",
	"note",
	"difference"
]

let server: PreviewServer
let browser: Browser
let base: string

beforeAll(async () => {
	await build({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "warn" })
	server = await preview({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "warn" })
	base = server.resolvedUrls?.local[0] ?? ""

	const named = process.env.TABULA_BROWSER
	const channel = named === "chromium" ? undefined : (named ?? (process.env.CI ? undefined : "msedge"))

	browser = await chromium.launch({ channel, headless: true })
})

afterAll(async () => {
	await browser?.close()
	await new Promise<void>(resolve => server?.httpServer.close(() => resolve()) ?? resolve())
})

/**
 * Opens the playground with this many rows and hands the page to `test`. Afterwards, any error the
 * page threw or logged fails the test, whatever the test itself checked.
 */
async function withPage(rows: number, test: (page: Page) => Promise<void>, query = ""): Promise<void> {
	const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
	await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin })

	const page = await context.newPage()
	const errors: string[] = []

	page.on("pageerror", error => errors.push(String(error)))
	page.on("console", message => {
		if (message.type() === "error" || message.type() === "warning") {
			errors.push(message.text())
		}
	})

	try {
		await page.goto(`${base}?rows=${rows}${query}`)
		await page.waitForFunction(() => window.__playground !== undefined)
		await test(page)
		expect(errors).toEqual([])
	} finally {
		await context.close()
	}
}

/** The cell at a position on screen, whether its column is pinned or scrolls. */
function cell(page: Page, row: number, col: number): Locator {
	return page.locator(`.tabula-grid-row[data-row="${row}"] .tabula-grid-cell[aria-colindex="${col + 1}"]`)
}

function header(page: Page, col: number): Locator {
	return page.locator(`.tabula-grid-th[aria-colindex="${col + 1}"]`)
}

async function width(locator: Locator): Promise<number> {
	return (await locator.boundingBox())?.width ?? 0
}

function valueAt(page: Page, row: number, key: string): Promise<unknown> {
	return page.evaluate(
		([index, field]) => {
			const { store } = window.__playground!

			return store.get(store.rowIdAt(index)!, field)
		},
		[row, key] as const
	)
}

function revision(page: Page): Promise<number> {
	return page.evaluate(() => window.__playground!.store.revision)
}

function selected(page: Page) {
	return page.evaluate(() => {
		const { selection } = window.__playground!

		return { active: selection.active, range: selection.range }
	})
}

async function press(page: Page, key: string, times = 1): Promise<void> {
	for (let index = 0; index < times; index++) {
		await page.keyboard.press(key)
	}
}

function clipboard(page: Page, text?: string): Promise<string> {
	return page.evaluate(async value => {
		if (value !== undefined) {
			await navigator.clipboard.writeText(value)
		}

		return navigator.clipboard.readText()
	}, text)
}

describe("TabulaGrid", () => {
	describe("header", () => {
		it("shows each field's label, with a mark on the required ones", async () => {
			await withPage(20, async page => {
				await expect.poll(() => header(page, 0).innerText()).toContain("Ürün")
				await expect(header(page, 0).locator(".tabula-grid-required").count()).resolves.toBe(1)
				await expect(header(page, 1).innerText()).resolves.toBe("SKU")
				await expect(header(page, 1).locator(".tabula-grid-required").count()).resolves.toBe(0)
			})
		})

		it("cuts a header past 100 characters with an ellipsis and keeps the whole one as its tooltip", async () => {
			await withPage(20, async page => {
				const shown = await header(page, 8).locator(".tabula-grid-th-text").innerText()

				expect(LONG_LABEL.length).toBeGreaterThan(100)
				expect(shown).toBe(`${Array.from(LONG_LABEL).slice(0, 100).join("")}…`)
				await expect(header(page, 8).getAttribute("title")).resolves.toBe(LONG_LABEL)
			})
		})
	})

	describe("column widths", () => {
		it("sizes each column from its header, from 100 to 320 pixels", async () => {
			await withPage(20, async page => {
				await expect.poll(() => width(header(page, 8))).toBe(320)
				expect(await width(header(page, 1))).toBe(100)

				// A header that fits its limits gets the room to be read whole.
				const validFrom = header(page, 6)
				const text = validFrom.locator(".tabula-grid-th-text")
				const fits = await text.evaluate(element => element.scrollWidth <= element.clientWidth)

				expect(await width(validFrom)).toBeGreaterThan(100)
				expect(await width(validFrom)).toBeLessThan(320)
				expect(fits).toBe(true)
			})
		})

		it("keeps a width set by dragging, and fits a column to its contents on a double click", async () => {
			await withPage(20, async page => {
				const handle = header(page, 1).locator(".tabula-grid-resize")
				const box = await handle.boundingBox()

				expect(box).not.toBeNull()

				await page.mouse.move((box?.x ?? 0) + 3, (box?.y ?? 0) + 10)
				await page.mouse.down()
				await page.mouse.move((box?.x ?? 0) + 203, (box?.y ?? 0) + 10, { steps: 5 })
				await page.mouse.up()

				await expect.poll(() => width(header(page, 1))).toBe(300)
				await expect(page.evaluate(() => window.__playground!.widths())).resolves.toEqual({ sku: 300 })

				// The fonts settling or anything else measuring again does not take it back.
				await page.evaluate(() => document.fonts.ready)
				expect(await width(header(page, 1))).toBe(300)

				await handle.dblclick()

				// "SKU-000001" fits well inside the 100-pixel minimum.
				await expect.poll(() => width(header(page, 1))).toBe(100)
			})
		})
	})

	describe("drawing", () => {
		it("draws only what is on screen, whatever the number of rows", async () => {
			await withPage(10_000, async page => {
				await expect.poll(() => cell(page, 0, 0).innerText()).toBe("Ürün 000001")
				expect(await page.locator(".tabula-grid-cell").count()).toBeLessThan(1000)

				await page.locator(".tabula-grid-scroller").evaluate(element => {
					element.scrollTop = element.scrollHeight
				})

				await expect.poll(() => cell(page, 9_999, 0).innerText()).toBe("Ürün 010000")
				expect(await page.locator(".tabula-grid-cell").count()).toBeLessThan(1000)
			})
		})

		it("shows an option's label and a lookup's label rather than their values", async () => {
			await withPage(20, async page => {
				await expect.poll(() => cell(page, 0, 0).innerText()).toBe("Ürün 000001")
				await expect(cell(page, 0, 1).getAttribute("aria-readonly")).resolves.toBe("true")
				await expect(cell(page, 0, 3).getAttribute("aria-readonly")).resolves.toBeNull()
			})
		})
	})

	describe("keyboard", () => {
		it("moves with the arrows, extends with Shift and keeps the active cell where it was", async () => {
			await withPage(50, async page => {
				await cell(page, 2, 0).click()
				await press(page, "ArrowRight", 3)

				await expect(selected(page)).resolves.toMatchObject({ active: { row: 2, col: 3 } })

				await press(page, "Shift+ArrowDown", 2)

				await expect(selected(page)).resolves.toEqual({
					active: { row: 2, col: 3 },
					range: { top: 2, left: 3, bottom: 4, right: 3 }
				})

				await press(page, "ArrowDown")

				await expect(selected(page)).resolves.toEqual({
					active: { row: 3, col: 3 },
					range: { top: 3, left: 3, bottom: 3, right: 3 }
				})
			})
		})

		it("jumps with Ctrl and an arrow, and goes home with Ctrl+Home", async () => {
			await withPage(50, async page => {
				await cell(page, 0, 0).click()
				await press(page, "Control+ArrowDown")

				await expect(selected(page)).resolves.toMatchObject({ active: { row: 49, col: 0 } })
				await expect.poll(() => cell(page, 49, 0).isVisible()).toBe(true)

				await press(page, "Control+Home")

				await expect(selected(page)).resolves.toMatchObject({ active: { row: 0, col: 0 } })
			})
		})

		it("lets Tab out of the grid at the last column", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 7).click()
				await press(page, "Tab")

				await expect(selected(page)).resolves.toMatchObject({ active: { row: 0, col: 8 } })

				await press(page, "Tab")

				await expect(
					page.evaluate(() => document.activeElement?.classList.contains("tabula-grid"))
				).resolves.toBe(false)
			})
		})
	})

	describe("editing", () => {
		it("types over a cell, and Enter writes it and moves down", async () => {
			await withPage(20, async page => {
				const before = await revision(page)

				await cell(page, 1, 3).click()
				await page.keyboard.type("389,90")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 1, "newPrice")).toBe("389.9")
				await expect(revision(page)).resolves.toBe(before + 1)
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 2, col: 3 } })
				await expect.poll(() => cell(page, 1, 3).innerText()).toBe("389,90")
			})
		})

		it("starts an edit from text that arrives without a key, as an input method or dictation sends it", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 0).click()
				await page.keyboard.insertText("Çğış")

				await expect.poll(() => page.locator(".tabula-grid-input.is-editing").inputValue()).toBe("Çğış")

				await page.keyboard.insertText(" Öü")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "productId")).toBe("Çğış Öü")
			})
		})

		it("widens the editor as the text outgrows the cell, never narrower than the cell", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 0).click()
				await page.keyboard.type("Ç")

				const editor = page.locator(".tabula-grid-input.is-editing")
				const cellWidth = await width(cell(page, 0, 0))

				expect(await width(editor)).toBe(cellWidth)

				await page.keyboard.type("elik Termos 500 ml, paslanmaz çelik, çift cidarlı")

				await expect.poll(() => width(editor)).toBeGreaterThan(cellWidth + 100)
				await expect(editor.evaluate(element => element.scrollWidth <= element.clientWidth)).resolves.toBe(true)
			})
		})

		it("edits in place with F2, and Escape leaves the cell as it was", async () => {
			await withPage(20, async page => {
				const original = await valueAt(page, 0, "newPrice")

				await cell(page, 0, 3).click()
				await press(page, "F2")

				const editor = page.locator(".tabula-grid-input.is-editing")

				// Every digit, the Turkish decimal comma, no grouping: what reads back to the same value.
				await expect(editor.inputValue()).resolves.toBe(String(original).replace(".", ","))

				await page.keyboard.type("9")
				await press(page, "Escape")

				await expect(editor.count()).resolves.toBe(0)
				await expect(valueAt(page, 0, "newPrice")).resolves.toBe(original)
			})
		})

		it("writes nothing when an edit is committed unchanged", async () => {
			await withPage(20, async page => {
				const before = await revision(page)

				await cell(page, 0, 3).click()
				await press(page, "F2")
				await press(page, "Enter")

				await expect(revision(page)).resolves.toBe(before)
			})
		})

		it("takes no typing in a read-only column", async () => {
			await withPage(20, async page => {
				const before = await revision(page)

				await cell(page, 0, 1).click()
				await page.keyboard.type("zzz")
				await press(page, "Enter")

				await expect(page.locator(".tabula-grid-input.is-editing").count()).resolves.toBe(0)
				await expect(valueAt(page, 0, "sku")).resolves.toBe("SKU-000001")
				await expect(revision(page)).resolves.toBe(before)
			})
		})

		it("clears the selected cells with Delete in one change, and leaves read-only ones alone", async () => {
			await withPage(20, async page => {
				const before = await revision(page)

				await cell(page, 0, 0).click()
				await press(page, "Shift+ArrowRight", 3)
				await press(page, "Delete")

				await expect.poll(() => valueAt(page, 0, "productId")).toBeNull()
				await expect(valueAt(page, 0, "newPrice")).resolves.toBeNull()
				await expect(valueAt(page, 0, "sku")).resolves.toBe("SKU-000001")
				await expect(revision(page)).resolves.toBe(before + 1)
			})
		})
	})

	describe("values", () => {
		it("shows numbers, dates and yes or no the Turkish way", async () => {
			await withPage(20, async page => {
				const current = String(await valueAt(page, 0, "currentPrice"))
				const [whole = "", fraction = ""] = current.split(".")

				await expect
					.poll(() => cell(page, 0, 2).innerText())
					.toBe(`${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0")}`)

				const date = String(await valueAt(page, 0, "validFrom"))

				await expect(cell(page, 0, 6).innerText()).resolves.toBe(date.split("-").reverse().join("."))
				await expect(cell(page, 0, 7).innerText()).resolves.toBe(
					(await valueAt(page, 0, "active")) ? "Evet" : "Hayır"
				)
			})
		})

		it("reads what is typed the Turkish way into the value a backend receives", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 3).click()
				await page.keyboard.type("1.234,5")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "newPrice")).toBe("1234.5")
				await expect(cell(page, 0, 3).innerText()).resolves.toBe("1.234,50")

				await cell(page, 0, 7).click()
				await page.keyboard.type("hayır")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "active")).toBe(false)

				await cell(page, 0, 6).click()
				await page.keyboard.type("28.02.2026")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "validFrom")).toBe("2026-02-28")
			})
		})

		it("keeps text it cannot read as it was typed, and marks the cell until it is fixed", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 6).click()
				await page.keyboard.type("31.02.2026")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "validFrom")).toBe("31.02.2026")
				await expect(cell(page, 0, 6).getAttribute("aria-invalid")).resolves.toBe("true")
				await expect(cell(page, 0, 6).getAttribute("title")).resolves.toBe(
					"“31.02.2026” tarih olarak okunamadı. Örnek: 31.12.2026"
				)
				await expect(cell(page, 0, 6).innerText()).resolves.toBe("31.02.2026")

				await cell(page, 0, 6).click()
				await page.keyboard.type("28.02.2026")
				await press(page, "Enter")

				await expect.poll(() => cell(page, 0, 6).getAttribute("aria-invalid")).toBeNull()
				await expect(cell(page, 0, 6).innerText()).resolves.toBe("28.02.2026")
			})
		})

		it("copies what it shows, and pastes it back as the same values", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 3).click()
				await press(page, "Shift+ArrowRight", 4)
				await press(page, "Shift+ArrowDown")
				await clipboard(page, "")
				await press(page, "Control+C")
				await expect.poll(() => clipboard(page)).not.toBe("")

				await cell(page, 10, 3).click()
				await press(page, "Control+V")

				// Numbers by value: the sample writes "13.0" where reading gives "13", the same number.
				const same = (value: unknown): unknown =>
					typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value

				for (const key of ["newPrice", "change", "currency", "validFrom", "active"]) {
					for (const offset of [0, 1]) {
						const original = same(await valueAt(page, offset, key))

						await expect.poll(async () => same(await valueAt(page, 10 + offset, key))).toEqual(original)
					}
				}
			})
		})
	})

	describe("rules and issues", () => {
		const panel = (page: Page): Locator => page.locator(".tabula-issues")
		const items = (page: Page): Locator => panel(page).locator(".tabula-issues-item")

		it("starts with no issues on a sheet that keeps its rules", async () => {
			await withPage(20, async page => {
				await expect.poll(() => panel(page).locator(".tabula-issues-none").innerText()).toBe("Sorun yok.")
				await expect(page.locator(".tabula-grid-cell.is-error").count()).resolves.toBe(0)
			})
		})

		it("marks an emptied required cell, says why in Turkish, and lists it", async () => {
			await withPage(20, async page => {
				await cell(page, 2, 3).click()
				await press(page, "Delete")

				await expect.poll(() => cell(page, 2, 3).getAttribute("class")).toContain("is-error")
				await expect(cell(page, 2, 3).getAttribute("title")).resolves.toBe("Bu alan zorunlu.")
				await expect(cell(page, 2, 3).getAttribute("aria-invalid")).resolves.toBe("true")
				await expect(items(page).count()).resolves.toBe(1)
				await expect(items(page).first().innerText()).resolves.toBe("Satır 3 · Yeni fiyat\nBu alan zorunlu.")
				await expect(panel(page).locator(".tabula-issues-count.is-error").innerText()).resolves.toBe("1 hata")
			})
		})

		it("checks limits and clears the issue once the value keeps them", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 4).click()
				await page.keyboard.type("150")
				await press(page, "Enter")

				await expect.poll(() => cell(page, 0, 4).getAttribute("title")).toBe("En fazla 100 olabilir.")

				await cell(page, 0, 4).click()
				await page.keyboard.type("-12,5")
				await press(page, "Enter")

				await expect.poll(() => cell(page, 0, 4).getAttribute("title")).toBeNull()
				await expect(items(page).count()).resolves.toBe(0)
			})
		})

		it("marks every row holding the same product, and clears them all when one changes", async () => {
			await withPage(20, async page => {
				// The same product's name twice: both become that product, which is then in the column twice.
				await cell(page, 1, 0).click()
				await clipboard(page, "Kupa")
				await press(page, "Control+V")
				await cell(page, 4, 0).click()
				await press(page, "Control+V")

				await expect
					.poll(() => cell(page, 1, 0).getAttribute("title"))
					.toBe("Bu değer kolonda 2 kez geçiyor; bir kez geçmeli.")
				await expect(cell(page, 4, 0).getAttribute("class")).resolves.toContain("is-error")

				await cell(page, 4, 0).click()
				await page.keyboard.type("Başka ürün")
				await press(page, "Enter")

				await expect.poll(() => cell(page, 1, 0).getAttribute("title")).toBeNull()
			})
		})

		it("goes to an issue's cell from the list, scrolling it into view", async () => {
			await withPage(300, async page => {
				await page.evaluate(() => {
					const { store } = window.__playground!

					store.setCell(store.rowIdAt(250)!, "newPrice", null)
				})

				await expect.poll(() => items(page).count()).toBe(1)
				await expect(cell(page, 250, 3).count()).resolves.toBe(0)

				await items(page).first().click()

				await expect(selected(page)).resolves.toMatchObject({ active: { row: 250, col: 3 } })
				await expect.poll(() => cell(page, 250, 3).isVisible()).toBe(true)
				// The keyboard is the grid's again: typing fixes the cell.
				await page.keyboard.type("10")
				await press(page, "Enter")
				await expect.poll(() => valueAt(page, 250, "newPrice")).toBe("10")
				await expect.poll(() => items(page).count()).toBe(0)
			})
		})

		it("walks through the issues with Next and Previous, wrapping round", async () => {
			await withPage(20, async page => {
				await page.evaluate(() => {
					const { store } = window.__playground!

					store.setCells([
						{ rowId: store.rowIdAt(3)!, field: "newPrice", value: null },
						{ rowId: store.rowIdAt(7)!, field: "change", value: "500" }
					])
				})

				const next = panel(page).getByRole("button", { name: "Sonraki" })
				const previous = panel(page).getByRole("button", { name: "Önceki" })

				await next.click()
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 3, col: 3 } })
				await next.click()
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 7, col: 4 } })
				await next.click()
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 3, col: 3 } })
				await previous.click()
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 7, col: 4 } })
			})
		})

		it("speaks English when the sheet does", async () => {
			await withPage(
				20,
				async page => {
					await cell(page, 0, 3).click()
					await press(page, "Delete")

					await expect.poll(() => cell(page, 0, 3).getAttribute("title")).toBe("This field is required.")
					await expect(items(page).first().innerText()).resolves.toBe(
						"Row 1 · Yeni fiyat\nThis field is required."
					)
				},
				"&values=en"
			)
		})
	})

	describe("clipboard", () => {
		it("copies a range as text a spreadsheet reads", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 0).click()
				await press(page, "Shift+ArrowRight")
				await press(page, "Shift+ArrowDown")
				await clipboard(page, "")
				await press(page, "Control+C")

				await expect.poll(() => clipboard(page)).toBe("Ürün 000001\tSKU-000001\r\nÜrün 000002\tSKU-000002")
			})
		})

		it("pastes a block, passes over read-only columns and adds the rows it runs past", async () => {
			await withPage(5, async page => {
				const before = await revision(page)

				await cell(page, 3, 0).click()
				await clipboard(page, "A\tB\tC\tD\r\nE\tF\tG\tH\r\nI\tJ\tK\tL\r\n")
				await press(page, "Control+V")

				await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(6)
				await expect(valueAt(page, 3, "productId")).resolves.toBe("A")
				await expect(valueAt(page, 3, "sku")).resolves.toBe("SKU-000004")
				await expect(valueAt(page, 3, "newPrice")).resolves.toBe("D")
				await expect(valueAt(page, 5, "productId")).resolves.toBe("I")
				await expect(valueAt(page, 5, "sku")).resolves.toBeNull()
				await expect(revision(page)).resolves.toBe(before + 1)
				await expect(selected(page)).resolves.toMatchObject({ range: { top: 3, left: 0, bottom: 5, right: 3 } })

				// "D" is not a price: kept as pasted, and marked.
				await expect(cell(page, 3, 3).getAttribute("aria-invalid")).resolves.toBe("true")
			})
		})

		it("fills a selected range with one pasted value", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 3).click()
				await press(page, "Shift+ArrowDown", 2)
				await clipboard(page, "0")
				await press(page, "Control+V")

				for (const row of [0, 1, 2]) {
					await expect.poll(() => valueAt(page, row, "newPrice")).toBe("0")
				}

				expect(await valueAt(page, 3, "newPrice")).not.toBe("0")
			})
		})

		it("reads a quoted cell with a line break in it as one cell", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 8).click()
				await clipboard(page, '"iki\nsatır"\r\n')
				await press(page, "Control+V")

				await expect.poll(() => valueAt(page, 0, "note")).toBe("iki\nsatır")
				await expect(valueAt(page, 1, "note")).resolves.not.toBe("satır")
			})
		})
	})

	describe("undo and redo", () => {
		const button = (page: Page, name: "undo" | "redo"): Locator => page.locator(`.playground-${name}`)

		it("takes an edit back with Ctrl+Z and makes it again with Ctrl+Y, selecting the cell each time", async () => {
			await withPage(20, async page => {
				const original = await valueAt(page, 1, "newPrice")
				const before = await revision(page)

				await cell(page, 1, 3).click()
				await page.keyboard.type("12")
				await press(page, "Enter")
				await expect.poll(() => valueAt(page, 1, "newPrice")).toBe("12")

				await press(page, "Control+Z")
				await expect.poll(() => valueAt(page, 1, "newPrice")).toBe(original)
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 1, col: 3 } })
				// Taking a step back is a change of its own: a backend answer about "12" is out of date.
				await expect(revision(page)).resolves.toBe(before + 2)

				await press(page, "ArrowDown", 3)
				await press(page, "Control+Y")
				await expect.poll(() => valueAt(page, 1, "newPrice")).toBe("12")
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 1, col: 3 } })

				await press(page, "Control+Z")
				await press(page, "Control+Shift+Z")
				await expect.poll(() => valueAt(page, 1, "newPrice")).toBe("12")
			})
		})

		it("takes a paste back in one step, the rows it added included, and puts them back under the same ids", async () => {
			await withPage(5, async page => {
				const original = await valueAt(page, 3, "productId")
				const ids = (): Promise<string[]> => page.evaluate(() => window.__playground!.store.rowIds())

				await cell(page, 3, 0).click()
				await clipboard(page, "A\tB\tC\tD\r\nE\tF\tG\tH\r\nI\tJ\tK\tL\r\n")
				await press(page, "Control+V")
				await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(6)

				const pasted = await ids()

				await press(page, "Control+Z")
				await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(5)
				await expect(valueAt(page, 3, "productId")).resolves.toEqual(original)
				await expect(selected(page)).resolves.toMatchObject({ range: { top: 3, left: 0, bottom: 4, right: 3 } })

				await press(page, "Control+Y")
				await expect.poll(ids).toEqual(pasted)
				await expect(valueAt(page, 5, "productId")).resolves.toBe("I")
				await expect(selected(page)).resolves.toMatchObject({ range: { top: 3, left: 0, bottom: 5, right: 3 } })
			})
		})

		it("brings back the issues of what it brings back", async () => {
			await withPage(20, async page => {
				await cell(page, 2, 3).click()
				await press(page, "Delete")
				await expect.poll(() => cell(page, 2, 3).getAttribute("class")).toContain("is-error")

				await press(page, "Control+Z")
				await expect.poll(() => cell(page, 2, 3).getAttribute("class")).not.toContain("is-error")
				await expect(page.locator(".tabula-issues-none").innerText()).resolves.toBe("Sorun yok.")

				await press(page, "Control+Y")
				await expect.poll(() => cell(page, 2, 3).getAttribute("class")).toContain("is-error")
			})
		})

		it("scrolls back to a change that has gone out of view", async () => {
			await withPage(2000, async page => {
				await cell(page, 0, 3).click()
				await page.keyboard.type("5")
				await press(page, "Enter")
				await press(page, "Control+End")
				await expect.poll(() => cell(page, 0, 3).count()).toBe(0)

				await press(page, "Control+Z")
				await expect.poll(() => cell(page, 0, 3).isVisible()).toBe(true)
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 0, col: 3 } })
			})
		})

		it("leaves Ctrl+Z to the editor while a cell is being edited", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 3).click()
				await press(page, "F2")
				await page.keyboard.type("9")

				const before = await revision(page)

				await press(page, "Control+Z")

				await expect(page.locator(".tabula-grid-input.is-editing").count()).resolves.toBe(1)
				await expect(revision(page)).resolves.toBe(before)
			})
		})

		it("keeps the buttons of a shared history in step, and undoes from them", async () => {
			await withPage(20, async page => {
				await expect(button(page, "undo").isDisabled()).resolves.toBe(true)
				await expect(button(page, "redo").isDisabled()).resolves.toBe(true)

				const original = await valueAt(page, 0, "note")

				await cell(page, 0, 8).click()
				await page.keyboard.type("not")
				await press(page, "Enter")
				await expect.poll(() => button(page, "undo").isDisabled()).toBe(false)

				await button(page, "undo").click()
				await expect.poll(() => valueAt(page, 0, "note")).toEqual(original)
				await expect(button(page, "undo").isDisabled()).resolves.toBe(true)
				await expect(button(page, "redo").isDisabled()).resolves.toBe(false)

				// The button handed the keyboard back to the grid.
				await press(page, "Control+Y")
				await expect.poll(() => valueAt(page, 0, "note")).toBe("not")
			})
		})
	})

	describe("selecting from the edges", () => {
		it("selects a column from its header, a row from its number and everything from the corner", async () => {
			await withPage(20, async page => {
				await header(page, 3).click({ position: { x: 20, y: 10 } })

				await expect(selected(page)).resolves.toEqual({
					active: { row: 0, col: 3 },
					range: { top: 0, left: 3, bottom: 19, right: 3 }
				})

				await header(page, 5).click({ position: { x: 20, y: 10 }, modifiers: ["Shift"] })

				await expect(selected(page)).resolves.toMatchObject({
					range: { top: 0, left: 3, bottom: 19, right: 5 }
				})

				await page.locator(".tabula-grid-gutter .tabula-grid-rh", { hasText: /^\s*3\s*$/ }).click()

				await expect(selected(page)).resolves.toEqual({
					active: { row: 2, col: 0 },
					range: { top: 2, left: 0, bottom: 2, right: COLUMNS.length - 1 }
				})

				await page.locator(".tabula-grid-corner").click()

				await expect(selected(page)).resolves.toMatchObject({
					range: { top: 0, left: 0, bottom: 19, right: COLUMNS.length - 1 }
				})
			})
		})
	})

	describe("the backend", () => {
		const status = (page: Page): Promise<string> => page.locator(".playground-status").innerText()
		const gutter = (page: Page, row: number): Locator => page.locator(".tabula-grid-rh").nth(row)
		const items = (page: Page): Locator => page.locator(".tabula-issues-item")

		async function type(page: Page, row: number, col: number, text: string): Promise<void> {
			await cell(page, row, col).click()
			await page.keyboard.type(text)
			await press(page, "Enter")
		}

		it("checks the sheet with the backend and shows its issues on cells and in the list", async () => {
			await withPage(20, async page => {
				await page.locator(".playground-check").click()

				await expect.poll(() => status(page)).toBe("Ön kontrol sorun buldu.")
				await expect(cell(page, 8, 0).getAttribute("class")).resolves.toContain("is-error")
				await expect(cell(page, 8, 0).getAttribute("title")).resolves.toBe("Ürün pasif; fiyatı güncellenemez.")
				await expect(items(page).count()).resolves.toBe(2)
				await expect(items(page).first().innerText()).resolves.toBe(
					"Satır 9 · Ürün\nÜrün pasif; fiyatı güncellenemez."
				)
			})
		})

		it("marks a backend issue stale once its cell changes, and counts it apart until checked again", async () => {
			await withPage(20, async page => {
				await page.locator(".playground-check").click()
				await expect.poll(() => status(page)).toBe("Ön kontrol sorun buldu.")

				// Another product, by its name: matched to it, and the backend's word on the old one goes stale.
				await type(page, 8, 0, "Ürün 000500")

				await expect.poll(() => cell(page, 8, 0).getAttribute("class")).toContain("is-stale")
				await expect(cell(page, 8, 0).getAttribute("title")).resolves.toBe(
					"Değişti, yeniden kontrol edilmeli: Ürün pasif; fiyatı güncellenemez."
				)
				await expect(page.locator(".tabula-issues-count.is-stale").innerText()).resolves.toBe(
					"1 yeniden kontrol"
				)
				await expect(page.locator(".tabula-issues-count.is-error").innerText()).resolves.toBe("1 hata")

				// Checked again: the product it holds now is active.
				await page.locator(".playground-check").click()
				await expect.poll(() => cell(page, 8, 0).getAttribute("title")).toBeNull()
				await expect(valueAt(page, 8, "productId")).resolves.toEqual({ id: 1499, label: "Ürün 000500" })
			})
		})

		it("processes the sheet, shows each row's result by its number, and locks the rows that went through", async () => {
			await withPage(20, async page => {
				await type(page, 2, 8, "red alert")
				await page.locator(".playground-process").click()

				await expect.poll(() => status(page)).toBe("17 başarılı, 3 başarısız, 0 işlenmedi.")
				await expect(gutter(page, 0).getAttribute("class")).resolves.toContain("is-succeeded")
				await expect(gutter(page, 0).getAttribute("title")).resolves.toBe("İşlendi")
				// Refused by a rule only a run applies: an issue about the row as a whole, on its number.
				await expect(gutter(page, 2).getAttribute("class")).resolves.toContain("is-failed")
				await expect(gutter(page, 2).getAttribute("title")).resolves.toBe(
					"İşlenemedi\nSatır onay kuralına takıldı."
				)
				await expect(cell(page, 8, 0).getAttribute("class")).resolves.toContain("is-error")

				// A processed row is shown, not changed.
				const price = await valueAt(page, 0, "newPrice")

				await type(page, 0, 3, "1")
				await expect(valueAt(page, 0, "newPrice")).resolves.toBe(price)
				await expect(cell(page, 0, 3).getAttribute("aria-readonly")).resolves.toBe("true")
				// What was sent cannot be taken back in the sheet alone.
				await expect(page.locator(".playground-undo").isDisabled()).resolves.toBe(true)
			})
		})

		it("goes on with the rows that failed, and sends only those", async () => {
			await withPage(8, async page => {
				await type(page, 1, 8, "red")
				await type(page, 4, 8, "red")
				await page.locator(".playground-process").click()
				await expect.poll(() => status(page)).toBe("6 başarılı, 2 başarısız, 0 işlenmedi.")

				await page.locator(".playground-remove-done").click()
				await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(2)

				await cell(page, 0, 8).click()
				await press(page, "Shift+ArrowDown")
				await press(page, "Delete")
				await page.locator(".playground-process").click()

				await expect.poll(() => status(page)).toBe("2 başarılı, 0 başarısız, 0 işlenmedi.")
				await expect(page.evaluate(() => window.__playground!.session.state.run?.rows)).resolves.toBe(2)
			})
		})

		it("sends the same run again after an answer is lost, and the backend does it once", async () => {
			await withPage(8, async page => {
				await page.evaluate(() => (window.__playground!.backend.loseNextAnswer = true))
				await page.locator(".playground-process").click()

				await expect.poll(() => status(page)).toContain("Yanıt gelmedi")
				await expect(gutter(page, 0).getAttribute("class")).resolves.toContain("is-sending")

				await page.locator(".playground-resend").click()

				await expect.poll(() => status(page)).toBe("8 başarılı, 0 başarısız, 0 işlenmedi.")
				await expect(page.evaluate(() => [...window.__playground!.backend.done.values()])).resolves.toEqual([1])
			})
		})

		it("follows a slow run, showing how far it has got, to its end", async () => {
			await withPage(8, async page => {
				await page.evaluate(() => {
					window.__playground!.backend.slow = true
					window.__playground!.backend.delay = 200
				})
				await page.locator(".playground-process").click()

				await expect.poll(() => status(page)).toMatch(/^İşleniyor \d\/8…$/)
				await expect.poll(() => status(page), { timeout: 5000 }).toBe("8 başarılı, 0 başarısız, 0 işlenmedi.")
			})
		})

		it("stops a slow run on request, and what was done stays done", async () => {
			await withPage(8, async page => {
				await page.evaluate(() => {
					window.__playground!.backend.slow = true
					window.__playground!.backend.delay = 200
				})
				await page.locator(".playground-process").click()
				await expect.poll(() => status(page)).toMatch(/^İşleniyor/)

				await page.locator(".playground-stop").click()

				await expect.poll(() => status(page), { timeout: 5000 }).toBe("4 başarılı, 0 başarısız, 4 işlenmedi.")
				await expect(gutter(page, 0).getAttribute("class")).resolves.toContain("is-succeeded")
				await expect(gutter(page, 7).getAttribute("class")).resolves.toContain("is-skipped")
			})
		})
	})

	describe("lookups and lists", () => {
		const list = (page: Page): Locator => page.locator(".tabula-grid-list")
		const options = (page: Page): Locator => list(page).locator(".tabula-grid-option")
		const editor = (page: Page): Locator => page.locator(".tabula-grid-input")
		const calls = (page: Page): Promise<string[]> =>
			page.evaluate(() => [...window.__playground!.backend.lookupCalls])

		it("lists a lookup's records as the user types, and picks one with the keyboard", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 0).click()
				await page.keyboard.type("termos")

				await expect.poll(() => options(page).count()).toBe(3)
				await expect(options(page).allInnerTexts()).resolves.toEqual([
					"Çelik Termos 500 ml\nTRM-500",
					"Termos\nTRM-750",
					"Termos\nTRM-1000"
				])
				await expect(editor(page).getAttribute("role")).resolves.toBe("combobox")
				await expect(editor(page).getAttribute("aria-expanded")).resolves.toBe("true")
				// Two records are named "Termos": none is chosen for the user.
				await expect(list(page).locator(".is-highlighted").count()).resolves.toBe(0)

				await press(page, "ArrowDown", 3)
				await expect(editor(page).getAttribute("aria-activedescendant")).resolves.toMatch(/-list-2$/)
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "productId")).toEqual({ id: 90_003, label: "Termos" })
				await expect(list(page).count()).resolves.toBe(0)
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 1, col: 0 } })
			})
		})

		it("picks with a click, and shows but never picks a record that cannot be", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 0).click()
				await page.keyboard.type("Ürün 000009")

				await expect.poll(() => options(page).count()).toBe(1)
				await expect(options(page).first().getAttribute("aria-disabled")).resolves.toBe("true")

				// Forced: a browser automation tool itself will not click what says it is disabled.
				await options(page).first().click({ force: true })
				await expect(list(page).count()).resolves.toBe(1)

				// Kept as typed, and marked: an inactive product is no record to hold.
				await press(page, "Enter")
				await expect
					.poll(() => cell(page, 0, 0).getAttribute("title"))
					.toBe("“Ürün 000009” bir kayıtla eşleşmedi; listeden seçin.")

				await cell(page, 1, 0).click()
				await page.keyboard.type("kupa")
				await expect.poll(() => options(page).count()).toBe(1)
				await options(page).first().click()

				await expect.poll(() => valueAt(page, 1, "productId")).toEqual({ id: 90_004, label: "Kupa" })
			})
		})

		it("matches pasted names in one request, and takes back the paste and its matches in one undo", async () => {
			await withPage(20, async page => {
				const original = await valueAt(page, 0, "productId")

				await cell(page, 0, 0).click()
				await clipboard(page, "Kupa\r\nÇelik Termos 500 ml\r\nYok böyle bir ürün\r\n")
				await press(page, "Control+V")

				await expect.poll(() => valueAt(page, 0, "productId")).toEqual({ id: 90_004, label: "Kupa" })
				await expect(valueAt(page, 1, "productId")).resolves.toEqual({
					id: 90_001,
					label: "Çelik Termos 500 ml"
				})
				await expect(valueAt(page, 2, "productId")).resolves.toBe("Yok böyle bir ürün")
				await expect(calls(page)).resolves.toEqual(["resolve:Kupa|Çelik Termos 500 ml|Yok böyle bir ürün"])

				await press(page, "Control+Z")

				await expect.poll(() => valueAt(page, 0, "productId")).toEqual(original)
				await expect(page.locator(".playground-undo").isDisabled()).resolves.toBe(true)
			})
		})

		it("lists an options field's choices, all of them with Alt+Down", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 5).click()
				await press(page, "Alt+ArrowDown")

				await expect.poll(() => options(page).allInnerTexts()).toEqual(["TRY", "USD", "EUR"])

				await press(page, "ArrowDown", 2)
				await press(page, "Enter")
				await expect.poll(() => valueAt(page, 0, "currency")).toBe("USD")

				// Narrowed to one by what is typed, it is the one Enter picks.
				await cell(page, 1, 5).click()
				await page.keyboard.type("eu")
				await expect.poll(() => options(page).count()).toBe(1)
				await press(page, "Enter")
				await expect.poll(() => valueAt(page, 1, "currency")).toBe("EUR")
			})
		})

		it("closes the list with Escape, and the edit with a second one", async () => {
			await withPage(20, async page => {
				const original = await valueAt(page, 0, "productId")

				await cell(page, 0, 0).click()
				await page.keyboard.type("ter")
				await expect.poll(() => options(page).count()).toBeGreaterThan(0)

				await press(page, "Escape")
				await expect(list(page).count()).resolves.toBe(0)
				await expect(page.locator(".tabula-grid-input.is-editing").count()).resolves.toBe(1)

				await press(page, "Escape")
				await expect(page.locator(".tabula-grid-input.is-editing").count()).resolves.toBe(0)
				await expect(valueAt(page, 0, "productId")).resolves.toEqual(original)
			})
		})
	})

	describe("only the rows with issues", () => {
		const numbers = (page: Page): Promise<string[]> => page.locator(".tabula-grid-rh").allInnerTexts()
		const toggle = (page: Page): Locator => page.locator(".tabula-issues-filter input")

		/** Empties the new price, which is required, on these rows of the sheet. */
		async function breakRows(page: Page, rows: readonly number[]): Promise<void> {
			for (const row of rows) {
				await cell(page, row, 3).click()
				await press(page, "Delete")
			}
		}

		it("shows only the rows with issues, under their numbers in the sheet", async () => {
			await withPage(20, async page => {
				await breakRows(page, [2, 7])
				await toggle(page).check()

				await expect.poll(() => numbers(page)).toEqual(["3", "8"])
				await expect(page.locator(".tabula-grid").getAttribute("class")).resolves.toContain("is-filtered")
				await expect(page.locator(".playground-size").innerText()).resolves.toBe("2 / 20 satır")
				// The first row on screen is the sheet's third.
				await expect(cell(page, 0, 0).innerText()).resolves.toBe("Ürün 000003")

				await toggle(page).uncheck()

				await expect.poll(() => numbers(page).then(list => list.slice(0, 3))).toEqual(["1", "2", "3"])
				await expect(page.locator(".tabula-grid").getAttribute("class")).resolves.not.toContain("is-filtered")
			})
		})

		it("keeps a row the user fixes on screen until the filter is applied again", async () => {
			await withPage(20, async page => {
				await breakRows(page, [2, 7])
				await toggle(page).check()
				await expect.poll(() => numbers(page)).toEqual(["3", "8"])

				await cell(page, 0, 3).click()
				await page.keyboard.type("10")
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 2, "newPrice")).toBe("10")
				await expect(numbers(page)).resolves.toEqual(["3", "8"])

				await page.locator(".tabula-issues-filter button").click()

				await expect.poll(() => numbers(page)).toEqual(["8"])
			})
		})

		it("goes to an issue on a row the filter left out, and shows that row in its place", async () => {
			await withPage(20, async page => {
				await breakRows(page, [2, 7])
				await toggle(page).check()
				await expect.poll(() => numbers(page)).toEqual(["3", "8"])

				// An issue appears on a row the filter left out.
				await page.evaluate(() => {
					const { store } = window.__playground!

					store.setCell(store.rowIdAt(5)!, "newPrice", null)
				})

				await page.locator(".tabula-issues-item", { hasText: "Satır 6" }).click()

				await expect.poll(() => numbers(page)).toEqual(["3", "6", "8"])
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 1, col: 3 } })
			})
		})

		it("pastes into the rows shown, never into one the filter hides, and adds rows past the last", async () => {
			await withPage(20, async page => {
				await breakRows(page, [2, 7])
				await toggle(page).check()
				await expect.poll(() => numbers(page)).toEqual(["3", "8"])

				await cell(page, 0, 3).click()
				await clipboard(page, "1\r\n2\r\n3\r\n")
				await press(page, "Control+V")

				await expect.poll(() => numbers(page)).toEqual(["3", "8", "21"])
				await expect(valueAt(page, 2, "newPrice")).resolves.toBe("1")
				await expect(valueAt(page, 7, "newPrice")).resolves.toBe("2")
				await expect(valueAt(page, 20, "newPrice")).resolves.toBe("3")
				// The rows in between, hidden, kept what they held.
				await expect(valueAt(page, 3, "newPrice")).resolves.not.toBeNull()
			})
		})
	})

	describe("formulas", () => {
		/** The "Fark" column: [newPrice] - [currentPrice]. */
		const DIFFERENCE = 9

		async function type(page: Page, row: number, col: number, text: string): Promise<void> {
			await cell(page, row, col).click()
			await page.keyboard.type(text)
			await press(page, "Enter")
		}

		it("works a column out from its row, keeps it from being typed into, and works it out again", async () => {
			await withPage(20, async page => {
				// 1.493,91 - 1.571,41
				await expect(valueAt(page, 0, "difference")).resolves.toBe("-77.5")
				await expect(header(page, DIFFERENCE).getAttribute("title")).resolves.toBe(
					"Fark\n= [newPrice] - [currentPrice]"
				)
				await expect(header(page, DIFFERENCE).locator(".tabula-grid-fx").innerText()).resolves.toBe("ƒx")

				await type(page, 0, 3, "1600")

				await expect.poll(() => valueAt(page, 0, "difference")).toBe("28.59")
				await expect.poll(() => cell(page, 0, DIFFERENCE).innerText()).toBe("28,59")

				await type(page, 0, DIFFERENCE, "5")
				await expect(valueAt(page, 0, "difference")).resolves.toBe("28.59")
			})
		})

		it("takes back an edit and what its formula worked out, in one undo", async () => {
			await withPage(20, async page => {
				await type(page, 0, 3, "1600")
				await expect.poll(() => valueAt(page, 0, "difference")).toBe("28.59")

				await press(page, "Control+Z")

				await expect.poll(() => valueAt(page, 0, "difference")).toBe("-77.5")
				await expect(page.locator(".playground-undo").isDisabled()).resolves.toBe(true)
			})
		})

		it("shows in its cell a formula that cannot be worked out, and says why", async () => {
			await withPage(20, async page => {
				await type(page, 0, 3, "pahalı")

				await expect.poll(() => cell(page, 0, DIFFERENCE).innerText()).toBe("#VALUE!")
				await expect(cell(page, 0, DIFFERENCE).getAttribute("class")).resolves.toContain("is-error")
				await expect(cell(page, 0, DIFFERENCE).getAttribute("title")).resolves.toBe(
					"Formül hesaplanamadı: #VALUE! (bir değer beklenen türde değil)"
				)
			})
		})
	})

	describe("hiding and pinning columns", () => {
		const headerText = (page: Page, col: number): Promise<string> =>
			header(page, col).locator(".tabula-grid-th-text").innerText()
		const layout = (page: Page) => page.evaluate(() => window.__playground!.columns())

		/** Opens a column's menu from its header and picks an item. */
		async function menu(page: Page, col: number, item: "pin" | "hide" | "show"): Promise<void> {
			await header(page, col).hover()
			await header(page, col).locator(".tabula-grid-th-menu").click()
			await page.locator(`.tabula-grid-menu-${item}`).click()
		}

		async function scrollTo(page: Page, left: number): Promise<void> {
			await page.evaluate(x => {
				const scroller = document.querySelector(".tabula-grid-scroller")!

				scroller.scrollLeft = x
				scroller.dispatchEvent(new Event("scroll"))
			}, left)
		}

		it("hides a column from its header's menu, and shows the hidden ones again", async () => {
			await withPage(20, async page => {
				await menu(page, 1, "hide")

				await expect.poll(() => headerText(page, 1)).toBe("Mevcut fiyat")
				await expect(layout(page)).resolves.toEqual({ hidden: ["sku"] })

				await header(page, 0).hover()
				await header(page, 0).locator(".tabula-grid-th-menu").click()
				await expect(page.locator(".tabula-grid-menu-show").innerText()).resolves.toBe(
					"Gizli kolonları göster (1)"
				)
				await page.locator(".tabula-grid-menu-show").click()

				await expect.poll(() => headerText(page, 1)).toBe("SKU")
			})
		})

		it("pins a column, which stays in place while the sheet scrolls sideways", async () => {
			await withPage(20, async page => {
				await menu(page, 3, "pin")

				// Pinned columns come first.
				await expect.poll(() => headerText(page, 0)).toBe("Yeni fiyat")
				await expect(layout(page)).resolves.toEqual({ pinned: ["newPrice"] })

				const before = await cell(page, 0, 0).boundingBox()
				const header0 = await header(page, 0).boundingBox()

				await scrollTo(page, 500)
				await expect.poll(() => page.locator(".tabula-grid").getAttribute("class")).toContain("is-scrolled-x")

				await expect(cell(page, 0, 0).boundingBox()).resolves.toMatchObject({ x: before?.x, y: before?.y })
				await expect(header(page, 0).boundingBox()).resolves.toMatchObject({ x: header0?.x })

				// A press on the pinned cell is a press on it, however far the rest has scrolled.
				await cell(page, 0, 0).click()
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 0, col: 0 } })
				await page.keyboard.type("5")
				await press(page, "Enter")
				await expect.poll(() => valueAt(page, 0, "newPrice")).toBe("5")
			})
		})

		it("moves across the pinned columns with the keyboard, keeping the active cell clear of them", async () => {
			await withPage(20, async page => {
				await menu(page, 0, "pin")
				await cell(page, 0, 0).click()

				await press(page, "End")
				const scrolled = await page.evaluate(() => document.querySelector(".tabula-grid-scroller")!.scrollLeft)

				expect(scrolled).toBeGreaterThan(0)

				await press(page, "Home")
				await expect(
					page.evaluate(() => document.querySelector(".tabula-grid-scroller")!.scrollLeft)
				).resolves.toBe(scrolled)

				await press(page, "ArrowRight")

				const pinned = await cell(page, 0, 0).boundingBox()
				const next = await cell(page, 0, 1).boundingBox()

				expect(next?.x).toBeGreaterThanOrEqual((pinned?.x ?? 0) + (pinned?.width ?? 0) - 1)
			})
		})

		it("goes to an issue in a hidden column, and shows the column", async () => {
			await withPage(20, async page => {
				await menu(page, 3, "hide")
				await expect.poll(() => headerText(page, 3)).toBe("Değişim %")

				await page.evaluate(() => {
					const { store } = window.__playground!

					store.setCell(store.rowIdAt(2)!, "newPrice", null)
				})
				await page.locator(".tabula-issues-item", { hasText: "Satır 3" }).click()

				await expect.poll(() => headerText(page, 3)).toBe("Yeni fiyat")
				await expect.poll(() => selected(page)).toMatchObject({ active: { row: 2, col: 3 } })
			})
		})

		it("pastes into the columns shown, passing over a hidden one", async () => {
			await withPage(20, async page => {
				const currency = await valueAt(page, 0, "currency")

				await menu(page, 5, "hide")
				await expect.poll(() => headerText(page, 5)).toBe("Geçerlilik başlangıç tarihi (fiyat listesi)")

				await cell(page, 0, 4).click()
				await clipboard(page, "5\t31.12.2026")
				await press(page, "Control+V")

				await expect.poll(() => valueAt(page, 0, "validFrom")).toBe("2026-12-31")
				await expect(valueAt(page, 0, "change")).resolves.toBe("5")
				await expect(valueAt(page, 0, "currency")).resolves.toBe(currency)
			})
		})

		it("keeps the columns as the user left them in the draft", async () => {
			await withPage(20, async page => {
				await menu(page, 3, "pin")
				await expect.poll(() => headerText(page, 0)).toBe("Yeni fiyat")
				await menu(page, 2, "hide")
				await expect
					.poll(() => page.locator(".playground-draft").innerText(), { timeout: 5000 })
					.toMatch(/^Taslak kaydedildi/)

				await Promise.all([page.waitForEvent("load"), page.reload()])
				await page.waitForFunction(() => window.__playground !== undefined)

				await expect(headerText(page, 0)).resolves.toBe("Yeni fiyat")
				await expect(layout(page)).resolves.toEqual({ pinned: ["newPrice"], hidden: ["sku"] })
			})
		})
	})

	describe("drafts", () => {
		const KEY = "tabula-grid.playground.draft"
		const draftStatus = (page: Page): Promise<string> => page.locator(".playground-draft").innerText()
		const status = (page: Page): Promise<string> => page.locator(".playground-status").innerText()
		const gutter = (page: Page, row: number): Locator => page.locator(".tabula-grid-rh").nth(row)
		const stored = (page: Page) =>
			page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, unknown> | null, KEY)

		async function type(page: Page, row: number, col: number, text: string): Promise<void> {
			await cell(page, row, col).click()
			await page.keyboard.type(text)
			await press(page, "Enter")
		}

		/** Runs `action`, which loads the page again, and waits for the playground to be back. */
		async function reloading(page: Page, action: () => Promise<unknown>): Promise<void> {
			await Promise.all([page.waitForEvent("load"), action()])
			await page.waitForFunction(() => window.__playground !== undefined)
		}

		it("keeps the sheet as a draft a moment after a change, and opens it again, rows under the same ids", async () => {
			await withPage(20, async page => {
				const ids = await page.evaluate(() => window.__playground!.store.rowIds())

				await type(page, 1, 3, "77")
				await expect
					.poll(() => draftStatus(page), { timeout: 5000 })
					.toMatch(/^Taslak kaydedildi · \d\d:\d\d:\d\d$/)

				await reloading(page, () => page.reload())

				await expect(valueAt(page, 1, "newPrice")).resolves.toBe("77")
				await expect(page.evaluate(() => window.__playground!.store.rowIds())).resolves.toEqual(ids)
			})
		})

		it("opens a run that never answered still unknown, and processed rows locked", async () => {
			await withPage(8, async page => {
				await page.evaluate(() => (window.__playground!.backend.loseNextAnswer = true))
				await page.locator(".playground-process").click()
				await expect.poll(() => status(page)).toContain("Yanıt gelmedi")
				await expect.poll(() => draftStatus(page), { timeout: 5000 }).toMatch(/^Taslak kaydedildi/)

				await reloading(page, () => page.reload())

				await expect(status(page)).resolves.toContain("Yanıt gelmedi")
				await expect(gutter(page, 0).getAttribute("class")).resolves.toContain("is-sending")

				await page.locator(".playground-resend").click()
				await expect.poll(() => status(page)).toBe("8 başarılı, 0 başarısız, 0 işlenmedi.")
				await expect
					.poll(() => page.evaluate(() => window.__playground!.saver?.dirty), { timeout: 5000 })
					.toBe(false)

				await reloading(page, () => page.reload())

				const price = await valueAt(page, 0, "newPrice")

				await expect(gutter(page, 0).getAttribute("class")).resolves.toContain("is-succeeded")
				await type(page, 0, 3, "1")
				await expect(valueAt(page, 0, "newPrice")).resolves.toBe(price)
			})
		})

		it("does not open a draft of another schema version until asked, then drops only what is gone", async () => {
			await withPage(5, async page => {
				const sample = await valueAt(page, 0, "newPrice")

				await type(page, 0, 3, "55")
				await expect.poll(() => draftStatus(page), { timeout: 5000 }).toMatch(/^Taslak kaydedildi/)

				// As if saved under an older schema, with a field this one no longer has.
				await page.evaluate(key => {
					const draft = JSON.parse(localStorage.getItem(key) ?? "{}")

					draft.schemaVersion = 0
					draft.fields.push({ key: "legacyCode", type: "string" })
					draft.rows[0].values.legacyCode = "ESKİ-1"
					localStorage.setItem(key, JSON.stringify(draft))
				}, KEY)

				await reloading(page, () => page.reload())

				await expect(page.locator(".playground-draft-review").innerText()).resolves.toContain(
					"Bu taslak şemanın 0. sürümüyle kaydedilmiş; şimdiki sürüm 2. Kaldırılan alanlar: legacyCode; 1 satırdaki değerleri atılacak."
				)
				// Neither opened nor written over.
				await expect(valueAt(page, 0, "newPrice")).resolves.toBe(sample)
				await expect(stored(page)).resolves.toMatchObject({ schemaVersion: 0 })

				await reloading(page, () => page.locator(".playground-open-anyway").click())

				await expect(page.locator(".playground-draft-review").count()).resolves.toBe(0)
				await expect(valueAt(page, 0, "newPrice")).resolves.toBe("55")
				await expect(page.evaluate(() => location.search)).resolves.toBe("?rows=5")
				await expect.poll(() => stored(page)).toMatchObject({ schemaVersion: 2 })
				await expect(
					page.evaluate(() =>
						window.__playground!.store.get(window.__playground!.store.rowIdAt(0)!, "legacyCode")
					)
				).resolves.toBeNull()
			})
		})

		it("starts a fresh sheet when the draft is thrown away", async () => {
			await withPage(5, async page => {
				const sample = await valueAt(page, 0, "newPrice")

				await type(page, 0, 3, "55")
				await expect.poll(() => draftStatus(page), { timeout: 5000 }).toMatch(/^Taslak kaydedildi/)

				await reloading(page, () => page.locator(".playground-start-over").click())

				await expect(valueAt(page, 0, "newPrice")).resolves.toBe(sample)
				await expect(stored(page)).resolves.toBeNull()
			})
		})
	})

	describe("theme", () => {
		it("draws in the theme it is given", async () => {
			await withPage(
				20,
				async page => {
					const grid = page.locator(".tabula-grid")

					await expect(grid.getAttribute("data-tabula-theme")).resolves.toBe("dark")
					await expect(grid.evaluate(element => getComputedStyle(element).backgroundColor)).resolves.toBe(
						"rgb(25, 28, 36)"
					)
				},
				"&theme=dark"
			)
		})
	})
})
