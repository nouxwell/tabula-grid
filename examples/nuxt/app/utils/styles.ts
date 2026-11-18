import {
	editText,
	readInput,
	type ConditionInput,
	type MarkColor,
	type ModuleSchema,
	type StyleRule,
	type StyleRuleInput,
	type ValueSettings
} from "@nouxwell/tabula-core"
import type { ConditionDraft } from "./rules"

/**
 * A colour rule as the rules drawer's Renkler tab edits it: one condition, the colours it puts on,
 * and whether on its field's cell or the whole row. A value is kept as typed, and read as its field
 * reads it only when the rule is kept.
 */
export interface StyleDraft {
	id: string
	condition: ConditionDraft
	/** The condition's own cell, or the whole row. */
	scope: "cell" | "row"
	fill: MarkColor | null
	color: MarkColor | null
	bold: boolean
}

/** The colours offered, with their names and the swatch each is drawn with on a light page. */
export const MARK_SWATCHES: readonly { readonly value: MarkColor; readonly label: string; readonly hex: string }[] = [
	{ value: "yellow", label: "Sarı", hex: "#f2a900" },
	{ value: "green", label: "Yeşil", hex: "#12b886" },
	{ value: "blue", label: "Mavi", hex: "#228be6" },
	{ value: "purple", label: "Mor", hex: "#7950f2" },
	{ value: "pink", label: "Pembe", hex: "#e64980" },
	{ value: "orange", label: "Turuncu", hex: "#fd7e14" },
	{ value: "grey", label: "Gri", hex: "#868e96" },
	{ value: "red", label: "Kırmızı", hex: "#fa5252" }
]

const CONDITION_WORDS: Readonly<Record<ConditionInput["op"], string>> = {
	filled: "dolu",
	empty: "boş",
	"=": "=",
	"!=": "≠",
	"<": "<",
	"<=": "≤",
	">": ">",
	">=": "≥"
}

export function colorName(color: MarkColor | null): string {
	return MARK_SWATCHES.find(swatch => swatch.value === color)?.label ?? ""
}

/** A new rule: the first numeric field below 100, its cell orange. */
export function newStyleDraft(schema: ModuleSchema): StyleDraft {
	const field = schema.fields.find(item => item.editable) ?? schema.fields[0]

	return {
		id: `style-${Date.now().toString(36)}`,
		condition: { field: field?.key ?? "", op: "filled", against: "", text: "" },
		scope: "cell",
		fill: "orange",
		color: null,
		bold: false
	}
}

/** A draft of a saved rule, its value written as a cell's editor writes it. */
export function styleDraftOf(rule: StyleRule, schema: ModuleSchema, settings: ValueSettings): StyleDraft {
	const condition = rule.when[0]

	return {
		id: rule.id,
		condition: {
			field: condition?.field ?? "",
			op: condition?.op ?? "filled",
			against: condition?.other ?? "",
			text:
				condition && condition.value !== null && schema.has(condition.field)
					? editText(schema.field(condition.field), condition.value, settings)
					: ""
		},
		scope: rule.field === null ? "row" : "cell",
		fill: rule.fill,
		color: rule.color,
		bold: rule.bold
	}
}

/** The draft as a rule, its value read as its field reads typed text; or what keeps it from being one. */
export function styleOf(
	draft: StyleDraft,
	schema: ModuleSchema,
	settings: ValueSettings
): { readonly style: StyleRuleInput } | { readonly problem: string } {
	const item = draft.condition

	if (!schema.has(item.field)) {
		return { problem: "Bir alan seçin." }
	}

	if (draft.fill === null && draft.color === null && !draft.bold) {
		return { problem: "Bir dolgu, bir yazı rengi ya da kalın seçin." }
	}

	const field = schema.field(item.field)
	let condition: ConditionInput

	if (item.op === "filled" || item.op === "empty") {
		condition = { field: field.key, op: item.op }
	} else if (item.against !== "") {
		condition = { field: field.key, op: item.op, other: item.against }
	} else if (item.text.trim() === "") {
		return { problem: `${field.label} ile karşılaştırılacak bir değer yazın.` }
	} else {
		const read = readInput(field, item.text, settings)

		if (read.problem !== null || read.value === null) {
			return { problem: `“${item.text}” ${field.label} için okunamadı.` }
		}

		condition = { field: field.key, op: item.op, value: read.value as ConditionInput["value"] }
	}

	return {
		style: {
			id: draft.id,
			when: [condition],
			...(draft.scope === "cell" ? { field: field.key } : {}),
			...(draft.fill ? { fill: draft.fill } : {}),
			...(draft.color ? { color: draft.color } : {}),
			...(draft.bold ? { bold: true } : {})
		}
	}
}

/** A rule in words: "Yeni fiyat < 100 ise", and what it puts on: "dolgu turuncu · yalnız hücre". */
export function describeStyle(
	rule: StyleRule,
	schema: ModuleSchema,
	settings: ValueSettings
): { readonly when: string; readonly look: string } {
	const when = rule.when
		.map(condition => {
			const field = schema.has(condition.field) ? schema.field(condition.field) : null
			const label = field?.label ?? condition.field
			const op = CONDITION_WORDS[condition.op]

			if (condition.op === "filled" || condition.op === "empty") {
				return `${label} ${op}`
			}

			const other =
				condition.other !== null
					? schema.has(condition.other)
						? schema.field(condition.other).label
						: condition.other
					: field && condition.value !== null
						? editText(field, condition.value, settings)
						: ""

			return `${label} ${op} ${other}`
		})
		.join(" ve ")
	const look = [
		rule.fill ? `dolgu ${colorName(rule.fill).toLocaleLowerCase("tr-TR")}` : null,
		rule.color ? `yazı ${colorName(rule.color).toLocaleLowerCase("tr-TR")}` : null,
		rule.bold ? "kalın" : null,
		rule.field === null ? "bütün satır" : "yalnız hücre"
	]
		.filter(Boolean)
		.join(" · ")

	return { when: `${when} ise`, look }
}
