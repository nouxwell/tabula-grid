import {
	formatCell,
	type Issue,
	type ModuleSchema,
	type RowCheck,
	type RowCondition,
	type ValueSettings
} from "@nouxwell/tabula-core"

/**
 * What the grid and the issue panel say, in Turkish or English.
 *
 * An issue is worded from its code and params, never from its English message, so a code this
 * table does not know (a backend's own) still shows the backend's message rather than nothing.
 */
export type GridLocale = "tr" | "en"

type Params = Readonly<Record<string, string>>
type Wording = (params: Params, settings: ValueSettings) => string

const ISSUES: Readonly<Record<GridLocale, Readonly<Record<string, Wording>>>> = {
	tr: {
		required: () => "Bu alan zorunlu.",
		not_a_number: p => `“${p.value}” sayı olarak okunamadı.`,
		not_an_integer: p => `“${p.value}” tam sayı değil.`,
		not_a_date: p => `“${p.value}” tarih olarak okunamadı. Örnek: ${dateExample(p.format)}`,
		not_a_boolean: p => `“${p.value}” Evet/Hayır değeri değil. Kabul edilenler: ${p.accepted}`,
		not_an_option: p => `“${p.value}” listede yok. Seçenekler: ${p.options || "(seçenek yok)"}`,
		not_matched: p => `“${p.value}” bir kayıtla eşleşmedi; listeden seçin.`,
		min_value: (p, s) => `En az ${number(p.min, s)} olmalı.`,
		max_value: (p, s) => `En fazla ${number(p.max, s)} olabilir.`,
		min_length: p => `En az ${p.min} karakter olmalı; ${p.length} karakter.`,
		max_length: p => `En fazla ${p.max} karakter olabilir; ${p.length} karakter.`,
		not_unique: p => `Bu değer kolonda ${p.count} kez geçiyor; bir kez geçmeli.`,
		formula_error: p => `Formül hesaplanamadı: ${p.error}${because(p.error, "tr")}`,
		check_filled: p => `Bu alan zorunlu${when(p, "tr")}.`,
		check_empty: p => `Bu alan boş bırakılmalı${when(p, "tr")}.`,
		check_compare: p => `${COMPARED.tr[p.op ?? ""]?.(p.operand ?? "") ?? ""}${when(p, "tr")}.`
	},
	en: {
		required: () => "This field is required.",
		not_a_number: p => `“${p.value}” could not be read as a number.`,
		not_an_integer: p => `“${p.value}” is not a whole number.`,
		not_a_date: p => `“${p.value}” could not be read as a date. For example: ${dateExample(p.format)}`,
		not_a_boolean: p => `“${p.value}” is not a Yes/No value. Accepted: ${p.accepted}`,
		not_an_option: p => `“${p.value}” is not in the list. Options: ${p.options || "(no options)"}`,
		not_matched: p => `“${p.value}” is not matched to a record; pick one from the list.`,
		min_value: (p, s) => `Must be at least ${number(p.min, s)}.`,
		max_value: (p, s) => `Must be at most ${number(p.max, s)}.`,
		min_length: p => `Must be at least ${p.min} characters; it is ${p.length}.`,
		max_length: p => `Must be at most ${p.max} characters; it is ${p.length}.`,
		not_unique: p => `This value appears ${p.count} times in the column; it may appear once.`,
		formula_error: p => `The formula could not be worked out: ${p.error}${because(p.error, "en")}`,
		check_filled: p => `This field is required${when(p, "en")}.`,
		check_empty: p => `This field must be left empty${when(p, "en")}.`,
		check_compare: p => `${COMPARED.en[p.op ?? ""]?.(p.operand ?? "") ?? ""}${when(p, "en")}.`
	}
}

/** A row check's comparison, said of the cell it is on: "Mevcut fiyat değerinden küçük olamaz". */
const COMPARED: Readonly<Record<GridLocale, Readonly<Record<string, (operand: string) => string>>>> = {
	tr: {
		"=": x => `${x} ile aynı olmalı`,
		"!=": x => `${x} ile aynı olamaz`,
		"<": x => `${x} değerinden küçük olmalı`,
		"<=": x => `${x} değerinden büyük olamaz`,
		">": x => `${x} değerinden büyük olmalı`,
		">=": x => `${x} değerinden küçük olamaz`
	},
	en: {
		"=": x => `Must equal ${x}`,
		"!=": x => `Cannot equal ${x}`,
		"<": x => `Must be less than ${x}`,
		"<=": x => `Cannot be greater than ${x}`,
		">": x => `Must be greater than ${x}`,
		">=": x => `Cannot be less than ${x}`
	}
}

