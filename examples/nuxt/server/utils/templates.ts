import { applyTemplate, ModuleSchema, readTemplate, TabulaError } from "@nouxwell/tabula-core"

/**
 * The module's templates as the example's server keeps them: the ones it starts with, and any saved
 * since, in memory until it stops. A backend keeps them in its database, each saved by a user
 * allowed to, and checks one against the module schema before it keeps it, as here.
 */
const saved = new Map<string, unknown>()

export function priceTemplates(): unknown[] {
	return PRICE_TEMPLATES.map(template => saved.get(template.id) ?? template)
}

/**
 * Keeps a template after checking it: its shape, and that it applies to the module schema. What
 * is wrong comes back whole, each problem where the template wrote it.
 */
export function savePriceTemplate(id: string, body: unknown): { readonly problems: readonly string[] } {
	if (!PRICE_TEMPLATES.some(template => template.id === id)) {
		return { problems: [`There is no template "${id}".`] }
	}

	try {
		const template = readTemplate(body, PRICE_UPDATE.module)

		if (template.id !== id) {
			return { problems: [`id: must be "${id}", the template being saved.`] }
		}

		applyTemplate(ModuleSchema.from(PRICE_UPDATE), template)
	} catch (error) {
		if (error instanceof TabulaError) {
			return {
				problems: error.message
					.split("\n")
					.slice(1)
					.map(line => line.trim())
			}
		}

		throw error
	}

	saved.set(id, body)

	return { problems: [] }
}
