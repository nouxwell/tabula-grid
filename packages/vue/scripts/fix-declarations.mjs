// Runs after vue-tsc, on the declarations it wrote to dist.
//
// vue-tsc keeps an import of a component as the source writes it, "./TabulaGrid.vue", and writes
// the component's types to TabulaGrid.vue.d.ts. Under "moduleResolution": "NodeNext", TypeScript
// reads "./TabulaGrid.vue" as a file of that name, finds no types for it, and the component is
// `any` to the project. "./TabulaGrid.vue.js" finds TabulaGrid.vue.d.ts under every resolution.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist")
const component = /(["'])(\.{1,2}\/[^"']+\.vue)\1/g

for (const name of fs.readdirSync(dist, { recursive: true })) {
	if (String(name).endsWith(".d.ts")) {
		const file = path.join(dist, String(name))
		const before = fs.readFileSync(file, "utf8")
		const after = before.replace(component, (_whole, quote, specifier) => `${quote}${specifier}.js${quote}`)

		if (after !== before) {
			fs.writeFileSync(file, after)
		}
	}
}
