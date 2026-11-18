import type { LookupSearchResponse } from "@nouxwell/tabula-core"

// The list under a lookup cell's editor, as the user types.
export default defineEventHandler((event): LookupSearchResponse => {
	const { query = "", limit = "20" } = getQuery(event)
	const needle = String(query).trim().toLocaleLowerCase("tr")
	const found = CATALOG.filter(
		item =>
			item.label.toLocaleLowerCase("tr").includes(needle) ||
			(item.description ?? "").toLocaleLowerCase("tr").includes(needle)
	)
	const count = Math.min(Number(limit) || 20, 50)

	return { items: found.slice(0, count), more: found.length > count }
})
