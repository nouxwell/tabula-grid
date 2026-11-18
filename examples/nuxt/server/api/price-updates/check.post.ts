import type { CheckResponse, SheetRequest } from "@nouxwell/tabula-core"

// The pre-flight check: nothing is written. From PHP, $tabula->checkRows() comes first.
export default defineEventHandler(async (event): Promise<CheckResponse> => {
	const request = await readBody<SheetRequest>(event)

	return { requestId: request.requestId, issues: request.rows.flatMap(businessIssues) }
})
