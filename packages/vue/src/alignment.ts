import type { FieldSchema } from "@nouxwell/tabula-core"

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
