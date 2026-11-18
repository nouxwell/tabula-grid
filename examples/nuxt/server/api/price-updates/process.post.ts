import type { ProcessRequest, ProcessResponse } from "@nouxwell/tabula-core"

// The run: rows that pass are written, each once per idempotency key.
export default defineEventHandler(async (event): Promise<ProcessResponse> => {
	return processRows(await readBody<ProcessRequest>(event))
})
