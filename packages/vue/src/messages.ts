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
		// None or several: the name or code is to be put right, or the record picked.
		not_matched: p => `“${p.value}” ile eşleşen tek bir kayıt yok; düzeltin ya da listeden seçin.`,
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
		not_matched: p => `No single record matches “${p.value}”; correct it or pick one from the list.`,
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
		previous: "Önceki sorun",
		next: "Sonraki sorun",
		row: "Satır",
		sheet: "Sayfa",
		recheck: "Değişti, yeniden kontrol edilmeli",
		more: "sorun daha",
		onlyIssueRows: "Yalnız sorunlu satırları göster",
		refresh: "Yenile",
		refreshHint: "Süzgeci tablonun şimdiki hâline yeniden uygula",
		local: "Tarayıcı",
		server: "Sunucu",
		open: "Sorunları göster",
		close: "Kapat",
		show: "Gösterilen sorunlar",
		all: "Tümü",
		error: "Hata",
		warning: "Uyarı",
		noneOfKind: "Bu türde sorun yok."
	},
	en: {
		title: "Issues",
		errors: "errors",
		warnings: "warnings",
		stale: "to check again",
		rows: "rows",
		none: "No issues.",
		previous: "Previous issue",
		next: "Next issue",
		row: "Row",
		sheet: "Sheet",
		recheck: "Changed, to be checked again",
		more: "more issues",
		onlyIssueRows: "Show only rows with issues",
		refresh: "Refresh",
		refreshHint: "Apply the filter again to the sheet as it is now",
		local: "Browser",
		server: "Server",
		open: "Show issues",
		close: "Close",
		show: "Issues shown",
		all: "All",
		error: "Errors",
		warning: "Warnings",
		noneOfKind: "No issues of this kind."
	}
}

/** The words of the preview of a run. */
export const PREVIEW_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		title: "İşlenecekler",
		create: "yeni kayıt",
		update: "güncelleme",
		unchanged: "değişmeyen",
		unknown: "bilinmeyen",
		warned: "uyarılı",
		createOne: "Yeni kayıt",
		updateOne: "Güncelleme",
		unchangedOne: "Değişmeyen",
		unknownOne: "Bilinmiyor",
		all: "Tümü",
		filterCreate: "Yeni",
		filterUpdate: "Güncelleme",
		filterUnchanged: "Değişmeyen",
		filterUnknown: "Bilinmeyen",
		filterWarned: "Uyarılı",
		filters: "Satırları süz",
		row: "Satır",
		empty: "boş",
		same: "Sunucudaki kayıtla aynı; bir şey değişmeyecek.",
		noChanges: "Sunucu hangi alanların değişeceğini bildirmedi.",
		unknownRow: "Ne olacağı bilinmiyor.",
		noPlan: "Sunucu satırların ne olacağını bildirmedi; yalnız sayıları belli.",
		stale: "Tablo son kontrolden sonra değişti; önizleme eski olabilir.",
		sent: "satır gönderilecek",
		more: "{n} satır daha göster",
		none: "Bu süzgeçte satır yok."
	},
	en: {
		title: "To be processed",
		create: "new",
		update: "updates",
		unchanged: "unchanged",
		unknown: "unknown",
		warned: "with warnings",
		createOne: "New record",
		updateOne: "Update",
		unchangedOne: "Unchanged",
		unknownOne: "Unknown",
		all: "All",
		filterCreate: "New",
		filterUpdate: "Updates",
		filterUnchanged: "Unchanged",
		filterUnknown: "Unknown",
		filterWarned: "Warnings",
		filters: "Filter the rows",
		row: "Row",
		empty: "empty",
		same: "The same as the record on the server; nothing will change.",
		noChanges: "The server did not say which fields will change.",
		unknownRow: "What it will do is not known.",
		noPlan: "The server did not say what the rows will do; only their number is known.",
		stale: "The sheet changed after the last check; the preview may be out of date.",
		sent: "rows to send",
		more: "Show {n} more rows",
		none: "No rows under this filter."
	}
}

