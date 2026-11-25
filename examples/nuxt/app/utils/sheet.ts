import {
	applyFormulas,
	applyImport,
	applyTemplate,
	arrangeColumns,
	csvDelimiterFor,
	decodeText,
	DraftSaver,
	exportTable,
	FormulaEngine,
	importTable,
	LookupResolver,
	matchRows,
	ModuleSchema,
	openDraft,
	parseCsv,
	readTemplate,
	RowStore,
	rowsChanged,
	rowsContaining,
	rowsWithIssues,
	RowView,
	SheetChanges,
	SheetSession,
	SheetValidator,
	toCsv,
	UndoHistory,
	VALUE_SETTINGS,
	type ColumnLayout,
	type Draft,
	type DraftChanges,
	type FormulaSheets,
	type GridTemplate,
	type LookupAdapters,
	type ModuleSchemaInput,
	type RowInit,
	type Issue,
	type RowId,
	type SheetAdapters,
	CellMarks,
	rowsMarked,
	type MarksData,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { issueText, type GridLocale } from "@nouxwell/tabula-vue"

/** How the sheet reaches the example's server: here $fetch, in an application its own API client. */
const adapters: SheetAdapters = {
	preflight: (request, { signal }) => $fetch("/api/price-updates/check", { method: "POST", body: request, signal }),
	process: (request, { signal }) => $fetch("/api/price-updates/process", { method: "POST", body: request, signal })
}

const lookupAdapters: LookupAdapters = {
	search: ({ lookup, query, limit }, { signal }) =>
		$fetch(`/api/lookups/${lookup}`, { query: { query, limit }, signal }),
	resolve: ({ lookup, labels }, { signal }) =>
		$fetch(`/api/lookups/${lookup}`, { method: "POST", body: { lookup, labels }, signal })
}

/**
 * The sheet's kept draft, opened against the schema as it is now, or come back for review when the
 * schema moved on; with `rename`, opened anyway, its fields mapped as the user chose. Null when there
 * is none or it cannot be opened.
 */
function openKept(
	schema: ModuleSchema,
	draft: Draft | null | undefined,
	rename?: Readonly<Record<string, string>>
): { readonly draft: Draft; readonly opening: ReturnType<typeof openDraft> } | null {
	try {
		return draft ? { draft, opening: openDraft(draft, schema, rename ? { accept: true, rename } : {}) } : null
	} catch {
		return null
	}
}

export type ValueLocale = keyof typeof VALUE_SETTINGS

/** How a file's rows go into the sheet, as the user chose in the import window. */
export interface ImportChoice {
	/** Which field each column goes to, by its position; null leaves it out. */
	readonly columns: Readonly<Record<number, string | null>>
	/** The column whose text finds rows in the sheet by this field, to write into them; null to add every row. */
	readonly match: { readonly column: number; readonly field: string } | null
	/** With `match`, what becomes of a row that finds none. */
	readonly unmatched: "add" | "skip"
}

/** What an import did. */
export interface ImportResult {
	readonly added: number
	readonly updated: number
	/** Rows of the file left out: finding none, or only rows already processed. */
	readonly skipped: number
	/** Cells whose text was not a value of their column: kept as written, and marked. */
	readonly unreadable: number
	/** The first row added or written into, to go to; null when there is none. */
	readonly firstRowId: string | null
}

/**
 * One sheet's working parts, made in the browser only, once the page is there. The server draws the
 * page around the grid; the grid itself is drawn in the browser, and none of these would outlive the
 * trip there. The sheet's draft, kept in the workbook from an earlier visit or an earlier tab, is
 * opened in place of the server's rows when it still fits the schema. `dispose()` lets them go.
 *
 * With a template, the sheet works with the module schema as the template narrows it. A template
 * that does not apply is left out, and `templateError` says why. `carried` rows, the sheet's own
 * when the template changes, are taken as they are, in place of a draft.
 *
 * What the user changed is told against `baseline`, the server's rows, matched by product: a draft
 * opened on another day still shows what it changed.
 *
 * A draft saved under another schema is not opened, nor is it written over: `review` holds it, the
 * sheet opens with the server's rows and saves nothing until the user decides. Made again with
 * `draft.rename`, the sheet opens the draft with its fields mapped so.
 */
export function createSheet(
	input: ModuleSchemaInput,
	rows: readonly RowInit[],
	locale: Ref<ValueLocale>,
	layout: { readonly columns: Ref<ColumnLayout>; readonly widths: Ref<Readonly<Record<string, number>>> },
	options: {
		/** The workbook's id for the sheet, in its requests and issues. */
		readonly sheetId: string
		/** The sheet as last saved, opened in place of the server's rows when it still fits. */
		readonly kept: Draft | null
		/** Keeps the sheet's draft in the workbook. */
		readonly save: (draft: Draft) => Promise<void>
		readonly template?: unknown
		readonly carried?: boolean
		readonly baseline?: readonly RowInit[]
		/** The kept draft, opened with its fields mapped as the user chose. */
		readonly mapping?: { readonly rename: Readonly<Record<string, string>> }
		/** Marks carried with the rows, from a sheet made again over them. */
		readonly marks?: MarksData
		/** The workbook's sheets, for formulas that read another with SHEET. */
		readonly sheets?: FormulaSheets
	}
) {
	const { columns, widths } = layout
	const moduleSchema = ModuleSchema.from(input)
	let template: GridTemplate | null = null
	let templateError: string | null = null
	let schema = moduleSchema

	if (options.template) {
		try {
			template = readTemplate(options.template, moduleSchema.module)
			schema = applyTemplate(moduleSchema, template)
		} catch (error) {
			template = null
			templateError = error instanceof Error ? error.message : String(error)
		}
	}

	const kept = options.carried ? null : openKept(schema, options.kept, options.mapping?.rename)
	const opening = kept?.opening ?? null
	const opened = opening?.status === "opened" ? opening : null
	const review: { readonly draft: Draft; readonly changes: DraftChanges } | null =
		kept && opening?.status === "review" ? { draft: kept.draft, changes: opening.changes } : null
	const sheets = options.sheets ?? null
	const store = new RowStore({ rows: opened ? opened.rows : applyFormulas(schema, rows, {}, sheets) })
	const formulas = new FormulaEngine({ schema, store, ...(sheets ? { sheets } : {}) })
	const validator = new SheetValidator(schema, store, VALUE_SETTINGS[locale.value])
	const history = new UndoHistory(store)
	// What the user put on cells by hand: kept with the draft, taken back with Ctrl+Z in its turn.
	const marks = new CellMarks({ marks: opened?.marks ?? options.marks ?? {}, history })
	const session = new SheetSession({
		schema,
		store,
		validator,
		history,
		adapters,
		sheetId: options.sheetId,
		...(opened ? { restore: opened.session } : {})
	})
	const lookups = new LookupResolver({ schema, store, adapters: lookupAdapters })
	const changes = new SheetChanges({
		schema,
		store,
		baseline: options.baseline ?? rows,
		key: "productId",
		settings: VALUE_SETTINGS[locale.value]
	})
	const view = new RowView(store)
	const saver = new DraftSaver({
		schema,
		store,
		session,
		marks,
		// The same draft, saved again under its id.
		...(options.kept ? { id: options.kept.id } : {}),
		// The kept draft waits for the user's word: nothing is written over it meanwhile.
		save: review ? async () => {} : options.save,
		view: () => ({ columnWidths: widths.value, columns: columns.value })
	})

	// The user's columns come back with the draft, and a change to them is a change to save.
	if (opened) {
		widths.value = opened.view.columnWidths
		columns.value = opened.view.columns ?? {}
	}

	const stopLayout = watch([columns, widths], () => saver.changed())

	// The parts keep their state themselves and say when it moves; this is what Vue redraws by.
	const version = shallowRef(0)
	const bump = () => version.value++
	const stops = [
		history.subscribe(bump),
		marks.subscribe(bump),
		session.subscribe(bump),
		session.results.subscribe(bump),
		view.subscribe(bump),
		saver.subscribe(bump),
		changes.subscribe(bump)
	]
	const stopLocale = watch(locale, value => validator.setSettings(VALUE_SETTINGS[value]))

	function onlyIssueRows(only: boolean): void {
		if (only) {
			view.filter(rowsWithIssues(session.issues), "issues")
		} else {
			view.clear("issues")
		}
	}

	/** Only the rows with a cell the user coloured, as they are now. */
	function onlyMarked(only: boolean): void {
		if (only) {
			view.filter(rowsMarked(marks), "marked")
		} else {
			view.clear("marked")
		}
	}

	/** Only the rows the user changed or added, as they are now. */
	function onlyChanged(only: boolean): void {
		if (only) {
			view.filter(rowsChanged(changes), "changed")
		} else {
			view.clear("changed")
		}
	}

	/** The rows holding the text, as their cells show it; empty text shows every row again. */
	function search(text: string): void {
		if (text.trim() === "") {
			view.clear("search")
		} else {
			view.filter(rowsContaining(store, schema, text, { settings: VALUE_SETTINGS[locale.value] }), "search")
		}
	}

	/** A CSV file's table, read as a spreadsheet writes it, for the import window to show. */
	async function readCsv(file: File): Promise<string[][]> {
		return parseCsv(decodeText(new Uint8Array(await file.arrayBuffer())))
	}

	/**
	 * A file's rows into the sheet as the user chose, as one change: written into the rows they find,
	 * or added at the end with the schema's defaults where the file leaves a column out. Rows the
	 * backend has processed are not written into.
	 */
	function importRows(table: readonly (readonly string[])[], choice: ImportChoice): ImportResult {
		const settings = VALUE_SETTINGS[locale.value]
		const imported = importTable(table, {
			schema,
			settings,
			columns: choice.columns,
			key: choice.match?.column ?? null
		})
		const matches = choice.match
			? matchRows(store, schema.field(choice.match.field), imported.keys, settings)
			: undefined
		const applied = applyImport(store, schema, imported, {
			...(matches ? { matches } : {}),
			unmatched: choice.unmatched,
			locked: rowId => session.results.isLocked(rowId)
		})
		const firstUpdated = matches?.find(found => found.length > 0)?.[0] ?? null

		return {
			added: applied.added.length,
			updated: applied.updated,
			skipped: applied.skipped,
			unreadable: imported.unreadable,
			firstRowId: firstUpdated ?? applied.added[0] ?? null
		}
	}

	/** The rows and columns on screen, written as the sheet shows them, for Excel in the sheet's language. */
	function exportCsv(): void {
		const settings = VALUE_SETTINGS[locale.value]
		const fields = arrangeColumns(schema.fields, columns.value).fields
		const rowIds = Array.from({ length: view.size }, (_, index) => view.rowIdAt(index) ?? "")
		const text = toCsv(exportTable({ store, fields, rowIds, settings }), { delimiter: csvDelimiterFor(settings) })

		download(text, `${schema.module}.csv`)
	}

	/** The issues standing on each row, the backend's only or every one. */
	function issuesByRow(only?: "server"): Map<RowId, Issue[]> {
		const rows = new Map<RowId, Issue[]>()

		for (const issue of session.issues.issues()) {
			if (issue.rowId === null || (only === "server" && issue.source === "local")) {
				continue
			}

			rows.set(issue.rowId, [...(rows.get(issue.rowId) ?? []), issue])
		}

		return rows
	}

	/** How many rows an issues file would hold. */
	function issueRowCount(only?: "server"): number {
		return issuesByRow(only).size
	}

	/**
	 * The rows with issues, the backend's only or every one, as a file for Excel: each row's number
	 * first, its columns as the sheet shows them, and its issues last, each with who found it. Fixed
	 * and imported again, the rows are found by their product and written into; "Satır" and
	 * "Sorunlar" go nowhere. Returns how many rows it wrote.
	 */
	function exportIssueRows(gridLocale: GridLocale, only?: "server"): number {
		const table = issueTable(gridLocale, only)

		if (table === null) {
			return 0
		}

		downloadCsv(table, `${schema.module}-hatali-satirlar.csv`, VALUE_SETTINGS[locale.value])

		return table.length - 1
	}

	/** The rows with issues as `exportIssueRows` writes them, its header first; null when there are none. */
	function issueTable(gridLocale: GridLocale, only?: "server"): string[][] | null {
		const settings = VALUE_SETTINGS[locale.value]
		const byRow = issuesByRow(only)
		const fields = arrangeColumns(schema.fields, columns.value).fields
		const rowIds = store.rowIds().filter(rowId => byRow.has(rowId))
		const words = (issue: Issue): string => {
			const where = issue.field && schema.has(issue.field) ? `${schema.field(issue.field).label}: ` : ""
			const who = issue.source === "local" ? "tarayıcı" : "sunucu"

			return `${where}${issueText(issue, gridLocale, settings)} (${who}${issue.severity === "warning" ? ", uyarı" : ""})`
		}

		if (rowIds.length === 0) {
			return null
		}

		return exportTable({
			store,
			fields,
			rowIds,
			settings,
			extra: [
				{ header: "Satır", at: "start", text: rowId => String(store.indexOf(rowId) + 1) },
				{ header: "Sorunlar", text: rowId => (byRow.get(rowId) ?? []).map(words).join(" · ") }
			]
		})
	}

	/**
	 * The rows a run would send that the user changed since the sheet was loaded: what its tab and
	 * "Tüm sayfaları uygula" count as not yet applied.
	 */
	function pendingRows(): number {
		const changed = new Set(changes.changedRows())

		return session.unfinishedRows().filter(rowId => changed.has(rowId)).length
	}

	function dispose(): void {
		stopLocale()
		stopLayout()
		stops.forEach(stop => stop())
		saver.dispose()
		lookups.dispose()
		changes.dispose()
		session.dispose()
		validator.dispose()
		view.dispose()
		formulas.dispose()
		history.dispose()
	}

	/** The other sheets were saved or renamed: what the formulas read from them is worked out again. */
	function refreshSheets(next: FormulaSheets): void {
		formulas.refreshSheets(next)
	}

	return {
		schema,
		store,
		validator,
		history,
		session,
		refreshSheets,
		lookups,
		view,
		saver,
		changes,
		marks,
		/** A kept draft saved under another schema, waiting for the user to map its fields or let it go. */
		review,
		/** Whether a kept draft was opened, with the columns the user had. */
		restored: opened !== null,
		/** The template the sheet works with, and why one asked for could not be. */
		template,
		templateError,
		version,
		onlyIssueRows,
		onlyChanged,
		onlyMarked,
		search,
		readCsv,
		importRows,
		exportCsv,
		issueRowCount,
		exportIssueRows,
		issueTable,
		pendingRows,
		dispose
	}
}

/** A table saved as a CSV file the browser downloads, in the delimiter its locale's Excel reads. */
export function downloadCsv(table: readonly (readonly string[])[], name: string, settings: ValueSettings): void {
	download(toCsv(table, { delimiter: csvDelimiterFor(settings) }), name)
}

/** Text saved as a file the browser downloads. */
function download(text: string, name: string): void {
	const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
	const link = document.createElement("a")

	link.href = url
	link.download = name
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}

export type Sheet = ReturnType<typeof createSheet>
