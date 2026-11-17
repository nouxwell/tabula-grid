import { describe, expect, it } from "vitest"
import conformance from "../../../conformance/values.json" with { type: "json" }
import {
	defineValueSettings,
	formatCell,
	ModuleSchema,
	readInput,
	VALUE_SETTINGS,
	type FieldInput,
	type FieldSchema,
	type ValueSettings
} from "../src/index"

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
