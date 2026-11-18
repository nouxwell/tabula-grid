// Makes a template of the rules and columns a user wrote with no template chosen, under the name
// they gave it. One that does not apply to the module schema, or whose name is taken, is refused.
export default defineEventHandler(async event => {
	const { template, problems } = await createPriceTemplate(await readBody(event))

	if (problems.length > 0) {
		throw createError({ statusCode: 422, statusMessage: "The template cannot be made", data: { problems } })
	}

	return template
})
