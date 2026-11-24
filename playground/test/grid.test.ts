import fs from "node:fs"
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

		it("closes a closable panel from its head, and has no close button otherwise", async () => {
			await withPage(20, async page => {
				await expect.poll(() => panel(page).count()).toBe(1)
				await expect(panel(page).getByRole("button", { name: "Kapat" }).count()).resolves.toBe(0)
			})
			await withPage(
				20,
				async page => {
					await panel(page).getByRole("button", { name: "Kapat" }).click()

					await expect.poll(() => panel(page).count()).toBe(0)
				},
				"&closable=1"
			)
		})

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
				await expect(items(page).first().innerText()).resolves.toBe(
					"Satır 3 · Yeni fiyat\nTarayıcı\nBu alan zorunlu.\nHücreye git"
				)
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
						"Row 1 · Yeni fiyat\nBrowser\nThis field is required.\nGo to cell"
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

	describe("the right-click menu", () => {
		const menu = (page: Page): Locator => page.locator(".tabula-grid-context")
		const item = (page: Page, name: string): Locator =>
			menu(page).getByRole("menuitem", { name, exact: false }).first()
		const editTo = async (page: Page, row: number, col: number, text: string): Promise<void> => {
			await cell(page, row, col).click()
			await page.keyboard.type(text)
			await press(page, "Enter")
		}

		it("opens on a cell with its items and their keys, selecting the cell first, and closes on Escape", async () => {
			await withPage(20, async page => {
				await cell(page, 3, 2).click({ button: "right" })

				await expect(selected(page)).resolves.toMatchObject({ active: { row: 3, col: 2 } })
				await expect(menu(page).getByRole("menuitem").allInnerTexts()).resolves.toEqual([
					"Kes\nCtrl+X",
					"Kopyala\nCtrl+C",
					"Yapıştır\nCtrl+V",
					"İçeriği temizle\nDelete",
					"Aşağı doldur\nCtrl+D",
					"Sağa doldur\nCtrl+R",
					"Üste satır ekle\nCtrl++",
					"Alta satır ekle",
					"Satırları sil\nCtrl+−",
					"Yuvarla\n▸",
					"Bu değere göre süz",
					"Artan sırala",
					"Azalan sırala"
				])

				await page.keyboard.press("Escape")

				await expect(menu(page).count()).resolves.toBe(0)
			})
		})

		it("adds a row below the selection, and filters by the cell's value", async () => {
			await withPage(20, async page => {
				const size = (): Promise<number> => page.evaluate(() => window.__playground!.store.size)

				await cell(page, 1, 0).click({ button: "right" })
				await item(page, "Alta satır ekle").click()

				await expect(size()).resolves.toBe(21)
				await expect(valueAt(page, 2, "productId")).resolves.toBeNull()
				await expect(selected(page)).resolves.toMatchObject({ range: { top: 2, bottom: 2, left: 0 } })

				await cell(page, 0, 5).click({ button: "right" })
				await item(page, "Bu değere göre süz").click()

				const currency = await valueAt(page, 0, "currency")
				const shown = await page.evaluate(() => window.__playground!.view.size)
				const holding = await page.evaluate(wanted => {
					const { store } = window.__playground!

					return store.rowIds().filter(rowId => store.get(rowId, "currency") === wanted).length
				}, currency as string)

				expect(shown).toBe(holding)
			})
		})

		it("opens the host's items beside theirs, and emits the one chosen", async () => {
			await withPage(20, async page => {
				await cell(page, 0, 3).click()
				await editTo(page, 0, 3, "12,6")
				await cell(page, 0, 3).click({ button: "right" })
				await item(page, "Yuvarla").hover()
				await page.locator(".tabula-grid-submenu").getByRole("menuitem", { name: "Tam sayıya" }).click()

				await expect(valueAt(page, 0, "newPrice")).resolves.toBe("13")
			})
		})

		it("opens from the keyboard at the active cell, with the issue the cell has", async () => {
			await withPage(20, async page => {
				await editTo(page, 1, 3, "-5")
				await cell(page, 1, 3).click()
				await page.keyboard.press("Shift+F10")

				await expect(menu(page).locator(".tabula-grid-menu-note").allInnerTexts()).resolves.toEqual([
					"En az 0 olmalı."
				])
				await expect(page.evaluate(() => document.activeElement?.textContent)).resolves.toContain("Kes")
			})
		})

		it("opens a header's own menu on a right click there, and the row menu on a row's number", async () => {
			await withPage(20, async page => {
				await header(page, 2).click({ button: "right" })

				await expect(page.locator(".tabula-grid-menu:not(.tabula-grid-context)").count()).resolves.toBe(1)

				await page.keyboard.press("Escape")
				await page.locator(".tabula-grid-rh").nth(4).click({ button: "right" })

				await expect(selected(page)).resolves.toMatchObject({ range: { top: 4, bottom: 4, left: 0 } })
				await expect(menu(page).getByRole("menuitem").allInnerTexts()).resolves.not.toContain(
					"Bu değere göre süz"
				)
			})
		})

		it("stays open and says to use the keys when the browser will not read the clipboard", async () => {
			await withPage(20, async page => {
				await page.evaluate(() => {
					navigator.clipboard.readText = () => Promise.reject(new DOMException("Denied", "NotAllowedError"))
				})
				await cell(page, 1, 3).click({ button: "right" })
				await item(page, "Yapıştır").click()

				await expect
					.poll(() => menu(page).locator(".tabula-grid-menu-note").allInnerTexts())
					.toEqual(["Tarayıcı panoyu okumaya izin vermedi; Ctrl+V ile yapıştırın."])
			})
		})
	})

	describe("a new row, and a sheet with none", () => {
		const NEW_PRICE = 3

		it("adds a row from the row after the last, selects the cell pressed, and takes what is typed", async () => {
			await withPage(
				3,
				async page => {
					const box = await header(page, NEW_PRICE).boundingBox()
					const ghost = page.locator(".tabula-grid-new-row")
					const row = await ghost.boundingBox()

					await ghost.click({ position: { x: box!.x + box!.width / 2 - row!.x, y: 8 } })
					await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(4)
					await page.keyboard.type("250")
					await press(page, "Enter")
					await expect.poll(() => valueAt(page, 3, "newPrice")).toBe("250")

					// The typing, then the row, each a step to take back.
					await press(page, "Control+z", 2)
					await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(3)
				},
				"&entry=1"
			)
		})

		it("pastes into a sheet with no rows from its first cell, adding the rows", async () => {
			await withPage(
				0,
				async page => {
					await expect.poll(() => page.locator(".tabula-grid-new-row").count()).toBe(1)
					await clipboard(page, "\t\t\t100\n\t\t\t200")
					await page.locator(".tabula-grid").first().focus()
					await press(page, "Control+v")

					await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(2)
					await expect(valueAt(page, 1, "newPrice")).resolves.toBe("200")
				},
				"&entry=1"
			)
		})

		it("leaves a row nothing was typed into unchecked, and checks it whole once something is", async () => {
			await withPage(
				0,
				async page => {
					await page.locator(".tabula-grid-new-row").click()
					await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(1)
					await expect(page.evaluate(() => window.__playground!.validator.summary().errors)).resolves.toBe(0)

					await page.evaluate(() => {
						const { store } = window.__playground!

						store.setCell(store.rowIdAt(0)!, "newPrice", "120")
					})
					await expect
						.poll(() => page.evaluate(() => window.__playground!.validator.summary().errors))
						.toBeGreaterThan(0)
				},
				"&entry=1"
			)
		})
	})

	describe("sheet tabs", () => {
		const tab = (page: Page, name: string): Locator => page.locator(".tabula-tabs-tab", { hasText: name }).first()
		const names = (page: Page): Promise<string[]> => page.locator(".tabula-tabs-name").allInnerTexts()
		const open = (page: Page): Promise<string> =>
			page.locator(".tabula-tabs-tab[aria-selected='true'] .tabula-tabs-name").innerText()

		it("offers the ways to add a sheet when + is pressed, and adds the one chosen", async () => {
			await withPage(
				5,
				async page => {
					await page.locator(".tabula-tabs-add").click()
					await expect(page.locator(".tabula-tabs-menu.is-add button").allInnerTexts()).resolves.toEqual([
						"Sunucudaki satırlarla",
						"Boş sayfa\nAynı sütunlar, satır yok"
					])

					// Escape closes it, with nothing added.
					await press(page, "Escape")
					await expect.poll(() => page.locator(".tabula-tabs-menu.is-add").count()).toBe(0)
					await expect(names(page)).resolves.toHaveLength(3)

					await page.locator(".tabula-tabs-add").click()
					await page.locator(".tabula-tabs-menu.is-add button", { hasText: "Boş sayfa" }).click()
					await expect.poll(() => open(page)).toBe("Boş 4")
				},
				"&tabs=1&addmenu=1"
			)
		})

		it("shows each sheet with its errors or a tick, and opens one with a click or the keys", async () => {
			await withPage(
				5,
				async page => {
					await expect
						.poll(() => page.locator(".tabula-tabs-tab").allInnerTexts())
						.toEqual(["Fiyat listesi\n2", "Mart\n✓", "Mağaza"])

					await tab(page, "Mart").click()
					await expect(open(page)).resolves.toBe("Mart")

					// Arrows move between the tabs; Enter opens the one reached.
					await tab(page, "Mart").press("ArrowRight")
					await page.keyboard.press("Enter")
					await expect(open(page)).resolves.toBe("Mağaza")
				},
				"&tabs=1"
			)
		})

		it("renames a tab in place with a double click or F2, and Escape leaves it as it was", async () => {
			await withPage(
				5,
				async page => {
					await tab(page, "Mart").dblclick()
					await page.locator(".tabula-tabs-rename").fill("Mart kampanyası")
					await page.keyboard.press("Enter")

					await expect.poll(() => names(page)).toEqual(["Fiyat listesi", "Mart kampanyası", "Mağaza"])

					await tab(page, "Mağaza").click()
					await page.keyboard.press("F2")
					await page.locator(".tabula-tabs-rename").fill("Başka")
					await page.keyboard.press("Escape")

					await expect(names(page)).resolves.toEqual(["Fiyat listesi", "Mart kampanyası", "Mağaza"])
				},
				"&tabs=1"
			)
		})

		it("adds, duplicates and deletes from its menu, and never deletes the last one", async () => {
			await withPage(
				5,
				async page => {
					const menuItem = (name: string): Locator =>
						page.locator(".tabula-tabs-menu").getByRole("menuitem", { name })

					await page.locator(".tabula-tabs-add").click()
					await expect.poll(() => names(page)).toEqual(["Fiyat listesi", "Mart", "Mağaza", "Sayfa 4"])
					await expect(open(page)).resolves.toBe("Sayfa 4")

					await tab(page, "Mart").click({ button: "right" })
					await menuItem("Çoğalt").click()
					await expect
						.poll(() => names(page))
						.toEqual(["Fiyat listesi", "Mart", "Mart (kopya)", "Mağaza", "Sayfa 4"])

					for (const name of ["Mart (kopya)", "Mağaza", "Sayfa 4", "Mart"]) {
						await tab(page, name).click({ button: "right" })
						await menuItem("Sayfayı sil").click()
					}

					await expect.poll(() => names(page)).toEqual(["Fiyat listesi"])

					await tab(page, "Fiyat listesi").click({ button: "right" })
					await expect(menuItem("Sayfayı sil").isDisabled()).resolves.toBe(true)
				},
				"&tabs=1"
			)
		})

		it("moves a tab by dragging it, the open one staying open, and a short press is a click", async () => {
			await withPage(
				5,
				async page => {
					const middle = async (name: string): Promise<{ x: number; y: number }> => {
						const box = (await tab(page, name).boundingBox())!

						return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
					}
					const right = async (name: string): Promise<number> => {
						const box = (await tab(page, name).boundingBox())!

						return box.x + box.width - 2
					}

					// Fiyat listesi past Mağaza's middle: it lands last, and stays the open one.
					const from = await middle("Fiyat listesi")

					await page.mouse.move(from.x, from.y)
					await page.mouse.down()
					await page.mouse.move(from.x + 20, from.y, { steps: 2 })
					await page.mouse.move(await right("Mağaza"), from.y, { steps: 4 })
					await expect.poll(() => tab(page, "Fiyat listesi").getAttribute("class")).toContain("is-dragging")
					await expect.poll(() => tab(page, "Mağaza").getAttribute("class")).toContain("is-drop-after")
					await page.mouse.up()

					await expect.poll(() => names(page)).toEqual(["Mart", "Mağaza", "Fiyat listesi"])
					await expect(open(page)).resolves.toBe("Fiyat listesi")
					await expect(page.locator(".tabula-tabs-tab.is-dragging").count()).resolves.toBe(0)

					// Mağaza before Mart's middle: first. Dropping it opens nothing.
					const store = await middle("Mağaza")
					const mart = await tab(page, "Mart").boundingBox()

					await page.mouse.move(store.x, store.y)
					await page.mouse.down()
					await page.mouse.move(mart!.x + 4, store.y, { steps: 5 })
					await expect.poll(() => tab(page, "Mart").getAttribute("class")).toContain("is-drop-before")
					await page.mouse.up()

					await expect.poll(() => names(page)).toEqual(["Mağaza", "Mart", "Fiyat listesi"])
					await expect(open(page)).resolves.toBe("Fiyat listesi")

					// Escape puts a drag back; a press that does not move opens the tab.
					const back = await middle("Mart")

					await page.mouse.move(back.x, back.y)
					await page.mouse.down()
					await page.mouse.move(back.x + 200, back.y, { steps: 4 })
					await page.keyboard.press("Escape")
					await page.mouse.up()
					await expect(names(page)).resolves.toEqual(["Mağaza", "Mart", "Fiyat listesi"])

					// So does a pointer the browser cancels, as a touch it takes for scrolling.
					await page.mouse.move(back.x, back.y)
					await page.mouse.down()
					await page.mouse.move(back.x + 200, back.y, { steps: 4 })
					await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")))
					await expect(page.locator(".tabula-tabs-tab.is-dragging").count()).resolves.toBe(0)
					await page.mouse.up()
					await expect(names(page)).resolves.toEqual(["Mağaza", "Mart", "Fiyat listesi"])

					await tab(page, "Mart").click()
					await expect(open(page)).resolves.toBe("Mart")
				},
				"&tabs=1"
			)
		})

		it("moves a tab from its menu or with Ctrl+Shift and an arrow, nothing past either end", async () => {
			await withPage(
				5,
				async page => {
					const menuItem = (name: string): Locator =>
						page.locator(".tabula-tabs-menu").getByRole("menuitem", { name })

					await tab(page, "Fiyat listesi").click({ button: "right" })
					await expect(menuItem("Sola taşı").isDisabled()).resolves.toBe(true)
					await menuItem("Sağa taşı").click()
					await expect.poll(() => names(page)).toEqual(["Mart", "Fiyat listesi", "Mağaza"])

					await tab(page, "Mağaza").click({ button: "right" })
					await expect(menuItem("Sağa taşı").isDisabled()).resolves.toBe(true)
					await page.keyboard.press("Escape")

					// The keys keep the tab focused, so it goes on moving.
					await tab(page, "Mağaza").focus()
					await page.keyboard.press("Control+Shift+ArrowLeft")
					await page.keyboard.press("Control+Shift+ArrowLeft")
					await page.keyboard.press("Control+Shift+ArrowLeft")
					await expect.poll(() => names(page)).toEqual(["Mağaza", "Mart", "Fiyat listesi"])
					await expect(page.evaluate(() => document.activeElement?.textContent?.trim())).resolves.toBe(
						"Mağaza"
					)
					await expect(open(page)).resolves.toBe("Fiyat listesi")
				},
				"&tabs=1"
			)
		})
	})

	describe("formats, marks, colour rules, totals and find", () => {
		const NEW_PRICE = 3
		const NOTE = 8
		const setCell = (page: Page, row: number, key: string, value: string | null) =>
			page.evaluate(
				([index, field, text]) => {
					const { store } = window.__playground!

					store.setCell(store.rowIdAt(index as number)!, field as string, text)
				},
				[row, key, value] as const
			)

		it("draws a column's alignment and decimals as its format says, keeping the value", async () => {
			await withPage(5, async page => {
				await setCell(page, 0, "newPrice", "1533.8")
				await page.evaluate(() =>
					window.__playground!.setColumns({ formats: { newPrice: { align: "center", decimals: 0 } } })
				)

				await expect.poll(() => cell(page, 0, NEW_PRICE).innerText()).toBe("1.534")
				await expect(cell(page, 0, NEW_PRICE).getAttribute("class")).resolves.toContain("is-center")
				await expect(header(page, NEW_PRICE).getAttribute("class")).resolves.toContain("is-center")
				await expect(valueAt(page, 0, "newPrice")).resolves.toBe("1533.8")
			})
		})

		it("draws a template's formats under the user's own, and brings them back when the user's go", async () => {
			await withPage(5, async page => {
				await setCell(page, 0, "newPrice", "1533.8")
				await page.evaluate(() =>
					window.__playground!.setDefaultFormats({ newPrice: { align: "center", decimals: 0 } })
				)

				await expect.poll(() => cell(page, 0, NEW_PRICE).innerText()).toBe("1.534")
				await expect(cell(page, 0, NEW_PRICE).getAttribute("class")).resolves.toContain("is-center")

				// The user's own decimals go over the template's; its alignment stays.
				await page.evaluate(() => window.__playground!.setColumns({ formats: { newPrice: { decimals: 2 } } }))
				await expect.poll(() => cell(page, 0, NEW_PRICE).innerText()).toBe("1.533,80")
				await expect(cell(page, 0, NEW_PRICE).getAttribute("class")).resolves.toContain("is-center")

				await page.evaluate(() => window.__playground!.setColumns({}))
				await expect.poll(() => cell(page, 0, NEW_PRICE).innerText()).toBe("1.534")
				await expect(page.evaluate(() => window.__playground!.columns())).resolves.toEqual({})
			})
		})

		it("puts bold and italic on the cells selected with Ctrl+B and Ctrl+I, and takes them back with Ctrl+Z", async () => {
			await withPage(
				5,
				async page => {
					await cell(page, 0, NEW_PRICE).click()
					await cell(page, 1, NEW_PRICE).click({ modifiers: ["Shift"] })
					await press(page, "Control+b")
					await press(page, "Control+i")

					await expect.poll(() => cell(page, 1, NEW_PRICE).getAttribute("class")).toContain("is-bold")
					await expect(cell(page, 0, NEW_PRICE).getAttribute("class")).resolves.toContain("is-italic")

					await press(page, "Control+z")
					await expect.poll(() => cell(page, 0, NEW_PRICE).getAttribute("class")).not.toContain("is-italic")
					await expect(cell(page, 0, NEW_PRICE).getAttribute("class")).resolves.toContain("is-bold")

					// A fill and a text colour put on by the host.
					await page.evaluate(() => {
						const { marks, store } = window.__playground!

						marks!.mark([{ rowId: store.rowIdAt(2)!, field: "note" }], { fill: "yellow", color: "red" })
					})
					await expect.poll(() => cell(page, 2, NOTE).getAttribute("class")).toContain("is-fill-yellow")
					await expect(cell(page, 2, NOTE).getAttribute("class")).resolves.toContain("is-text-red")
				},
				"&format=1"
			)
		})

		it("colours a cell by the schema's colour rule as its value changes", async () => {
			await withPage(
				5,
				async page => {
					await setCell(page, 0, "newPrice", "50")
					await expect.poll(() => cell(page, 0, NEW_PRICE).getAttribute("class")).toContain("is-fill-orange")

					await setCell(page, 0, "newPrice", "150")
					await expect
						.poll(() => cell(page, 0, NEW_PRICE).getAttribute("class"))
						.not.toContain("is-fill-orange")
				},
				"&format=1"
			)
		})

		it("stretches the columns to the sheet, the last one reaching its edge", async () => {
			await withPage(
				5,
				async page => {
					await page.evaluate(() =>
						window.__playground!.setColumns({
							hidden: [
								"sku",
								"change",
								"currency",
								"validFrom",
								"active",
								"note",
								"difference",
								"channels"
							]
						})
					)

					// The sheet is as wide as the scroller: no room left on the right, and nothing to scroll to.
					const room = () =>
						page.evaluate(() => {
							const scroller = document.querySelector<HTMLElement>(".tabula-grid-scroller")!
							const sheet = document.querySelector<HTMLElement>(".tabula-grid-sheet")!

							return scroller.clientWidth - sheet.offsetWidth
						})

					await expect.poll(room).toBe(0)
				},
				"&format=1"
			)
		})

		it("sums each number column under it, and gives its average, smallest or largest instead", async () => {
			await withPage(
				2,
				async page => {
					await setCell(page, 0, "newPrice", "10")
					await setCell(page, 1, "newPrice", "20.5")

					const totals = () => page.locator(".tabula-grid-totals-cell").allInnerTexts()

					await expect.poll(totals).toContain("30,50")

					const kind = page.locator(".tabula-grid-totals-pick")
					const choose = async (words: string): Promise<void> => {
						await kind.click()
						await page.locator(".tabula-grid-totals-menu li", { hasText: words }).click()
					}

					await expect(kind.innerText()).resolves.toBe("Toplam")
					await choose("Ortalama")
					await expect.poll(totals).toContain("15,25")
					await expect(kind.innerText()).resolves.toBe("Ortalama")
					await choose("En az")
					await expect.poll(totals).toContain("10,00")

					// The keys: an arrow opens the list and moves in it, Enter takes the one reached.
					await kind.focus()
					await expect
						.poll(() =>
							page.evaluate(() => document.activeElement?.classList.contains("tabula-grid-totals-pick"))
						)
						.toBe(true)
					await press(page, "ArrowDown")
					await expect.poll(() => page.locator(".tabula-grid-totals-menu").count()).toBe(1)
					await press(page, "ArrowDown")
					await press(page, "Enter")
					await expect.poll(totals).toContain("20,50")
					await expect.poll(() => page.locator(".tabula-grid-totals-menu").count()).toBe(0)
				},
				"&format=1"
			)
		})

		it("draws the rows taller and the text larger by the zoom", async () => {
			await withPage(
				3,
				async page => {
					const height = (await cell(page, 0, NEW_PRICE).boundingBox())?.height ?? 0
					const size = await cell(page, 0, NEW_PRICE).evaluate(element => getComputedStyle(element).fontSize)

					expect(height).toBe(45)
					expect(size).toBe("19.5px")
				},
				"&zoom=1.5"
			)
		})

		it("finds text with Ctrl+H, goes from one cell found to the next, and replaces them all in one step", async () => {
			await withPage(
				5,
				async page => {
					await setCell(page, 0, "note", "Kampanya A")
					await setCell(page, 1, "note", "kampanya B")
					await setCell(page, 2, "note", "Yok")
					await setCell(page, 3, "note", null)
					await setCell(page, 4, "note", null)
					await cell(page, 0, NOTE).click()
					await press(page, "Control+h")

					const find = page.locator(".tabula-find")

					await expect.poll(() => find.count()).toBe(1)
					await page.keyboard.type("kampanya")
					await expect.poll(() => find.locator(".tabula-find-count").innerText()).toBe("1 / 2 hücre")
					await expect(page.locator(".tabula-grid-cell.is-found-current").count()).resolves.toBe(1)
					await expect(page.locator(".tabula-grid-cell.is-found").count()).resolves.toBe(1)

					await press(page, "Enter")
					await expect.poll(() => find.locator(".tabula-find-count").innerText()).toBe("2 / 2 hücre")

					await find.getByRole("textbox").nth(1).fill("İndirim")
					await find.getByRole("button", { name: "Tümünü değiştir" }).click()

					await expect.poll(() => valueAt(page, 0, "note")).toBe("İndirim A")
					await expect(valueAt(page, 1, "note")).resolves.toBe("İndirim B")
					await expect(valueAt(page, 2, "note")).resolves.toBe("Yok")
					await expect.poll(() => find.locator(".tabula-find-count").innerText()).toBe("Bulunamadı")

					// One step: Ctrl+Z takes both back.
					await page.evaluate(() => window.__playground!.history.undo())
					await expect(valueAt(page, 0, "note")).resolves.toBe("Kampanya A")
					await expect(valueAt(page, 1, "note")).resolves.toBe("kampanya B")

					await find.getByRole("button", { name: "Kapat" }).click()
					await expect.poll(() => find.count()).toBe(0)
					await expect(
						page.locator(".tabula-grid-cell.is-found, .tabula-grid-cell.is-found-current").count()
					).resolves.toBe(0)
				},
				"&format=1"
			)
		})
	})

	describe("where the user is", () => {
		it("gives back the active cell and the scroll, and puts the user there again", async () => {
			await withPage(300, async page => {
				const scroller = page.locator(".tabula-grid-scroller")

				await cell(page, 0, 3).click()
				await press(page, "PageDown", 4)
				await press(page, "ArrowRight", 2)

				const place = await page.evaluate(() => window.__playground!.position())
				const top = await scroller.evaluate(element => element.scrollTop)

				expect(place).toMatchObject({ field: "currency", rowId: expect.any(String) })
				expect(top).toBeGreaterThan(0)

				await press(page, "Control+Home")
				await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)

				await page.evaluate(at => window.__playground!.restorePosition(at!), place)

				await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(top)
				await expect(page.evaluate(() => window.__playground!.position())).resolves.toEqual(place)
			})
		})
	})

	describe("changes, bulk edits and taking rows out", () => {
		const editTo = async (page: Page, row: number, col: number, text: string): Promise<void> => {
			await cell(page, row, col).click()
			await page.keyboard.type(text)
			await press(page, "Enter")
		}

		it("marks a cell changed since the sheet opened, until its value comes back", async () => {
			await withPage(20, async page => {
				await editTo(page, 1, 3, "123")

				await expect.poll(() => cell(page, 1, 3).getAttribute("class")).toContain("is-changed")
				await expect(cell(page, 1, 2).getAttribute("class")).resolves.not.toContain("is-changed")
				await expect(page.evaluate(() => window.__playground!.changes.summary())).resolves.toMatchObject({
					rows: 1,
					cells: 1
				})

				await page.keyboard.press("Control+z")

				await expect.poll(() => cell(page, 1, 3).getAttribute("class")).not.toContain("is-changed")
			})
		})

		it("raises the numbers selected by a percentage, as one step to undo", async () => {
			await withPage(20, async page => {
				const before = await Promise.all([0, 1, 2].map(row => valueAt(page, row, "newPrice")))

				await cell(page, 0, 3).click()
				await cell(page, 2, 3).click({ modifiers: ["Shift"] })

				await expect(
					page.evaluate(() => window.__playground!.adjust({ kind: "percent", by: "10" }))
				).resolves.toBe(3)

				const after = await Promise.all([0, 1, 2].map(row => valueAt(page, row, "newPrice")))

				expect(after).toEqual(before.map(value => (Math.round(Number(value) * 110) / 100).toString()))

				await page.keyboard.press("Control+z")

				await expect(Promise.all([0, 1, 2].map(row => valueAt(page, row, "newPrice")))).resolves.toEqual(before)
			})
		})

		it("takes out rows selected whole with Ctrl+−, a cell's row first selected, and Ctrl+Z brings them back", async () => {
			await withPage(20, async page => {
				const size = (): Promise<number> => page.evaluate(() => window.__playground!.store.size)
				const fifth = await valueAt(page, 4, "productId")

				await cell(page, 4, 2).click()
				await page.keyboard.press("Control+Minus")

				// The first press selects the row, and takes nothing out.
				await expect(size()).resolves.toBe(20)
				await expect(selected(page)).resolves.toMatchObject({ range: { top: 4, bottom: 4, left: 0 } })

				await page.keyboard.press("Control+Minus")

				await expect(size()).resolves.toBe(19)
				await expect(valueAt(page, 4, "productId")).resolves.not.toEqual(fifth)

				await page.keyboard.press("Control+z")

				await expect(size()).resolves.toBe(20)
				await expect(valueAt(page, 4, "productId")).resolves.toEqual(fifth)
			})
		})

		it("draws each column's letter over its header, as the formula bar names it", async () => {
			await withPage(
				20,
				async page => {
					await expect
						.poll(() => page.locator(".tabula-grid-th-letter").allInnerTexts())
						.toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
				},
				"&letters=1"
			)
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
					"Satır 9 · Ürün\nSunucu\nÜrün pasif; fiyatı güncellenemez.\nHücreye git"
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

		it("previews a run: what each row becomes, the backend's value beside the sheet's, and its warnings", async () => {
			await withPage(8, async page => {
				const preview = page.locator(".tabula-preview")

				// Over 5,000: a warning, which does not hold the run back, so the preview shows it.
				await type(page, 1, 3, "6000")
				await page.locator(".playground-preview-open").click()

				// Checked first: the sheet was never checked, and the plan comes from the check.
				await expect
					.poll(() => preview.locator(".tabula-preview-chip").allInnerTexts())
					.toEqual(["2 yeni kayıt", "4 güncelleme", "2 değişmeyen", "1 uyarılı"])
				await expect(preview.locator(".tabula-preview-row").nth(1).innerText()).resolves.toBe(
					"Ürün 000002\nSatır 2\nGüncelleme\nYeni fiyat\n5.454,55\n→\n6.000,00\n5.000 üzerindeki fiyatlar onaya düşer."
				)
				await expect(preview.locator(".tabula-preview-row").first().innerText()).resolves.toBe(
					"Ürün 000001\nSatır 1\nDeğişmeyen\nSunucudaki kayıtla aynı; bir şey değişmeyecek."
				)

				await preview.locator(".tabula-preview-filters button", { hasText: "Yeni" }).click()

				await expect(preview.locator(".tabula-preview-name strong").allInnerTexts()).resolves.toEqual([
					"Ürün 000004",
					"Ürün 000008"
				])
				// A new record's fields, the product only as its heading.
				await expect(preview.locator(".tabula-preview-row").first().innerText()).resolves.toContain(
					"Yeni kayıt\nYeni fiyat\n1.961,31\nDeğişim %\n2,1\nPara birimi\nTRY"
				)

				// A row chosen: the preview steps aside and the grid goes to it.
				await preview.locator(".tabula-preview-row", { hasText: "Ürün 000004" }).click()

				await expect(preview.count()).resolves.toBe(0)
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 3 } })

				// Nothing changed since: the preview opens again without asking the backend.
				const checks = await page.evaluate(() => window.__playground!.session.state.check?.requestId)

				await page.locator(".playground-preview-open").click()
				await preview.waitFor()

				await expect(page.evaluate(() => window.__playground!.session.state.check?.requestId)).resolves.toBe(
					checks
				)
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

		it("fills the row from the record picked, marks what was typed, and empties it with the record", async () => {
			await withPage(
				3,
				async page => {
					const ghost = page.locator(".tabula-grid-new-row")
					const row = await ghost.boundingBox()
					const first = await header(page, 0).boundingBox()

					await ghost.click({ position: { x: first!.x + 20 - row!.x, y: 8 } })
					await expect.poll(() => page.evaluate(() => window.__playground!.store.size)).toBe(4)
					await page.keyboard.type("000005")
					await expect.poll(() => options(page).count()).toBe(1)
					await expect(list(page).locator("mark").allInnerTexts()).resolves.toEqual(["000005", "000005"])

					await options(page).first().click()
					await expect.poll(() => valueAt(page, 3, "sku")).toBe("SKU-000005")
					await expect(valueAt(page, 3, "currentPrice")).resolves.toBe("104.00")
					await expect(cell(page, 3, 1).getAttribute("class")).resolves.toContain("is-filled")
					await expect(cell(page, 3, 1).getAttribute("title")).resolves.toBe(
						"Ürün 000005 kaydından geldi; yazılamaz"
					)

					// The record goes, and what it filled with it.
					await cell(page, 3, 0).click()
					await press(page, "Delete")
					await expect.poll(() => valueAt(page, 3, "sku")).toBeNull()
					await expect(valueAt(page, 3, "currentPrice")).resolves.toBeNull()
				},
				"&fills=1&entry=1"
			)
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
					.toBe("“Ürün 000009” ile eşleşen tek bir kayıt yok; düzeltin ya da listeden seçin.")

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

	describe("CSV", () => {
		const size = (page: Page): Promise<number> => page.evaluate(() => window.__playground!.store.size)
		const notice = (page: Page): Promise<string> => page.locator(".playground-imported span").innerText()

		function importFile(page: Page, buffer: Buffer): Promise<void> {
			return page
				.locator(".playground-import-file")
				.setInputFiles({ name: "fiyatlar.csv", mimeType: "text/csv", buffer })
		}

		it("imports a CSV as a Turkish Excel saves it, matching names to products, as one change", async () => {
			await withPage(20, async page => {
				const csv =
					"\uFEFFÜrün;Yeni fiyat;Para birimi;Geçerlilik başlangıç tarihi (fiyat listesi);note;Renk;SKU\r\n" +
					'Kupa;1.234,5;EUR;31.12.2026;"iki\r\nsatır";mavi;X\r\n' +
					"Ürün 000500;12;TRY;;;;\r\n"

				await importFile(page, Buffer.from(csv, "utf8"))

				await expect.poll(() => size(page)).toBe(22)
				await expect.poll(() => valueAt(page, 20, "productId")).toEqual({ id: 90_004, label: "Kupa" })
				await expect(valueAt(page, 21, "productId")).resolves.toEqual({ id: 1499, label: "Ürün 000500" })
				await expect(valueAt(page, 20, "newPrice")).resolves.toBe("1234.5")
				await expect(valueAt(page, 20, "validFrom")).resolves.toBe("2026-12-31")
				await expect(valueAt(page, 20, "note")).resolves.toBe("iki\nsatır")
				await expect(notice(page)).resolves.toBe(
					"2 satır içe aktarıldı. Eşleşmeyen kolonlar: Renk. Salt okunur kolonlar atlandı: SKU."
				)

				// The rows and the products matched in them go back together.
				await press(page, "Control+Z")
				await expect.poll(() => size(page)).toBe(20)
			})
		})

		it("reads a file Excel saved in Windows-1254 rather than UTF-8", async () => {
			await withPage(5, async page => {
				// "Ürün;Not\r\nKupa;Çelik\r\n" in Windows-1254.
				const bytes = [0xdc, 0x72, 0xfc, 0x6e, 0x3b, 0x6e, 0x6f, 0x74, 0x65, 0x0d, 0x0a]
				const row = [0x4b, 0x75, 0x70, 0x61, 0x3b, 0xc7, 0x65, 0x6c, 0x69, 0x6b, 0x0d, 0x0a]

				await importFile(page, Buffer.from([...bytes, ...row]))

				await expect.poll(() => size(page)).toBe(6)
				await expect(valueAt(page, 5, "note")).resolves.toBe("Çelik")
				await expect(notice(page)).resolves.toBe("1 satır içe aktarıldı. Eksik zorunlu alanlar: Yeni fiyat.")
			})
		})

		it("exports the rows and columns on screen for a Turkish Excel, and keeps a formula in text from running", async () => {
			await withPage(20, async page => {
				await header(page, 1).hover()
				await header(page, 1).locator(".tabula-grid-th-menu").click()
				await page.locator(".tabula-grid-menu-hide").click()
				await page.evaluate(() => {
					const { store } = window.__playground!

					store.setCell(store.rowIdAt(0)!, "note", "=1+1")
				})

				const [download] = await Promise.all([
					page.waitForEvent("download"),
					page.locator(".playground-export").click()
				])
				const text = fs.readFileSync((await download.path()) as string, "utf8")
				const lines = text.slice(1).split("\r\n")

				expect(download.suggestedFilename()).toBe("product.price_update.csv")
				expect(text.charAt(0)).toBe("\uFEFF")
				expect(lines[0]?.startsWith("Ürün;Mevcut fiyat;Yeni fiyat;Değişim %;")).toBe(true)
				expect(lines[0]?.endsWith(";Fark")).toBe(true)
				expect(lines[1]).toBe("Ürün 000001;1571,41;1493,91;-4,9;EUR;28.12.2026;Evet;'=1+1;-77,5")
				expect(lines).toHaveLength(22)
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

		it("maps a field the schema renamed since, suggested by its name, and opens the draft with it", async () => {
			await withPage(5, async page => {
				await type(page, 0, 8, "hasarlı koli")
				await expect.poll(() => draftStatus(page), { timeout: 5000 }).toMatch(/^Taslak kaydedildi/)

				// As if saved when the note was "comment", labelled "Not": the schema calls it "note" now.
				await page.evaluate(key => {
					const draft = JSON.parse(localStorage.getItem(key) ?? "{}")

					draft.schemaVersion = 0
					draft.fields = draft.fields.map((field: { key: string }) =>
						field.key === "note" ? { key: "comment", type: "string", label: "Not" } : field
					)
					draft.rows = draft.rows.map((row: { values: Record<string, unknown> }) => {
						const { note, ...values } = row.values

						return { ...row, values: { ...values, comment: note ?? null } }
					})
					localStorage.setItem(key, JSON.stringify(draft))
				}, KEY)

				await reloading(page, () => page.reload())

				const mapping = page.locator(".tabula-mapping")

				await expect(mapping.locator("select").inputValue()).resolves.toBe("note")
				await expect(mapping.locator(".tabula-mapping-tag.is-suggested").innerText()).resolves.toBe("Önerilen")
				// Its first values, to know it by: the note typed first, then the sample rows' own.
				await expect(mapping.locator(".tabula-mapping-samples").first().innerText()).resolves.toMatch(
					/^hasarlı koli · /
				)
				await expect(mapping.locator(".tabula-mapping-summary").innerText()).resolves.toBe("1 alan eşlendi")

				// Dropped instead: the values it holds would go, and the panel says how many.
				await mapping.locator("select").selectOption("")
				await expect(mapping.locator(".tabula-mapping-tag.is-lost").innerText()).resolves.toMatch(
					/^\d+ satırdaki değer silinecek$/
				)
				await mapping.locator("select").selectOption("note")

				await reloading(page, () => page.locator(".playground-open-anyway").click())

				await expect(page.locator(".tabula-mapping").count()).resolves.toBe(0)
				await expect(valueAt(page, 0, "note")).resolves.toBe("hasarlı koli")
				await expect(page.evaluate(() => location.search)).resolves.toBe("?rows=5")
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
						"rgb(38, 40, 45)"
					)
				},
				"&theme=dark"
			)
		})
	})
})

describe("the bars around the sheet", () => {
	const address = (page: Page): Locator => page.locator(".tabula-formula-address")
	const value = (page: Page): Locator => page.locator(".tabula-formula-value")
	const status = (page: Page): Locator => page.locator(".tabula-status")
	const gridHasFocus = (page: Page): Promise<boolean> =>
		page.evaluate(() => document.activeElement?.closest(".tabula-grid") != null)

	it("shows the active cell's address and value, and writes what is typed there into it", async () => {
		await withPage(20, async page => {
			await cell(page, 1, 3).click()

			await expect.poll(() => address(page).inputValue()).toBe("D2")
			await expect(value(page).inputValue()).resolves.toBe(
				String(await valueAt(page, 1, "newPrice")).replace(".", ",")
			)

			await value(page).fill("123,5")
			await value(page).press("Enter")

			await expect.poll(() => valueAt(page, 1, "newPrice")).toBe("123.5")
			await expect.poll(() => gridHasFocus(page)).toBe(true)
		})
	})

	it("writes into the cell it was typed for when a click moves on, and nothing on Escape", async () => {
		await withPage(20, async page => {
			const before = await valueAt(page, 4, "newPrice")

			await cell(page, 1, 3).click()
			await value(page).fill("777")
			await cell(page, 4, 3).click()

			await expect.poll(() => valueAt(page, 1, "newPrice")).toBe("777")
			await expect(valueAt(page, 4, "newPrice")).resolves.toBe(before)

			const kept = await valueAt(page, 2, "newPrice")

			await cell(page, 2, 3).click()
			await value(page).fill("1")
			await value(page).press("Escape")

			await expect(valueAt(page, 2, "newPrice")).resolves.toBe(kept)
			await expect.poll(() => value(page).inputValue()).toBe(String(kept).replace(".", ","))
		})
	})

	it("goes to an address typed into it, and says so when there is no such cell", async () => {
		await withPage(20, async page => {
			await address(page).fill("b5")
			await address(page).press("Enter")

			await expect.poll(async () => (await selected(page)).active).toEqual({ row: 4, col: 1 })
			await expect(value(page).inputValue()).resolves.toBe("SKU-000005")

			await address(page).fill("Z99")
			await address(page).press("Enter")

			await expect(address(page).getAttribute("aria-invalid")).resolves.toBe("true")
			await expect((await selected(page)).active).toEqual({ row: 4, col: 1 })
		})
	})

	it("shows a formula column's formula by the fields' names, each in its column's colour, not typed over", async () => {
		await withPage(20, async page => {
			await cell(page, 0, 9).click()

			await expect.poll(() => value(page).innerText()).toBe("=[Yeni fiyat] - [Mevcut fiyat]")
			await expect(value(page).getAttribute("aria-readonly")).resolves.toBe("true")
			await expect(
				page.locator(".tabula-formula-ref").evaluateAll(parts => parts.map(part => part.className))
			).resolves.toEqual(["tabula-formula-ref tabula-ref-0", "tabula-formula-ref tabula-ref-1"])

			// The columns it reads, in the same colours: the header, and the cells of its own row stronger.
			await expect(header(page, 3).getAttribute("class")).resolves.toContain("tabula-ref-0")
			await expect(header(page, 2).getAttribute("class")).resolves.toContain("tabula-ref-1")
			await expect(cell(page, 0, 3).getAttribute("class")).resolves.toContain("is-ref-here")
			await expect(cell(page, 1, 3).getAttribute("class")).resolves.not.toContain("is-ref-here")

			// Another cell: the colours go.
			await cell(page, 0, 1).click()

			await expect.poll(() => page.locator(".tabula-grid-th.is-ref").count()).toBe(0)
			await expect(value(page).inputValue()).resolves.toBe("SKU-000001")
		})
	})

	it("counts the rows and the issues, and sums the numbers selected exactly", async () => {
		await withPage(20, async page => {
			await expect.poll(() => status(page).innerText()).toContain("20 satır")

			await cell(page, 0, 2).click()
			await press(page, "Shift+ArrowDown", 2)

			const prices = await Promise.all([0, 1, 2].map(row => valueAt(page, row, "currentPrice")))
			const cents = prices.reduce<number>((total, price) => total + Math.round(Number(price) * 100), 0)
			const sum = (cents / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

			await expect.poll(() => status(page).innerText()).toContain("Seçili: C1:C3")
			await expect(status(page).locator(".tabula-status-sum").innerText()).resolves.toBe(`Toplam: ${sum}`)
			await expect(status(page).locator(".tabula-status-average").innerText()).resolves.toMatch(
				/^Ortalama: [\d.]+,\d{2}$/
			)

			await cell(page, 2, 3).click()
			await press(page, "Delete")

			await expect.poll(() => status(page).innerText()).toContain("20 satır · 1 sorun")
		})
	})

	it("marks a row with an issue by its number, and colours a change by its sign", async () => {
		await withPage(20, async page => {
			await cell(page, 2, 3).click()
			await press(page, "Delete")

			const mark = page.locator(".tabula-grid-rh").nth(2).locator(".tabula-grid-rh-mark")

			await expect.poll(() => mark.getAttribute("class")).toContain("is-error")
			await expect(page.locator(".tabula-grid-rh").nth(3).locator(".tabula-grid-rh-mark").count()).resolves.toBe(
				0
			)

			await cell(page, 0, 4).click()
			await page.keyboard.type("12,5")
			await press(page, "Enter")

			await expect.poll(() => cell(page, 0, 4).innerText()).toMatch(/^\+12,5/)
			await expect(cell(page, 0, 4).getAttribute("class")).resolves.toContain("is-positive")

			await cell(page, 0, 4).click()
			await page.keyboard.type("-3")
			await press(page, "Enter")

			await expect.poll(() => cell(page, 0, 4).getAttribute("class")).toContain("is-negative")
			await expect(cell(page, 0, 4).innerText()).resolves.toMatch(/^-3/)
		})
	})

	it("says whether the browser or the server found each issue", async () => {
		await withPage(20, async page => {
			await cell(page, 2, 3).click()
			await press(page, "Delete")

			const source = (text: string): Locator =>
				page.locator(".tabula-issues-item", { hasText: text }).locator(".tabula-issues-source")

			await expect.poll(() => source("Satır 3").innerText()).toBe("Tarayıcı")

			await page.locator(".playground-check").click()

			await expect.poll(() => source("Satır 9").innerText()).toBe("Sunucu")
		})
	})

	it("lists the issues in a sheet from the bottom on a phone, and steps aside for the cell chosen", async () => {
		await withPage(
			20,
			async page => {
				const bar = page.locator(".tabula-issues-bar")
				const sheet = page.locator('.tabula-issues-body[role="dialog"]')

				await expect.poll(() => bar.innerText()).toBe("Sorun yok.")

				await cell(page, 2, 3).click()
				await press(page, "Delete")

				await expect.poll(() => bar.innerText()).toBe("1 hata")
				await expect(bar.getAttribute("class")).resolves.toContain("is-error")
				await expect(sheet.count()).resolves.toBe(0)

				await cell(page, 0, 0).click()
				await bar.click()
				await expect.poll(() => sheet.count()).toBe(1)

				await sheet.locator(".tabula-issues-item").click()

				await expect.poll(() => sheet.count()).toBe(0)
				await expect.poll(async () => (await selected(page)).active).toEqual({ row: 2, col: 3 })
			},
			"&issues=sheet"
		)
	})
})

describe("sorting and filtering", () => {
	/** Opens a column's menu from its header and picks an item. */
	async function menu(page: Page, col: number, item: string): Promise<void> {
		await header(page, col).hover()
		await header(page, col).locator(".tabula-grid-th-menu").click()
		await page.locator(`.tabula-grid-menu-${item}`).click()
	}

	/** The values of a field in the rows shown, top to bottom. */
	function shownValues(page: Page, key: string): Promise<unknown[]> {
		return page.evaluate(field => {
			const { view, store } = window.__playground!

			return Array.from({ length: view.size }, (_, index) => store.get(view.rowIdAt(index)!, field))
		}, key)
	}

	function allValues(page: Page, key: string): Promise<unknown[]> {
		return page.evaluate(field => {
			const { store } = window.__playground!

			return store.rowIds().map(rowId => store.get(rowId, field))
		}, key)
	}

	const panel = (page: Page): Locator => page.locator(".tabula-grid-filter")

	it("sorts by a column from its header, numbers by their value, and goes back to the sheet's order", async () => {
		await withPage(20, async page => {
			await menu(page, 3, "sort-asc")

			const prices = (await shownValues(page, "newPrice")).map(Number)

			expect(prices).toEqual([...prices].sort((a, b) => a - b))
			await expect(header(page, 3).getAttribute("aria-sort")).resolves.toBe("ascending")
			await expect(header(page, 3).locator(".tabula-grid-sort").innerText()).resolves.toBe("↑")
			// The row numbers stay the rows' numbers in the sheet.
			await expect(page.locator(".tabula-grid").getAttribute("class")).resolves.toContain("is-filtered")

			await menu(page, 3, "sort-desc")

			const down = (await shownValues(page, "newPrice")).map(Number)

			expect(down).toEqual([...down].sort((a, b) => b - a))

			await menu(page, 3, "sort-clear")

			await expect.poll(() => shownValues(page, "newPrice")).toEqual(await allValues(page, "newPrice"))
			await expect(header(page, 3).getAttribute("aria-sort")).resolves.toBeNull()
		})
	})

	it("keeps the values ticked in a column's filter, and counts the rows shown", async () => {
		await withPage(20, async page => {
			await menu(page, 5, "filter")
			await expect.poll(() => panel(page).count()).toBe(1)

			await panel(page).locator(".tabula-grid-filter-list label", { hasText: "TRY" }).click()
			await panel(page).locator(".tabula-grid-filter-apply").click()

			const currencies = await shownValues(page, "currency")
			const others = (await allValues(page, "currency")).filter(value => value !== "TRY")

			expect(currencies).toEqual(others)
			await expect(header(page, 5).locator(".tabula-grid-filtered").count()).resolves.toBe(1)
			await expect.poll(() => page.locator(".tabula-status-rows").innerText()).toBe(`${others.length} / 20 satır`)

			await menu(page, 5, "filter-clear")

			await expect.poll(() => shownValues(page, "currency")).toEqual(await allValues(page, "currency"))
			await expect(header(page, 5).locator(".tabula-grid-filtered").count()).resolves.toBe(0)
		})
	})

	it("keeps a range of numbers typed as the sheet writes them, and says so when one cannot be read", async () => {
		await withPage(20, async page => {
			await menu(page, 3, "filter")
			await panel(page).locator(".tabula-grid-filter-from").fill("abc")
			await panel(page).locator(".tabula-grid-filter-apply").click()

			await expect(panel(page).locator(".tabula-grid-filter-problem").innerText()).resolves.toBe(
				"Bu değer okunamadı; sütunun yazdığı gibi yazın."
			)

			await panel(page).locator(".tabula-grid-filter-from").fill("1.000")
			await panel(page).locator(".tabula-grid-filter-to").press("Enter")

			const kept = (await shownValues(page, "newPrice")).map(Number)
			const expected = (await allValues(page, "newPrice")).map(Number).filter(price => price >= 1000)

			expect(kept).toEqual(expected)
			expect(kept.length).toBeGreaterThan(0)
			await expect(panel(page).count()).resolves.toBe(0)
		})
	})

	it("narrows the list by a search, and keeps only the values found and ticked", async () => {
		await withPage(20, async page => {
			await menu(page, 5, "filter")
			await panel(page).locator(".tabula-grid-filter-search").fill("eu")

			await expect.poll(() => panel(page).locator(".tabula-grid-filter-value").allInnerTexts()).toEqual(["EUR"])

			await panel(page).locator(".tabula-grid-filter-apply").click()

			const kept = await shownValues(page, "currency")

			expect(kept.length).toBeGreaterThan(0)
			expect(kept.every(value => value === "EUR")).toBe(true)
		})
	})

	it("filters beside the issue panel's switch, each taken away alone", async () => {
		await withPage(20, async page => {
			await cell(page, 2, 3).click()
			await press(page, "Delete")
			await page.locator(".tabula-issues-filter input").check()

			await expect.poll(() => page.evaluate(() => window.__playground!.view.size)).toBe(1)

			await menu(page, 3, "sort-desc")
			await page.locator(".tabula-issues-filter input").uncheck()

			// The issue filter goes; the sort stands.
			await expect.poll(() => page.evaluate(() => window.__playground!.view.size)).toBe(20)
			await expect(header(page, 3).getAttribute("aria-sort")).resolves.toBe("descending")
		})
	})
})

describe("filling", () => {
	/** Writes values straight into the store, by row on screen. */
	function put(page: Page, key: string, values: readonly unknown[]): Promise<void> {
		return page.evaluate(
			([field, list]) => {
				const { store } = window.__playground!

				list.forEach((value, index) => store.setCell(store.rowIdAt(index)!, field, value as never))
			},
			[key, values] as const
		)
	}

	function column(page: Page, key: string, count: number): Promise<unknown[]> {
		return Promise.all(Array.from({ length: count }, (_, row) => valueAt(page, row, key)))
	}

	/** Drags the fill handle to a cell, holding a key when letting go if told to. */
	async function dragHandle(page: Page, to: Locator, hold?: string, check?: () => Promise<void>): Promise<void> {
		const handle = await page.locator(".tabula-grid-fill").boundingBox()
		const target = await to.boundingBox()

		if (!handle || !target) {
			throw new Error("The fill handle or the target cell is not on screen.")
		}

		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
		await page.mouse.down()
		await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 })
		await check?.()

		if (hold) {
			await page.keyboard.down(hold)
		}

		await page.mouse.up()

		if (hold) {
			await page.keyboard.up(hold)
		}
	}

	it("drags a series down from two prices, selects what it filled, and undoes it in one step", async () => {
		await withPage(20, async page => {
			const before = await column(page, "newPrice", 5)

			await put(page, "newPrice", ["10", "20"])
			await cell(page, 0, 3).click()
			await press(page, "Shift+ArrowDown")
			await dragHandle(page, cell(page, 4, 3), undefined, async () => {
				await expect(page.locator(".tabula-grid-fill-preview").count()).resolves.toBe(1)
			})

			await expect.poll(() => column(page, "newPrice", 5)).toEqual(["10", "20", "30", "40", "50"])
			await expect(selected(page)).resolves.toMatchObject({ range: { top: 0, bottom: 4, left: 3, right: 3 } })
			await expect(page.locator(".tabula-grid-fill-preview").count()).resolves.toBe(0)

			await press(page, "Control+z")

			await expect.poll(() => column(page, "newPrice", 5)).toEqual(["10", "20", ...before.slice(2)])
		})
	})

	it("goes on a day at a time from a date, and copies it with Ctrl held", async () => {
		await withPage(20, async page => {
			await put(page, "validFrom", ["2026-12-01"])
			await cell(page, 0, 6).click()
			await dragHandle(page, cell(page, 2, 6))

			await expect.poll(() => column(page, "validFrom", 3)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"])

			await cell(page, 0, 6).click()
			await dragHandle(page, cell(page, 2, 6), "Control")

			await expect.poll(() => column(page, "validFrom", 3)).toEqual(["2026-12-01", "2026-12-01", "2026-12-01"])
		})
	})

	it("fills down as far as the column beside goes when the handle is double-clicked", async () => {
		await withPage(20, async page => {
			await put(page, "newPrice", ["99"])
			await cell(page, 0, 3).click()
			await page.locator(".tabula-grid-fill").dblclick()

			await expect.poll(() => column(page, "newPrice", 20)).toEqual(Array.from({ length: 20 }, () => "99"))
			await expect(selected(page)).resolves.toMatchObject({ range: { top: 0, bottom: 19, left: 3, right: 3 } })
		})
	})

	it("copies the first row down with Ctrl+D, and across into another kind of column with Ctrl+R", async () => {
		await withPage(20, async page => {
			await put(page, "note", ["Kampanya 1"])
			await cell(page, 0, 8).click()
			await press(page, "Shift+ArrowDown", 3)
			await press(page, "Control+d")

			// Copied, not counted on: Ctrl+D never makes a series.
			await expect.poll(() => column(page, "note", 4)).toEqual(Array.from({ length: 4 }, () => "Kampanya 1"))

			await put(page, "active", [true])
			await cell(page, 0, 7).click()
			await press(page, "Shift+ArrowRight")
			await press(page, "Control+r")

			// Yes and no reach a text column as the sheet writes them.
			await expect.poll(() => valueAt(page, 0, "note")).toBe("Evet")
		})
	})

	it("fills a block when the handle is dragged across the corner, down and then across", async () => {
		await withPage(20, async page => {
			const notes = await column(page, "note", 3)

			await put(page, "active", [true])
			await cell(page, 0, 7).click()
			await dragHandle(page, cell(page, 2, 8), undefined, async () => {
				// The preview is the whole block, not one way of it.
				const preview = await page.locator(".tabula-grid-fill-preview").boundingBox()
				const corner = await cell(page, 2, 8).boundingBox()

				if (!preview || !corner) {
					throw new Error("The preview or the corner cell is not on screen.")
				}

				expect(Math.abs(preview.x + preview.width - (corner.x + corner.width))).toBeLessThanOrEqual(2)
				expect(Math.abs(preview.y + preview.height - (corner.y + corner.height))).toBeLessThanOrEqual(2)
			})

			await expect.poll(() => column(page, "active", 3)).toEqual([true, true, true])
			// Across from every row the fill reached: yes as the sheet writes it, in a text column.
			await expect.poll(() => column(page, "note", 3)).toEqual(["Evet", "Evet", "Evet"])
			await expect(selected(page)).resolves.toMatchObject({ range: { top: 0, bottom: 2, left: 7, right: 8 } })

			await press(page, "Control+z")

			await expect.poll(() => column(page, "note", 3)).toEqual(notes)
		})
	})

	it("leaves a column that cannot be edited as it was", async () => {
		await withPage(20, async page => {
			const before = await column(page, "sku", 4)

			await cell(page, 0, 1).click()
			await dragHandle(page, cell(page, 3, 1))

			await expect(column(page, "sku", 4)).resolves.toEqual(before)
			await expect(selected(page)).resolves.toMatchObject({ range: { top: 0, bottom: 3 } })
		})
	})
})

describe("scroll bars", () => {
	it("draws the sheet's own thumbs, which turn the pointer into a hand and scroll the sheet when dragged", async () => {
		await withPage(1000, async page => {
			const thumb = page.locator(".tabula-grid > .tabula-thumb.is-vertical")

			await expect.poll(() => thumb.count()).toBe(1)
			await expect(page.locator(".tabula-grid > .tabula-thumb.is-horizontal").count()).resolves.toBe(1)

			// The browser's own bar is hidden: it would show the arrow, whatever the page asks.
			const scroller = page.locator(".tabula-grid-scroller")

			await expect(
				scroller.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth)
			).resolves.toBe(0)
			await expect(thumb.evaluate(element => getComputedStyle(element).cursor)).resolves.toBe("pointer")

			const box = await thumb.boundingBox()
			const header = await page.locator(".tabula-grid-head").boundingBox()

			if (!box || !header) {
				throw new Error("The thumb or the header is not on screen.")
			}

			// Below the header, which does not scroll.
			expect(box.y).toBeGreaterThanOrEqual(header.y + header.height)

			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
			await page.mouse.down()
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 4 })
			await page.mouse.up()

			await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
			await expect.poll(async () => (await thumb.boundingBox())?.y ?? 0).toBeGreaterThan(box.y + 50)
		})
	})

	it("draws one over the issue list when it is longer than the panel", async () => {
		await withPage(60, async page => {
			await page.evaluate(() => {
				const { store } = window.__playground!

				store.transact(() => {
					for (let index = 0; index < 40; index++) {
						store.setCell(store.rowIdAt(index)!, "newPrice", null)
					}
				})
			})

			const thumb = page.locator(".tabula-issues-body > .tabula-thumb.is-vertical")

			await expect.poll(() => thumb.count()).toBe(1)
			await expect(thumb.evaluate(element => getComputedStyle(element).cursor)).resolves.toBe("pointer")
		})
	})
})

describe("a multi-select cell", () => {
	/**
	 * Goes to the Kanallar column, the last, on a row: the sheet draws only the columns in view, so
	 * a cell of it is reached as a user reaches it, by End, which brings it into view.
	 */
	async function toChannels(page: Page, row: number): Promise<number> {
		const col = Number(await page.locator(".tabula-grid").getAttribute("aria-colcount")) - 1

		await cell(page, row, 0).click()
		await press(page, "End")
		await expect.poll(async () => (await selected(page)).active).toEqual({ row, col })

		return col
	}

	const options = (page: Page) => page.locator(".tabula-grid-list .tabula-grid-option")

	async function picked(page: Page): Promise<string[]> {
		return page.locator('.tabula-grid-list .tabula-grid-option[aria-selected="true"]').allInnerTexts()
	}

	it("shows its options as the sheet writes them, and ticks them in a list from F2", async () => {
		await withPage(
			20,
			async page => {
				const col = await toChannels(page, 0)

				await expect(cell(page, 2, col).innerText()).resolves.toBe("Mağaza, Web")

				await press(page, "F2")

				await expect.poll(() => options(page).allInnerTexts()).toEqual(["Mağaza", "Web", "Pazar yeri"])
				await expect(page.locator(".tabula-grid-list").getAttribute("aria-multiselectable")).resolves.toBe(
					"true"
				)
				await expect(picked(page)).resolves.toEqual(["Mağaza"])

				// Space unticks the highlighted one; down and Space tick the next.
				await press(page, "Space")
				await press(page, "ArrowDown")
				await press(page, "Space")
				await expect(picked(page)).resolves.toEqual(["Web"])

				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 0, "channels")).toEqual(["web"])
				await expect(selected(page)).resolves.toMatchObject({ active: { row: 1, col } })
			},
			"&channels=1"
		)
	})

	it("finds options by what is typed, ticks each with Enter, and writes them in their own order", async () => {
		await withPage(
			20,
			async page => {
				const col = await toChannels(page, 3)

				await page.keyboard.type("paz")
				await expect.poll(() => options(page).allInnerTexts()).toEqual(["Pazar yeri"])
				await press(page, "Enter")
				await page.keyboard.type("we")
				await press(page, "Enter")
				await expect(picked(page)).resolves.toEqual(["Web", "Pazar yeri"])

				// Nothing typed: Enter writes what is ticked.
				await press(page, "Enter")

				await expect.poll(() => valueAt(page, 3, "channels")).toEqual(["web", "market"])
				await expect(cell(page, 3, col).innerText()).resolves.toBe("Web, Pazar yeri")
			},
			"&channels=1"
		)
	})

	it("leaves the cell as it was on Escape, and writes a click's tick when the cell is left", async () => {
		await withPage(
			20,
			async page => {
				const col = await toChannels(page, 2)

				await press(page, "F2")
				await press(page, "Space")
				await press(page, "Escape")

				await expect(valueAt(page, 2, "channels")).resolves.toEqual(["store", "web"])

				await press(page, "Alt+ArrowDown")
				await options(page).filter({ hasText: "Pazar yeri" }).click()
				await expect(picked(page)).resolves.toEqual(["Mağaza", "Web", "Pazar yeri"])
				// Into the column beside, which is in view as this one is.
				await cell(page, 5, col - 1).click()

				await expect.poll(() => valueAt(page, 2, "channels")).toEqual(["store", "web", "market"])
			},
			"&channels=1"
		)
	})

	it("filters by each option, keeping the rows that hold it whatever else they hold", async () => {
		await withPage(
			20,
			async page => {
				const col = await toChannels(page, 0)
				const panel = page.locator(".tabula-grid-filter")

				await header(page, col).hover()
				await header(page, col).locator(".tabula-grid-th-menu").click()
				await page.locator(".tabula-grid-menu-filter").click()

				// Each option once, by its label; a cell of two counts under both. No row holds Pazar yeri.
				await expect
					.poll(() => panel.locator(".tabula-grid-filter-value").allInnerTexts())
					.toEqual(["Mağaza", "Web", "(Boş)"])
				await expect(panel.locator(".tabula-grid-filter-count").allInnerTexts()).resolves.toEqual([
					"10",
					"10",
					"5"
				])

				await panel.locator(".tabula-grid-filter-all").click()
				await panel.locator(".tabula-grid-filter-list label", { hasText: "Web" }).click()
				await panel.locator(".tabula-grid-filter-apply").click()

				const shown = await page.evaluate(() => {
					const { view, store } = window.__playground!

					return Array.from({ length: view.size }, (_, index) => store.get(view.rowIdAt(index)!, "channels"))
				})

				expect(shown).toHaveLength(10)
				expect(shown.every(value => Array.isArray(value) && value.includes("web"))).toBe(true)
			},
			"&channels=1"
		)
	})
})
