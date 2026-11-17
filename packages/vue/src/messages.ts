import type { Issue, ValueSettings } from "@nouxwell/tabula-core"

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
		not_unique: p => `Bu değer kolonda ${p.count} kez geçiyor; bir kez geçmeli.`
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
		not_unique: p => `This value appears ${p.count} times in the column; it may appear once.`
	}
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
		refreshHint: "Süzgeci tablonun şimdiki hâline yeniden uygula"
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
		refreshHint: "Apply the filter again to the sheet as it is now"
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
		showHidden: "Gizli kolonları göster"
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
		showHidden: "Show hidden columns"
	}
}

/**
 * The issue in the user's language, or its own message for a code this table does not know. A
 * backend's code is worded by the backend: the table only holds this package's own.
 */
export function issueText(issue: Issue, locale: GridLocale, settings: ValueSettings): string {
	const wording = issue.source === "local" ? ISSUES[locale][issue.code] : undefined

	return wording ? wording(issue.params, settings) : issue.message
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
