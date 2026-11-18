import { applyTemplate, ModuleSchema, readTemplate, TabulaError } from "@nouxwell/tabula-core"

/**
 * The module's templates as the example's server keeps them: the ones it starts with, any saved
 * since, and any a user made, in memory until it stops. A backend keeps them in its database, each
 * saved by a user allowed to, and checks one against the module schema before it keeps it, as here.
 */
const saved = new Map<string, unknown>()
/** The templates users made, by id, in the order they were made. */
const made: string[] = []

export function priceTemplates(): unknown[] {
	return [...PRICE_TEMPLATES.map(template => saved.get(template.id) ?? template), ...made.map(id => saved.get(id))]
}

function known(id: string): boolean {
	return PRICE_TEMPLATES.some(template => template.id === id) || made.includes(id)
}

/**
 * Keeps a template after checking it: its shape, and that it applies to the module schema. What
 * is wrong comes back whole, each problem where the template wrote it.
 */
export function savePriceTemplate(id: string, body: unknown): { readonly problems: readonly string[] } {
	if (!known(id)) {
		return { problems: [`There is no template "${id}".`] }
	}

	const problems = problemsOf(id, body)

	if (problems.length === 0) {
		saved.set(id, body)
	}

	return { problems }
}

/**
 * Makes a template of rules and columns written with no template chosen: its id from its name,
 * "Mart kampanyası" as "mart-kampanyasi", and checked as any template is. A name another template
 * has already is refused.
 */
export function createPriceTemplate(body: unknown): {
	readonly template: unknown
	readonly problems: readonly string[]
} {
	const given = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}
	const name = typeof given.name === "string" ? given.name.trim() : ""

	if (name === "") {
		return { template: null, problems: ["name: must be a non-empty string."] }
	}

	const taken = priceTemplates().map(template =>
		String((template as { name?: unknown }).name).toLocaleLowerCase("tr")
	)

	if (taken.includes(name.toLocaleLowerCase("tr"))) {
		return { template: null, problems: [`name: another template is called "${name}".`] }
	}

	const id = freeId(slug(name))
	const template = { ...given, id, name }
	const problems = problemsOf(id, template)

	if (problems.length > 0) {
		return { template: null, problems }
	}

	saved.set(id, template)
	made.push(id)

	return { template, problems: [] }
}

function problemsOf(id: string, body: unknown): string[] {
	try {
		const template = readTemplate(body, PRICE_UPDATE.module)

		if (template.id !== id) {
			return [`id: must be "${id}", the template being saved.`]
		}

		applyTemplate(ModuleSchema.from(PRICE_UPDATE), template)
	} catch (error) {
		if (error instanceof TabulaError) {
			return error.message
				.split("\n")
				.slice(1)
				.map(line => line.trim())
		}

		throw error
	}

	return []
}

const TURKISH: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }

/** A name as an id: "Mart kampanyası" is "mart-kampanyasi". */
function slug(name: string): string {
	const plain = name
		.toLocaleLowerCase("tr")
		.replace(/[çğıöşü]/g, letter => TURKISH[letter] ?? letter)
		.normalize("NFD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")

	return plain === "" ? "sablon" : plain
}

/** The id, or the id with a number after it when a template has it already. */
function freeId(base: string): string {
	let id = base

	for (let number = 2; known(id); number++) {
		id = `${base}-${number}`
	}

	return id
}
