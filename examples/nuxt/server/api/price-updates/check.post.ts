import type { CheckResponse, SheetRequest } from "@nouxwell/tabula-core"

// The pre-flight check: nothing is written. It says what each row would do, for the preview before a
// run. From PHP, $tabula->checkRows() comes first.
export default defineEventHandler(async (event): Promise<CheckResponse> => {
	const request = await readBody<SheetRequest>(event)

	return { requestId: request.requestId, issues: request.rows.flatMap(businessIssues), plan: planRows(request) }
})