const SYMBOLS: Readonly<Record<string, string>> = { "=": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" }

/**
 * When a row check applies, after what it says: " (Aktif = Hayır olduğunda)", " when Aktif = No".
 * Nothing for a check that always applies.
 */
function when(p: Params, locale: GridLocale): string {
	const count = Number(p.when ?? "0")
	const parts: string[] = []

	for (let index = 0; index < count; index++) {
		const field = p[`when${index}Field`] ?? ""
		const op = p[`when${index}Op`] ?? ""
		const value = p[`when${index}Value`] ?? ""

		if (op === "filled" || op === "empty") {
			parts.push(`${field} ${locale === "tr" ? (op === "filled" ? "dolu" : "boş") : `is ${op}`}`)
		} else {
			parts.push(`${field} ${SYMBOLS[op] ?? op} ${value}`)
		}
	}

	if (parts.length === 0) {
		return ""
	}

	return locale === "tr" ? ` (${parts.join(" ve ")} olduğunda)` : ` when ${parts.join(" and ")}`
}

/** The words of the issue panel. */
export const PANEL_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		title: "Sorunlar",
		errors: "hata",
		warnings: "uyarı",
		stale: "yeniden kontrol",
		rows: "satır",
		none: "Sorun yok.",
		previous: "Önceki",
		next: "Sonraki",
		row: "Satır",
		sheet: "Sayfa",
		recheck: "Değişti, yeniden kontrol edilmeli",
		more: "sorun daha",
		onlyIssueRows: "Yalnız sorunlu satırlar",
		refresh: "Yenile",
		refreshHint: "Süzgeci tablonun şimdiki hâline yeniden uygula",
		local: "Tarayıcı",
		server: "Sunucu",
		goToCell: "Hücreye git",
		open: "Sorunları göster",
		close: "Kapat"
	},
	en: {
		title: "Issues",
		errors: "errors",
		warnings: "warnings",
		stale: "to check again",
		rows: "rows",
		none: "No issues.",
		previous: "Previous",
		next: "Next",
		row: "Row",
		sheet: "Sheet",
		recheck: "Changed, to be checked again",
		more: "more issues",
		onlyIssueRows: "Only rows with issues",
		refresh: "Refresh",
		refreshHint: "Apply the filter again to the sheet as it is now",
		local: "Browser",
		server: "Server",
		goToCell: "Go to cell",
		open: "Show issues",
		close: "Close"
	}
}

/** The words of the formula bar and the status bar. */
export const BAR_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		formulaBar: "Formül çubuğu",
		address: "Hücre adresi",
		addressHint: "Bir adres yazıp Enter'a basın, örneğin D9",
		noAddress: "Böyle bir hücre yok",
		value: "Hücrenin değeri",
		statusBar: "Durum çubuğu",
		rows: "satır",
		issues: "sorun",
		selected: "Seçili",
		sum: "Toplam",
		average: "Ortalama"
	},
	en: {
		formulaBar: "Formula bar",
		address: "Cell address",
		addressHint: "Type an address and press Enter, such as D9",
		noAddress: "There is no such cell",
		value: "The cell's value",
		statusBar: "Status bar",
		rows: "rows",
		issues: "issues",
		selected: "Selected",
		sum: "Sum",
		average: "Average"
	}
}

/** The grid's own words: what a row's result is, and what a changed issue waits for. */
export const GRID_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		succeeded: "İşlendi",
		failed: "İşlenemedi",
		skipped: "İşlenmedi",
		sending: "Gönderiliyor",
		recheck: "Değişti, yeniden kontrol edilmeli",
		searching: "Aranıyor…",
		none: "Eşleşen kayıt yok",
		more: "Daha fazlası var; aramayı daraltın",
		unavailable: "Arama yapılamadı",
		columnMenu: "Kolon seçenekleri",
		pin: "Sabitle",
		unpin: "Sabitlemeyi kaldır",
		hide: "Gizle",
		showHidden: "Gizli kolonları göster",
		sortAsc: "Artan sırala",
		sortDesc: "Azalan sırala",
		sortClear: "Sıralamayı kaldır",
		filter: "Filtrele…",
		filterClear: "Filtreyi kaldır",
		filterTitle: "Filtre",
		filtered: "Filtre uygulanmış",
		search: "Değerlerde ara",
		selectAll: "Tümünü seç",
		empty: "(Boş)",
		from: "En az",
		to: "En çok",
		apply: "Uygula",
		clear: "Temizle",
		cancel: "Vazgeç",
		moreValues: "değer listede yok; arayarak bulun",
		badBound: "Bu değer okunamadı; sütunun yazdığı gibi yazın.",
		fillHandle: "Doldurmak için sürükleyin; çift tıklayınca yandaki sütun bitene dek aşağı doldurur.",
		picked: "seçili · aramak için yazın",
		pickHint: "Boşluk ya da tık seçer; Enter yazar, Esc vazgeçer."
	},
	en: {
		succeeded: "Processed",
		failed: "Failed",
		skipped: "Not processed",
		sending: "Being sent",
		recheck: "Changed, to be checked again",
		searching: "Searching…",
		none: "No matching records",
		more: "There are more; narrow the search",
		unavailable: "The search could not be made",
		columnMenu: "Column options",
		pin: "Pin",
		unpin: "Unpin",
		hide: "Hide",
		showHidden: "Show hidden columns",
		sortAsc: "Sort ascending",
		sortDesc: "Sort descending",
		sortClear: "Remove sort",
		filter: "Filter…",
		filterClear: "Clear filter",
		filterTitle: "Filter",
		filtered: "Filtered",
		search: "Search the values",
		selectAll: "Select all",
		empty: "(Empty)",
		from: "From",
		to: "To",
		apply: "Apply",
		clear: "Clear",
		cancel: "Cancel",
		moreValues: "more values not listed; search to find them",
		badBound: "This value cannot be read; write it as the column does.",
		fillHandle: "Drag to fill; double-click to fill down as far as the column beside goes.",
		picked: "picked · type to search",
		pickHint: "Space or a click ticks; Enter writes, Esc cancels."
	}
}

