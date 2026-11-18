// Starts the built example and checks what its server sends, before anything runs in a browser:
// the page drawn on the server with Naive UI's styles and the palette, the grid left for the
// browser, the dark mode taken from the cookie, and the API answering in the grid's contract.
//
//     corepack pnpm -r build && corepack pnpm --filter example-nuxt test

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ModuleSchema, readCheckResponse } from "@nouxwell/tabula-core"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const entry = path.join(root, ".output", "server", "index.mjs")
const port = 3_457
const origin = `http://127.0.0.1:${port}`

if (!fs.existsSync(entry)) {
	console.error("ssr: build the example first: corepack pnpm -r build")
	process.exit(1)
}

const server = spawn(process.execPath, [entry], {
	env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NITRO_PORT: String(port), NITRO_HOST: "127.0.0.1" },
	stdio: ["ignore", "inherit", "inherit"]
})

try {
	await ready()

	// The page, light.
	const page = await fetch(origin)
	const html = await page.text()

	assert.equal(page.status, 200)
	assert.match(html, /Toplu fiyat güncelleme/, "the title the schema gives, fetched and drawn on the server")
	assert.match(html, /Kontrol et/, "the toolbar's AppButtons, drawn on the server")
	assert.match(html, /<style[^>]*cssr-id/, "Naive UI's styles, collected on the server")
	assert.match(html, /--app-primary: #00b27b/, "the palette's variables, light")
	assert.match(html, /--tabula-accent: #00b27b/, "the grid's colours from the palette")
	assert.match(html, /Tablo hazırlanıyor/, "the place the grid takes in the browser")
	assert.doesNotMatch(html, /class="tabula-grid/, "no grid on the server: it is drawn in the browser only")
	assert.doesNotMatch(html, /SKU-000001/, "no rows in the page: the browser fetches them for the grid")
	assert.match(html, /Taslak/, "the page's draft label, drawn on the server")
	assert.doesNotMatch(html, /<html[^>]*class="dark"/, "light unless the cookie says dark")

	// The stylesheet the grid's module adds holds the grid's theme.
	const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(match => match[1])
	const css = (await Promise.all(sheets.map(async href => (await fetch(new URL(href, origin))).text()))).join("\n")

	assert.match(css, /\.tabula-theme/, "the grid's stylesheet is linked from the page")

	// The page, dark, from the cookie: drawn dark on the server, so it does not flash.
	const darkHtml = await (await fetch(origin, { headers: { cookie: "color-mode=dark" } })).text()

	assert.match(darkHtml, /<html[^>]*class="dark"/)
	assert.match(darkHtml, /--app-primary: #00e19b/)

	// The API, in the grid's own contract.
	const schema = ModuleSchema.from(await (await fetch(`${origin}/api/modules/price-update`)).json())

	assert.equal(schema.module, "product.price_update")
	assert.equal(schema.field("productId").type, "lookup")

	const answer = readCheckResponse(
		await (
			await fetch(`${origin}/api/price-updates/check`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					requestId: "req_1",
					module: schema.module,
					schemaVersion: schema.schemaVersion,
					sheetId: schema.module,
					revision: 1,
					rows: [
						{ rowId: "a", values: { productId: 1008, newPrice: "10" } },
						{ rowId: "b", values: { productId: { label: "Bilinmeyen" }, newPrice: "6000" } }
					]
				})
			})
		).json()
	)

	assert.deepEqual(
		answer.issues.map(issue => `${issue.rowId}.${issue.field}:${issue.code}`),
		["a.productId:product_inactive", "b.productId:product_not_found", "b.newPrice:needs_approval"]
	)

	console.log("ssr: the example renders on the server and answers in the grid's contract.")
} catch (error) {
	console.error(`ssr: ${error.message}`)
	process.exitCode = 1
} finally {
	server.kill()
}

async function ready() {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			await fetch(origin)
			return
		} catch {
			await new Promise(resolve => setTimeout(resolve, 200))
		}
	}

	throw new Error(`the server did not start on ${origin}`)
}
