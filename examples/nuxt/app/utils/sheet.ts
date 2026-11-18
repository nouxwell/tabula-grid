import {
	applyFormulas,
	applyTemplate,
	arrangeColumns,
	csvDelimiterFor,
	decodeText,
	DraftSaver,
	exportTable,
	FormulaEngine,
	importTable,
	LookupResolver,
	ModuleSchema,
	openDraft,
	parseCsv,
	readDraft,
	readTemplate,
	RowStore,
	rowsWithIssues,
	RowView,
	SheetSession,
	SheetValidator,
	toCsv,
	UndoHistory,
	VALUE_SETTINGS,
	withDefaults,
	type ColumnLayout,
	type Draft,
	type GridTemplate,
	type LookupAdapters,
	type ModuleSchemaInput,
	type RowInit,
	type SheetAdapters,
	type TableImport
} from "@nouxwell/tabula-core"

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
 * The example keeps one draft in the browser's storage. An application keeps drafts on its server,
 * by their ids, through the same kind of `save`.
 */
const DRAFT_KEY = "tabula-grid.example-nuxt.draft"

function storedDraft(): unknown {
	try {
		const text = localStorage.getItem(DRAFT_KEY)

		return text === null ? null : (JSON.parse(text) as unknown)
	} catch {
		return null
	}
}

async function storeDraft(draft: Draft): Promise<void> {
	localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

/** The kept draft, opened against the schema as it is now; null when there is none or it cannot be read. */
function openKept(schema: ModuleSchema): ReturnType<typeof openDraft> | null {
	const kept = storedDraft()

	try {
		return kept === null ? null : openDraft(readDraft(kept), schema)
	} catch {
		return null
	}
}

export type ValueLocale = keyof typeof VALUE_SETTINGS

/** What an import brought: how many rows, and what became of each column of the file. */
export interface ImportResult extends Pick<TableImport, "columns" | "missing" | "unreadable"> {
	readonly added: number
	/** The first row added, to go to; null when the file brought none. */
	readonly firstRowId: string | null
}

/**
 * The sheet's working parts, made in the browser only, once the page is there. The server draws the
 * page around the grid; the grid itself is drawn in the browser, and none of these would outlive the
 * trip there. A draft kept from an earlier visit is opened in place of the server's rows when it
 * still fits the schema. `dispose()` lets them go.
 *
 * With a template, the sheet works with the module schema as the template narrows it. A template
 * that does not apply is left out, and `templateError` says why. `carried` rows, the sheet's own
 * when the template changes, are taken as they are, in place of a draft.
 */
export function createSheet(
	input: ModuleSchemaInput,
	rows: readonly RowInit[],
	locale: Ref<ValueLocale>,
	layout: { readonly columns: Ref<ColumnLayout>; readonly widths: Ref<Readonly<Record<string, number>>> },
	options: { readonly template?: unknown; readonly carried?: boolean } = {}
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

	const opening = options.carried ? null : openKept(schema)
	const opened = opening?.status === "opened" ? opening : null
	const store = new RowStore({ rows: opened ? opened.rows : applyFormulas(schema, rows) })
	const formulas = new FormulaEngine({ schema, store })
	const validator = new SheetValidator(schema, store, VALUE_SETTINGS[locale.value])
	const history = new UndoHistory(store)
	const session = new SheetSession({
		schema,
		store,
		validator,
		history,
		adapters,
		...(opened ? { restore: opened.session } : {})
	})
	const lookups = new LookupResolver({ schema, store, adapters: lookupAdapters })
	const view = new RowView(store)
	const saver = new DraftSaver({
		schema,
		store,
		session,
		save: storeDraft,
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
		session.subscribe(bump),
		session.results.subscribe(bump),
		view.subscribe(bump),
		saver.subscribe(bump)
	]
	const stopLocale = watch(locale, value => validator.setSettings(VALUE_SETTINGS[value]))

	function onlyIssueRows(only: boolean): void {
		if (only) {
			view.filter(rowsWithIssues(session.issues), "issues")
		} else {
			view.clear("issues")
		}
	}

	/** Reads a CSV file as a spreadsheet writes it and adds its rows at the end, as one change. */
	async function importCsv(file: File): Promise<ImportResult> {
		const text = decodeText(new Uint8Array(await file.arrayBuffer()))
		const result = importTable(parseCsv(text), { schema, settings: VALUE_SETTINGS[locale.value] })
		const first = store.size

		if (result.rows.length > 0) {
			// Columns the file does not have take the schema's defaults, as rows a paste adds do.
			store.transact(() => store.appendRows(withDefaults(schema, result.rows)), { origin: "import" })
		}

		return {
			added: result.rows.length,
			firstRowId: result.rows.length > 0 ? (store.rowIdAt(first) ?? null) : null,
			columns: result.columns,
			missing: result.missing,
			unreadable: result.unreadable
		}
	}

	/** The rows and columns on screen, written as the sheet shows them, for Excel in the sheet's language. */
	function exportCsv(): void {
		const settings = VALUE_SETTINGS[locale.value]
		const fields = arrangeColumns(schema.fields, columns.value).fields
		const rowIds = Array.from({ length: view.size }, (_, index) => view.rowIdAt(index) ?? "")
		const text = toCsv(exportTable({ store, fields, rowIds, settings }), { delimiter: csvDelimiterFor(settings) })
		const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
		const link = document.createElement("a")

		link.href = url
		link.download = `${schema.module}.csv`
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 0)
	}

	function dispose(): void {
		stopLocale()
		stopLayout()
		stops.forEach(stop => stop())
		saver.dispose()
		lookups.dispose()
		session.dispose()
		validator.dispose()
		view.dispose()
		formulas.dispose()
		history.dispose()
	}

	return {
		schema,
		store,
		validator,
		history,
		session,
		lookups,
		view,
		saver,
		/** Whether a kept draft was opened, with the columns the user had. */
		restored: opened !== null,
		/** The template the sheet works with, and why one asked for could not be. */
		template,
		templateError,
		version,
		onlyIssueRows,
		importCsv,
		exportCsv,
		dispose
	}
}

export type Sheet = ReturnType<typeof createSheet>
