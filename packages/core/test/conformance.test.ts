import { describe, expect, it } from "vitest"
import conformance from "../../../conformance/values.json" with { type: "json" }
import {
	defineValueSettings,
	formatCell,
	ModuleSchema,
	readInput,
	RowStore,
	SheetValidator,
	VALUE_SETTINGS,
	type CellValue,
	type FieldInput,
	type FieldSchema,
	type Issue,
	type IssueTarget,
	type RowInit,
	type ValueSettings
} from "../src/index"
import { canonicalValue } from "../src/values/read"

/**
 * The cases nouxwell/tabula's parsers are checked against too (conformance/php/check.php). Passing
 * here and there is what "the same value on both sides" means.
 */

type SettingsName = keyof typeof conformance.settings

function settingsOf(name: string): ValueSettings {
	const given = conformance.settings[name as SettingsName]

	return defineValueSettings(
		{ ...given, symbolPosition: given.symbolPosition as ValueSettings["symbolPosition"] },
		VALUE_SETTINGS.tr
	)
}

function fieldOf(field: object): FieldSchema {
	return ModuleSchema.from({
		module: "conformance",
		schemaVersion: 1,
		fields: [{ key: "f", ...(field as Omit<FieldInput, "key">) }]
	}).field("f")
}

function label(field: object): string {
	return JSON.stringify(field)
}

describe("reading, as nouxwell/tabula reads", () => {
	it.each(conformance.read.map(entry => [entry.input, label(entry.field), entry] as const))(
		"%j in %s",
		(_input, _field, entry) => {
			const result = readInput(fieldOf(entry.field), entry.input, settingsOf(entry.settings))

			if ("problem" in entry) {
				expect(result.problem?.code).toBe(entry.problem)
				expect(result.value).toBe(entry.input.trim())
			} else {
				expect(result.problem).toBeNull()
				expect(result.value).toEqual(entry.value)
			}
		}
	)
})

describe("writing, as nouxwell/tabula writes", () => {
	it.each(conformance.format.map(entry => [JSON.stringify(entry.value), label(entry.field), entry] as const))(
		"%s in %s",
		(_value, _field, entry) => {
			expect(formatCell(fieldOf(entry.field), entry.value, settingsOf(entry.settings))).toBe(entry.text)
		}
	)
})

interface CheckCase {
	readonly about: string
	readonly rows: readonly RowInit[]
	readonly sent?: readonly { readonly rowId: string; readonly values: Readonly<Record<string, CellValue>> }[]
	readonly issues: readonly ExpectedIssue[]
}

interface ExpectedIssue {
	readonly rowId: string
	readonly field: string
	readonly code: string
	readonly targets?: readonly IssueTarget[]
	readonly params?: Readonly<Record<string, string>>
	readonly message?: string
}

const checks = conformance.checks as unknown as {
	readonly settings: string
	readonly fields: readonly FieldInput[]
	readonly cases: readonly CheckCase[]
}

/** An issue as far as a case says what it should be: the params it lists, the message if it gives one. */
function asExpected(issue: Issue, expected: ExpectedIssue | undefined): ExpectedIssue {
	const params = expected?.params

	return {
		rowId: issue.rowId ?? "",
		field: issue.field ?? "",
		code: issue.code,
		targets: issue.targets,
		...(params
			? { params: Object.fromEntries(Object.keys(params).map(key => [key, issue.params[key] ?? "(none)"])) }
			: {}),
		...(expected?.message === undefined ? {} : { message: issue.message })
	}
}

describe("checking rows, as Tabula::checkRows() checks them", () => {
	const schema = ModuleSchema.from({ module: "conformance", schemaVersion: 1, fields: checks.fields })
	const settings = settingsOf(checks.settings)

	it.each(checks.cases.map(entry => [entry.about, entry] as const))("%s", (_about, entry) => {
		const store = new RowStore({ rows: entry.rows })
		const validator = new SheetValidator(schema, store, settings)
		const found = validator.issues()

		expect(found.map((issue, index) => asExpected(issue, entry.issues[index]))).toEqual(
			entry.issues.map(issue => ({ targets: [], ...issue }))
		)

		// What the server is sent: "sent" where the grid sends another form than it holds, and
		// everything else (lookups aside, which the PHP runner turns into ids) exactly as held.
		for (const rowId of store.rowIds()) {
			const sent = entry.sent?.find(candidate => candidate.rowId === rowId)?.values ?? {}

			for (const field of schema.fields) {
				if (field.type !== "lookup" && field.submit) {
					const held = store.get(rowId, field.key)

					expect(canonicalValue(field, held, settings), `${rowId}.${field.key}`).toEqual(
						field.key in sent ? sent[field.key] : held
					)
				}
			}
		}

		validator.dispose()
	})
})