/** The words of the review of a draft saved under another schema. `{n}` and the like are filled in. */
export const DRAFT_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		saved: "{date} tarihinde kaydedildi · {rows} satır · şema {from}. sürüm, şimdi {to}. sürüm",
		fromHead: "Taslaktaki alan",
		toHead: "Şimdiki alan",
		drop: "Bırak, değerler silinir",
		otherType: "tür farklı",
		suggested: "Önerilen",
		moves: "{n} değer taşınır",
		losing: "{n} satırdaki değer silinecek",
		noValues: "Değeri yok",
		retyped: "Türü değişti: {from} → {to}",
		unreadable: "{n} değer yeni türde okunamıyor; açılınca işaretlenir",
		added: "Yeni alan",
		addedNote: "boş açılır",
		same: "{n} alan aynı",
		mapped: "{n} alan eşlendi",
		dropped: "{n} alan bırakılıyor",
		string: "Metin",
		integer: "Tam sayı",
		decimal: "Ondalık",
		money: "Para",
		quantity: "Miktar",
		percent: "Yüzde",
		bool: "Evet/Hayır",
		date: "Tarih",
		datetime: "Tarih ve saat",
		options: "Seçenek",
		lookup: "Kayıt"
	},
	en: {
		saved: "Saved {date} · {rows} rows · schema version {from}, now {to}",
		fromHead: "Field in the draft",
		toHead: "Field now",
		drop: "Drop, values are deleted",
		otherType: "other type",
		suggested: "Suggested",
		moves: "{n} values move",
		losing: "Values in {n} rows will be deleted",
		noValues: "No values",
		retyped: "Type changed: {from} → {to}",
		unreadable: "{n} values cannot be read as the new type; they open marked",
		added: "New field",
		addedNote: "opens empty",
		same: "{n} fields unchanged",
		mapped: "{n} fields mapped",
		dropped: "{n} fields dropped",
		string: "Text",
		integer: "Whole number",
		decimal: "Decimal",
		money: "Money",
		quantity: "Quantity",
		percent: "Percent",
		bool: "Yes/no",
		date: "Date",
		datetime: "Date and time",
		options: "Option",
		lookup: "Record"
	}
}

/** The words of the sheet tabs. */
export const TABS_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		sheets: "Sayfalar",
		add: "Sayfa ekle",
		menu: "Sayfa seçenekleri",
		rename: "Yeniden adlandır",
		duplicate: "Çoğalt",
		remove: "Sayfayı sil",
		name: "Sayfanın adı",
		errors: "{n} hata",
		done: "İşlendi",
		changed: "Uygulanmamış değişiklik var",
		doubleClick: "çift tık",
		moveLeft: "Sola taşı",
		moveRight: "Sağa taşı"
	},
	en: {
		sheets: "Sheets",
		add: "Add a sheet",
		menu: "Sheet options",
		rename: "Rename",
		duplicate: "Duplicate",
		remove: "Delete sheet",
		name: "Sheet name",
		errors: "{n} errors",
		done: "Processed",
		changed: "Changes not yet applied",
		doubleClick: "double click",
		moveLeft: "Move left",
		moveRight: "Move right"
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
		formulaHint: "Formülle hesaplanan sütun: yazılmaz; okuduğu sütunlar tabloda aynı renkte",
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
		formulaHint: "A column worked out by its formula: not typed into; the columns it reads are in the same colours",
		statusBar: "Status bar",
		rows: "rows",
		issues: "issues",
		selected: "Selected",
		sum: "Sum",
		average: "Average"
	}
}

