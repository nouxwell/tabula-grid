import type { CellValue, FieldSchema } from "@nouxwell/tabula-core"

/**
 * What a cell shows.
 *
 * Plain for now: a number is drawn as JavaScript writes it, not with the sheet's separators, and a
 * date as the text it holds. Formatting by the sheet's number and date settings comes with reading
 * values, and replaces this. What is already final is where the label comes from: an option shows
 * its label rather than its value, and a lookup its label rather than its id.
 */
export function cellText(field: FieldSchema, value: CellValue): string {
	if (value === null) {
		return ""
	}

	if (Array.isArray(value)) {
		return (value as readonly CellValue[]).map(item => cellText(field, item)).join(", ")
	}

	switch (typeof value) {
		case "string":
			return field.type === "options" ? optionLabel(field.options, value) : value
		case "number":
			return field.type === "options" ? optionLabel(field.options, value) : String(value)
		case "boolean":
			return value ? "✓" : "✗"
	}

	const record = value as Readonly<Record<string, CellValue>>
	const label = record.label

	if (typeof label === "string" || typeof label === "number") {
		return String(label)
	}

	const id = record.id

	if (typeof id === "string" || typeof id === "number") {
		return `#${id}`
	}

	return JSON.stringify(value)
}

/** The text an editor opens with for this value: what the cell shows. */
export function editText(field: FieldSchema, value: CellValue): string {
	return cellText(field, value)
}

export type Alignment = "left" | "right" | "center"

/** Numbers right, yes/no and dates centred, the rest left: the alignment nouxwell/tabula uses in files. */
export function alignmentOf(field: FieldSchema): Alignment {
	switch (field.type) {
		case "integer":
		case "decimal":
		case "money":
		case "quantity":
		case "percent":
			return "right"
		case "bool":
		case "date":
		case "datetime":
			return "center"
		default:
			return "left"
	}
}

function optionLabel(
	options: readonly { readonly value: string | number; readonly label: string }[],
	value: string | number
): string {
	const text = String(value)

	return options.find(option => String(option.value) === text)?.label ?? text
}
