import type { LookupResolveRequest, LookupResolveResponse } from "@nouxwell/tabula-core"

// Names typed or pasted into lookup cells, all of a paste in one request, matched to products by
// name or code in Turkish. One record is a match; none or several leave the name for the user.
export default defineEventHandler(async (event): Promise<LookupResolveResponse> => {
	const { labels } = await readBody<LookupResolveRequest>(event)

	return {
		matches: labels.map(label => {
			const needle = label.trim().toLocaleLowerCase("tr")

			return {
				label,
				items: CATALOG.filter(
					item =>
						item.label.toLocaleLowerCase("tr") === needle ||
						(item.description ?? "").split(" · ")[0]?.toLocaleLowerCase("tr") === needle
				)
			}
		})
	}
})
