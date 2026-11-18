import {
	formulaFromAddresses,
	formulaWithKeys,
	formulaWithLabels,
	type FieldInput,
	type FieldType,
	type NamedField
} from "@nouxwell/tabula-core"
import { parseAddress } from "@nouxwell/tabula-vue"

/**
 * A template's own column as the rules drawer edits it: a header, a kind, and a formula written with
 * the fields' labels, or none for a helper column the user fills in by hand.
 */
export interface ColumnDraft {
	key: string
	label: string
	type: FieldType
	/** As typed: a whole number, or empty to leave it to the sheet. */
	decimals: string
	/** With labels: "ROUND([Aralık fiyatı] * 1.2, 2)". Empty for a helper column. */
	formula: string
}

/** The kinds a template's column may be, and what a person calls each. */
export const COLUMN_TYPES: readonly { readonly label: string; readonly value: FieldType }[] = [
	{ label: "Metin", value: "string" },
	{ label: "Tam sayı", value: "integer" },
	{ label: "Sayı", value: "decimal" },
	{ label: "Para", value: "money" },
	{ label: "Yüzde", value: "percent" },
	{ label: "Miktar", value: "quantity" },
	{ label: "Tarih", value: "date" },
	{ label: "Evet / Hayır", value: "bool" }
]

const KIND_WORDS: Readonly<Partial<Record<FieldType, string>>> = {
	string: "metin",
	integer: "tam sayı",
	decimal: "sayı",
	money: "para",
	percent: "yüzde",
	quantity: "miktar",
	date: "tarih",
	datetime: "tarih ve saat",
	bool: "evet/hayır",
	options: "seçenek",
	lookup: "kayıt"
}

/** A word for a field's kind, for a list of fields. */
export function kindWord(type: FieldType): string {
	return KIND_WORDS[type] ?? type
}

export function takesDecimals(type: FieldType): boolean {
	return type === "decimal" || type === "money" || type === "percent" || type === "quantity"
}

/**
 * A key for a new column from its header, as a field key is written: "Kâr marjı %" is
 * "karMarji", made unique among the keys given.
 */
export function keyFor(label: string, taken: ReadonlySet<string>): string {
	const plain = label
		.toLocaleLowerCase("tr")
		.replace(/[âàá]/g, "a")
		.replace(/ç/g, "c")
		.replace(/ğ/g, "g")
		.replace(/[ıîí]/g, "i")
		.replace(/[öô]/g, "o")
		.replace(/ş/g, "s")
		.replace(/[üûú]/g, "u")
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
	const base =
		plain.length === 0
			? "column"
			: plain.map((word, index) => (index === 0 ? word : word[0]?.toUpperCase() + word.slice(1))).join("")
	let key = /^[a-z]/.test(base) ? base : `c${base}`
	let next = 2

	while (taken.has(key)) {
		key = `${base}${next++}`
	}

	return key
}

/** A saved column as a draft: its formula written with labels. */
export function columnDraftOf(column: FieldInput, fields: readonly NamedField[]): ColumnDraft {
	return {
		key: column.key,
		label: column.label ?? column.key,
		type: column.type,
		decimals: column.decimals === undefined ? "" : String(column.decimals),
		formula: column.formula ? formulaWithLabels(column.formula, fields) : ""
	}
}

export function newColumnDraft(taken: ReadonlySet<string>): ColumnDraft {
	return { key: keyFor("Yeni sütun", taken), label: "Yeni sütun", type: "decimal", decimals: "", formula: "" }
}

/**
 * The fields at the places their columns stand on screen, by their letters: A at 0, B at 1. A place
 * with no field, such as the column being written, is left empty.
 */
export function columnsByLetter(fields: readonly (NamedField & { readonly letter: string | null })[]): NamedField[] {
	const places: NamedField[] = []

	for (const field of fields) {
		const at = field.letter ? parseAddress(`${field.letter}1`)?.col : undefined

		if (at !== undefined) {
			places[at] = field
		}
	}

	return places
}

/**
 * The draft as a template's column: its formula written with keys, as it is saved. An address such
 * as "D" or "D2" is read as the field of that column in the same row, `columns` as they stand on
 * screen, A first.
 */
export function columnOf(
	draft: ColumnDraft,
	fields: readonly NamedField[],
	columns: readonly NamedField[] = []
): FieldInput {
	const decimals = Number.parseInt(draft.decimals, 10)
	const formula = draft.formula.trim().replace(/^=\s*/, "")

	return {
		key: draft.key,
		type: draft.type,
		label: draft.label.trim() === "" ? draft.key : draft.label.trim(),
		...(takesDecimals(draft.type) && Number.isSafeInteger(decimals) && decimals >= 0 ? { decimals } : {}),
		...(formula === "" ? {} : { formula: formulaWithKeys(formulaFromAddresses(formula, columns), fields) })
	}
}
