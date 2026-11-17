import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Locator, type Page } from "playwright-core"
import { build, preview, type PreviewServer } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { LONG_LABEL } from "../src/sample"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Field keys by column, as the playground's schema lays them out. */
const COLUMNS = ["productId", "sku", "currentPrice", "newPrice", "change", "currency", "validFrom", "active", "note"]

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

function cell(page: Page, row: number, col: number): Locator {
	return page.locator(`.tabula-grid-row[aria-rowindex="${row + 2}"] .tabula-grid-cell[aria-colindex="${col + 1}"]`)
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
				await cell(page, 1, 0).click()
				await clipboard(page, "Kopya ürün")
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