/** The grid's own words: what a row's result is, and what a changed issue waits for. */
/** The words of `TabulaFind`. `{current}`, `{total}` and `{n}` are put in. */
export const FIND_TEXT: Readonly<Record<GridLocale, Readonly<Record<string, string>>>> = {
	tr: {
		title: "Bul ve değiştir",
		find: "Bul",
		replace: "Değiştir",
		where: "Nerede",
		selection: "Seçimde",
		column: "Sütunda",
		sheet: "Tabloda",
		matchCase: "Büyük ve küçük harf ayrı",
		whole: "Hücrenin tamamı eşleşsin",
		wholeShort: "Tam hücre",
		count: "{current} / {total} hücre",
		none: "Bulunamadı",
		previous: "Önceki",
		next: "Sonraki",
		replaceOne: "Değiştir",
		replaceAll: "Tümünü değiştir",
		close: "Kapat",
		replaced: "{n} hücre değişti",
		skipped: "{n} hücre değiştirilemedi"
	},
	en: {
		title: "Find and replace",
		find: "Find",
		replace: "Replace",
		where: "Where",
		selection: "In the selection",
		column: "In the column",
		sheet: "In the sheet",
		matchCase: "Match case",
		whole: "Match the whole cell",
		wholeShort: "Whole cell",
		count: "{current} of {total} cells",
		none: "Not found",
		previous: "Previous",
		next: "Next",
		replaceOne: "Replace",
		replaceAll: "Replace all",
		close: "Close",
		replaced: "{n} cells replaced",
		skipped: "{n} cells could not be changed"
	}
}

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
		pickHint: "Boşluk ya da tık seçer; Enter yazar, Esc vazgeçer.",
		cellMenu: "Hücre menüsü",
		cut: "Kes",
		copy: "Kopyala",
		paste: "Yapıştır",
		clearCells: "İçeriği temizle",
		fillDown: "Aşağı doldur",
		fillRight: "Sağa doldur",
		insertAbove: "Üste satır ekle",
		insertBelow: "Alta satır ekle",
		removeRows: "Satırı sil",
		insertAboveCount: "Üste {n} satır ekle",
		insertBelowCount: "Alta {n} satır ekle",
		removeRowsCount: "{n} satırı sil",
		fill: "Doldur",
		rows: "Satırlar",
		filterAndSort: "Süz ve sırala",
		filterValue: "“{value}” olanları göster",
		filterColumnClear: "Bu sütunun süzgecini kaldır",
		pasteRefused: "Tarayıcı panoyu okumaya izin vermedi; Ctrl+V ile yapıştırın.",
		totals: "Alttaki satırda ne gösterilsin",
		totalSum: "Toplam",
		totalAverage: "Ortalama",
		totalMin: "En az",
		totalMax: "En çok",
		newRow: "+ Yeni satır: tıklayın, sonra yazın ya da yapıştırın",
		filledFrom: "{record} kaydından geldi; yazılamaz",
		filledFromEditable: "{record} kaydından geldi; değiştirebilirsiniz",
		filledColumn: "{lookup} seçilince dolar"
	},
	en: {
		cellMenu: "Cell menu",
		cut: "Cut",
		copy: "Copy",
		paste: "Paste",
		clearCells: "Clear contents",
		fillDown: "Fill down",
		fillRight: "Fill right",
		insertAbove: "Insert row above",
		insertBelow: "Insert row below",
		removeRows: "Delete row",
		insertAboveCount: "Insert {n} rows above",
		insertBelowCount: "Insert {n} rows below",
		removeRowsCount: "Delete {n} rows",
		fill: "Fill",
		rows: "Rows",
		filterAndSort: "Filter and sort",
		filterValue: "Show only “{value}”",
		filterColumnClear: "Clear this column’s filter",
		pasteRefused: "The browser did not let the clipboard be read; paste with Ctrl+V.",
		totals: "What the row at the bottom shows",
		totalSum: "Sum",
		totalAverage: "Average",
		totalMin: "Smallest",
		totalMax: "Largest",
		newRow: "+ New row: click, then type or paste",
		filledFrom: "From {record}; not typed into",
		filledFromEditable: "From {record}; yours to change",
		filledColumn: "Filled from the {lookup} picked",
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

/** What a formula function takes and does, for a formula editor's hint and its list. */
export interface FunctionHelp {
	/** Its arguments by name; "…" last when it takes as many as are given. */
	readonly params: readonly string[]
	/** A few words for a list of suggestions. */
	readonly short: string
	/** A sentence for the hint above the formula. */
	readonly text: string
}

const SOME_TR = ["sayı1", "sayı2", "…"]
const SOME_EN = ["number1", "number2", "…"]

const FUNCTION_HELP: Readonly<Record<GridLocale, Readonly<Record<string, FunctionHelp>>>> = {
	tr: {
		ABS: { params: ["sayı"], short: "işaretsiz değer", text: "Sayının işaretsiz değeri: -5 için 5." },
		AND: {
			params: ["koşul1", "koşul2", "…"],
			short: "hepsi doğruysa",
			text: "Koşulların hepsi doğruysa DOĞRU, biri yanlışsa YANLIŞ."
		},
		AVERAGE: { params: SOME_TR, short: "ortalama", text: "Sayıların ortalaması; boş alanlar sayılmaz." },
		CONCAT: {
			params: ["metin1", "metin2", "…"],
			short: "metinleri birleştirir",
			text: "Metinleri art arda ekler."
		},
		IF: {
			params: ["koşul", "doğruysa", "yanlışsa"],
			short: "koşula göre değer",
			text: "Koşul doğruysa ikinci değeri, değilse üçüncüyü verir; yalnız gereken hesaplanır."
		},
		IFERROR: {
			params: ["değer", "hatada"],
			short: "hata yerine değer",
			text: "Değer bir hataysa (#DIV/0! gibi) yerine ikinci değeri verir."
		},
		ISBLANK: { params: ["değer"], short: "boş mu", text: "Değer boşsa DOĞRU." },
		LEN: { params: ["metin"], short: "karakter sayısı", text: "Metindeki karakter sayısı." },
		MAX: { params: SOME_TR, short: "en büyük değer", text: "En büyük sayı; boş alanlar sayılmaz." },
		MIN: { params: SOME_TR, short: "en küçük değer", text: "En küçük sayı; boş alanlar sayılmaz." },
		NOT: { params: ["koşul"], short: "tersi", text: "Koşul doğruysa YANLIŞ, yanlışsa DOĞRU." },
		OR: {
			params: ["koşul1", "koşul2", "…"],
			short: "biri doğruysa",
			text: "Koşullardan biri doğruysa DOĞRU, hepsi yanlışsa YANLIŞ."
		},
		ROUND: {
			params: ["sayı", "basamak"],
			short: "yuvarlar",
			text: "Sayıyı verilen ondalık basamağa yuvarlar: yarım ve üstü yukarı."
		},
		ROUNDDOWN: {
			params: ["sayı", "basamak"],
			short: "aşağı yuvarlar",
			text: "Sayıyı verilen basamakta sıfıra doğru keser."
		},
		ROUNDUP: {
			params: ["sayı", "basamak"],
			short: "yukarı yuvarlar",
			text: "Sayıyı verilen basamakta sıfırdan uzağa yuvarlar."
		},
		SUM: { params: SOME_TR, short: "toplam", text: "Sayıların toplamı; boş alanlar sayılmaz." }
	},
	en: {
		ABS: { params: ["number"], short: "without its sign", text: "The number without its sign: 5 for -5." },
		AND: {
			params: ["condition1", "condition2", "…"],
			short: "true if all are",
			text: "TRUE when every condition holds, FALSE when one does not."
		},
		AVERAGE: {
			params: SOME_EN,
			short: "average",
			text: "The average of the numbers; empty fields are not counted."
		},
		CONCAT: { params: ["text1", "text2", "…"], short: "joins texts", text: "The texts one after another." },
		IF: {
			params: ["condition", "if true", "if false"],
			short: "a value by a condition",
			text: "The second value when the condition holds, the third when not; only the one needed is worked out."
		},
		IFERROR: {
			params: ["value", "on error"],
			short: "a value for an error",
			text: "The second value in place of the first when it is an error, such as #DIV/0!."
		},
		ISBLANK: { params: ["value"], short: "is it empty", text: "TRUE when the value is empty." },
		LEN: { params: ["text"], short: "number of characters", text: "How many characters the text has." },
		MAX: { params: SOME_EN, short: "the largest", text: "The largest number; empty fields are not counted." },
		MIN: { params: SOME_EN, short: "the smallest", text: "The smallest number; empty fields are not counted." },
		NOT: { params: ["condition"], short: "the opposite", text: "FALSE when the condition holds, TRUE when not." },
		OR: {
			params: ["condition1", "condition2", "…"],
			short: "true if one is",
			text: "TRUE when a condition holds, FALSE when none does."
		},
		ROUND: {
			params: ["number", "places"],
			short: "rounds",
			text: "The number rounded to the decimal places given: a half and above goes up."
		},
		ROUNDDOWN: {
			params: ["number", "places"],
			short: "rounds down",
			text: "The number cut towards zero at the places given."
		},
		ROUNDUP: {
			params: ["number", "places"],
			short: "rounds up",
			text: "The number rounded away from zero at the places given."
		},
		SUM: { params: SOME_EN, short: "sum", text: "The sum of the numbers; empty fields are not counted." }
	}
}

/** A formula function's help in the sheet's language; null for one it does not know, an application's own. */
export function functionHelp(name: string, locale: GridLocale): FunctionHelp | null {
	return FUNCTION_HELP[locale][name.toUpperCase()] ?? null
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