/**
 * The issue in the user's language, or its own message for a code this table does not know. A
 * backend's code is worded by the backend: the table only holds this package's own.
 */
export function issueText(issue: Issue, locale: GridLocale, settings: ValueSettings): string {
	if (issue.source !== "local") {
		return issue.message
	}

	// A row check written with words of its own says them, in the sheet's language when it has it.
	const own = issue.params[`message.${locale}`]

	if (own) {
		return own
	}

	const wording = ISSUES[locale][issue.code]

	return wording ? wording(issue.params, settings) : issue.message
}

/**
 * A row check as a sentence, for a list of rules: "Aralık fiyatı, Mevcut fiyat değerinden küçük
 * olamaz (Para birimi = TRY olduğunda)". Fields by their labels, values as the sheet writes them.
 */
export function describeCheck(
	check: RowCheck,
	schema: ModuleSchema,
	locale: GridLocale,
	settings: ValueSettings
): string {
	const label = (key: string): string => (schema.has(key) ? schema.field(key).label : key)
	const operand = (condition: RowCondition): string =>
		condition.other !== null
			? label(condition.other)
			: condition.value === null || !schema.has(condition.field)
				? ""
				: formatCell(schema.field(condition.field), condition.value, settings)
	const params: Record<string, string> = { when: String(check.when.length) }

	check.when.forEach((condition, index) => {
		params[`when${index}Field`] = label(condition.field)
		params[`when${index}Op`] = condition.op
		params[`when${index}Value`] = operand(condition)
	})

	const field = label(check.assert.field)
	const op = check.assert.op
	let said: string

	if (op === "filled" || op === "empty") {
		said =
			locale === "tr"
				? `${field} ${op === "filled" ? "dolu" : "boş"} olmalı`
				: `${field} must be ${op === "filled" ? "filled" : "empty"}`
	} else {
		const compared = COMPARED[locale][op]?.(operand(check.assert)) ?? ""

		said =
			locale === "tr"
				? `${field}, ${compared}`
				: `${field}: ${compared.charAt(0).toLowerCase()}${compared.slice(1)}`
	}

	return `${said}${when(params, locale)}`
}

/** A decimal limit such as "0.5" written the sheet's way: "0,5". */
function number(value: string | undefined, settings: ValueSettings): string {
	return (value ?? "").replace(".", settings.decimalSeparator)
}

/**
 * A date pattern shown as a date rather than as letters: "d.m.Y" reads "31.12.2026", which says
 * more to a user than "d.m.Y" or a translated "gg.aa.yyyy".
 */
export function dateExample(pattern: string | undefined): string {
	const parts: Readonly<Record<string, string>> = {
		d: "31",
		j: "31",
		m: "12",
		n: "12",
		Y: "2026",
		y: "26",
		H: "13",
		G: "13",
		i: "45",
		s: "00"
	}
	let text = ""
	const source = pattern ?? ""

	for (let index = 0; index < source.length; index++) {
		const char = source.charAt(index)

		if (char === "\\") {
			index++
			text += source.charAt(index)
		} else if (char !== "!" && char !== "|") {
			text += parts[char] ?? char
		}
	}

	return text
}

/** Why a formula gave its error, in words, after the error itself. */
const FORMULA_REASONS: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		"#DIV/0!": "sıfıra bölme",
		"#VALUE!": "bir değer beklenen türde değil",
		"#NAME?": "bilinmeyen fonksiyon",
		"#NUM!": "sayı olarak hesaplanamıyor"
	},
	en: {
		"#DIV/0!": "a division by zero",
		"#VALUE!": "a value is not of the kind expected",
		"#NAME?": "an unknown function",
		"#NUM!": "not a number that can be worked out"
	}
}

function because(error: string | undefined, locale: GridLocale): string {
	const reason = FORMULA_REASONS[locale][error ?? ""]

	return reason ? ` (${reason})` : ""
}
