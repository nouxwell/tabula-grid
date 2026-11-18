import {
	editText,
	readInput,
	type CheckInput,
	type CheckSeverity,
	type ConditionInput,
	type ConditionOp,
	type FieldSchema,
	type ModuleSchema,
	type RowCheck,
	type RowCondition,
	type ValueSettings
} from "@nouxwell/tabula-core"

/**
 * A row check as the rules drawer edits it: what the user picks and types, before it is read into a
 * check. A value is kept as typed ("01.12.2026"), and read as its field reads it only when saved.
 */
export interface ConditionDraft {
	field: string
	op: ConditionOp
	/** The other field compared with, by key; "" for a value typed in `text`. */
	against: string
	text: string
}

export interface RuleDraft {
	id: string
	assert: ConditionDraft
	when: ConditionDraft[]
	severity: CheckSeverity
	/** The check's own words; empty leaves them to the grid. */
	tr: string
	en: string
}

const NUMERIC = new Set(["integer", "decimal", "money", "quantity", "percent"])
const ORDERED = new Set([...NUMERIC, "date", "datetime"])

const ASSERT_WORDS: Readonly<Record<ConditionOp, string>> = {
	filled: "dolu olmalı",
	empty: "boş olmalı",
	"=": "= eşit olmalı",
	"!=": "≠ eşit olmamalı",
	"<": "< küçük olmalı",
	"<=": "≤ en çok",
	">": "> büyük olmalı",
	">=": "≥ en az"
}

const CONDITION_WORDS: Readonly<Record<ConditionOp, string>> = {
	filled: "dolu",
	empty: "boş",
	"=": "=",
	"!=": "≠",
	"<": "<",
	"<=": "≤",
	">": ">",
	">=": "≥"
}

/** The fields a field can be compared with: numbers with numbers, anything else with its own kind. */
export function comparableFields(field: FieldSchema, fields: readonly FieldSchema[]): FieldSchema[] {
	return fields.filter(
		other =>
			other.key !== field.key &&
			((NUMERIC.has(field.type) && NUMERIC.has(other.type)) || other.type === field.type)
	)
}

/**
 * What can be said of a field: filled or empty always; equal or not, unless it is a lookup with
 * nothing to compare it with; an order only for numbers and dates.
 */
export function opsFor(
	field: FieldSchema | undefined,
	fields: readonly FieldSchema[],
	asserting: boolean
): { label: string; value: ConditionOp }[] {
	const words = asserting ? ASSERT_WORDS : CONDITION_WORDS
	const ops: ConditionOp[] = ["filled", "empty"]

	if (field && (field.type !== "lookup" || comparableFields(field, fields).length > 0)) {
		ops.push("=", "!=")
	}

	if (field && ORDERED.has(field.type)) {
		ops.push("<", "<=", ">", ">=")
	}

	return ops.map(op => ({ label: words[op], value: op }))
}

/** A draft of a saved check, its values written as a cell's editor writes them. */
export function draftOf(check: RowCheck, schema: ModuleSchema, settings: ValueSettings): RuleDraft {
	const condition = (item: RowCondition): ConditionDraft => ({
		field: item.field,
		op: item.op,
		against: item.other ?? "",
		text:
			item.value === null || !schema.has(item.field)
				? ""
				: editText(schema.field(item.field), item.value, settings)
	})

	return {
		id: check.id,
		assert: condition(check.assert),
		when: check.when.map(condition),
		severity: check.severity,
		tr: check.message?.tr ?? "",
		en: check.message?.en ?? ""
	}
}

/** A new rule: the first field required, an error, always. */
export function newDraft(schema: ModuleSchema): RuleDraft {
	return {
		id: `rule-${Date.now().toString(36)}`,
		assert: { field: schema.fields[0]?.key ?? "", op: "filled", against: "", text: "" },
		when: [],
		severity: "error",
		tr: "",
		en: ""
	}
}

/** A condition to add under "Ne zaman": the first field filled. */
export function newCondition(schema: ModuleSchema): ConditionDraft {
	return { field: schema.fields[0]?.key ?? "", op: "filled", against: "", text: "" }
}

/**
 * The draft as a check, its values read as their fields read typed text; or what keeps it from
 * being one, in the user's words.
 */
export function checkOf(
	draft: RuleDraft,
	schema: ModuleSchema,
	settings: ValueSettings
): { readonly check: CheckInput } | { readonly problem: string } {
	const conditions: ConditionInput[] = []

	for (const item of [draft.assert, ...draft.when]) {
		if (!schema.has(item.field)) {
			return { problem: "Bir alan seçin." }
		}

		const field = schema.field(item.field)

		if (item.op === "filled" || item.op === "empty") {
			conditions.push({ field: field.key, op: item.op })
			continue
		}

		if (item.against !== "") {
			conditions.push({ field: field.key, op: item.op, other: item.against })
			continue
		}

		if (item.text.trim() === "") {
			return { problem: `${field.label} ile karşılaştırılacak bir değer yazın.` }
		}

		const read = readInput(field, item.text, settings)

		if (read.problem !== null || read.value === null) {
			return { problem: `“${item.text}” ${field.label} için okunamadı.` }
		}

		conditions.push({ field: field.key, op: item.op, value: read.value as ConditionInput["value"] })
	}

	const [assert, ...when] = conditions
	const message = {
		...(draft.tr.trim() === "" ? {} : { tr: draft.tr.trim() }),
		...(draft.en.trim() === "" ? {} : { en: draft.en.trim() })
	}

	return {
		check: {
			id: draft.id,
			assert: assert as ConditionInput,
			...(when.length > 0 ? { when } : {}),
			severity: draft.severity,
			...(Object.keys(message).length > 0 ? { message } : {})
		}
	}
}
