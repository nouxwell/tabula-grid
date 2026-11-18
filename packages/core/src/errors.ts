/** What went wrong, in a form code can branch on. */
export type TabulaErrorCode =
	| "invalid_schema"
	| "unknown_field"
	| "unknown_row"
	| "duplicate_row"
	| "invalid_argument"
	| "invalid_value"
	| "conflict"
	| "invalid_response"
	| "invalid_draft"
	| "invalid_workbook"
	| "invalid_views"
	| "invalid_template"
	| "invalid_formula"

/**
 * The one error class this package throws.
 *
 * The message is English and written for the developer reading the console. Code that reacts to an
 * error looks at `code`, which is never renamed; a message may be reworded in any release.
 */
export class TabulaError extends Error {
	override name = "TabulaError"
	readonly code: TabulaErrorCode

	constructor(code: TabulaErrorCode, message: string) {
		super(message)
		this.code = code
	}
}

export interface SchemaProblem {
	/** Where in the schema, such as `fields[2].rules[0].value`. `(root)` is the schema itself. */
	readonly path: string
	readonly message: string
}

/**
 * A module schema that cannot be used, with every problem in it.
 *
 * All of them, not the first: a developer fixing a schema one complaint per reload is a developer
 * reloading a dozen times.
 */
export class SchemaError extends TabulaError {
	override name = "SchemaError"
	readonly problems: readonly SchemaProblem[]

	constructor(subject: string, problems: readonly SchemaProblem[]) {
		const lines = problems.map(problem => `  ${problem.path}: ${problem.message}`)
		super("invalid_schema", `${subject} is not valid:\n${lines.join("\n")}`)
		this.problems = Object.freeze([...problems])
	}
}
