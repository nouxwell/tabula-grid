// Saves a template, as a user allowed to change it does from the rules drawer. One that does not
// apply to the module schema is refused with what is wrong, and nothing is kept.
export default defineEventHandler(async event => {
	const id = getRouterParam(event, "id") ?? ""
	const { problems } = await savePriceTemplate(id, await readBody(event))

	if (problems.length > 0) {
		throw createError({ statusCode: 422, statusMessage: "The template does not apply", data: { problems } })
	}

	return (await priceTemplates()).find(template => (template as { id?: string }).id === id)
})
