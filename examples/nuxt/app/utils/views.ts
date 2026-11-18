import {
	addView,
	emptyViews,
	PLAIN_VIEW,
	readViews,
	removeView,
	renameView,
	sameView,
	setDefaultView,
	updateView,
	viewFor,
	type ColumnFilters,
	type ColumnLayout,
	type ColumnSort,
	type ModuleSchema,
	type SavedView,
	type SavedViews,
	type ViewState
} from "@nouxwell/tabula-core"

/** The grid's models a view is read from and written into. */
export interface ViewModels {
	readonly columns: Ref<ColumnLayout>
	readonly widths: Ref<Readonly<Record<string, number>>>
	readonly filters: Ref<ColumnFilters>
	readonly sort: Ref<ColumnSort | null>
}

/**
 * The user's saved views of the sheet: the columns, their widths, the filters and the sort, under a
 * name. The example keeps them in the browser's storage; an application keeps them on its server
 * for each user, as the same JSON document.
 */
const VIEWS_KEY = "tabula-grid.example-nuxt.views"

function stored(module: string): SavedViews {
	try {
		const text = localStorage.getItem(VIEWS_KEY)

		return text === null ? emptyViews(module) : readViews(JSON.parse(text), module)
	} catch {
		// Views that cannot be read are not worth a broken page: the sheet opens as laid out.
		return emptyViews(module)
	}
}

/**
 * Saved views for one sheet. Nothing is read before `open`, which runs in the browser once the sheet
 * is made; the server draws the page without them.
 */
export function useSavedViews(models: ViewModels, locale: Ref<string>) {
	const views = shallowRef<SavedViews | null>(null)
	const schema = shallowRef<ModuleSchema | null>(null)
	/** How the sheet is laid out with no view chosen: the template's arrangement, or the schema's. */
	const base = shallowRef<ViewState>(PLAIN_VIEW)
	/** The view chosen last; null for the sheet as its schema lays it out. */
	const currentId = ref<string | null>(null)

	const current = computed<SavedView | null>(
		() => views.value?.views.find(view => view.id === currentId.value) ?? null
	)

	/** The sheet as it stands on screen. */
	const state = computed<ViewState>(() => ({
		columns: models.columns.value,
		columnWidths: models.widths.value,
		filters: models.filters.value,
		sort: models.sort.value
	}))

	/** Whether the sheet on screen is no longer the view chosen: a column moved, a filter set. */
	const modified = computed(() =>
		schema.value ? !sameView(schema.value, state.value, current.value ?? base.value) : false
	)

	function keep(next: SavedViews): void {
		views.value = next

		try {
			localStorage.setItem(VIEWS_KEY, JSON.stringify(next))
		} catch {
			// Full or switched off: the views last as long as the page.
		}
	}

	function put(view: ViewState, only?: "filters"): void {
		const fitted = schema.value ? viewFor(view, schema.value) : view

		if (only !== "filters") {
			models.columns.value = fitted.columns
			models.widths.value = fitted.columnWidths
		}

		models.filters.value = fitted.filters
		models.sort.value = fitted.sort
	}

	/**
	 * Reads the views and opens the sheet in the default one, or as `layout` lays it out: a template's
	 * arrangement. A draft brought its own columns back: those stay, and the view gives the filters
	 * and the sort.
	 */
	function open(sheetSchema: ModuleSchema, restoredLayout: boolean, layout: ViewState = PLAIN_VIEW): void {
		schema.value = sheetSchema
		base.value = layout
		views.value = stored(sheetSchema.module)

		const first = views.value.views.find(view => view.id === views.value?.defaultId) ?? null

		currentId.value = first?.id ?? null
		put(first ?? layout, restoredLayout ? "filters" : undefined)
	}

	/** Shows a saved view, or with null the sheet as its template or schema lays it out. */
	function show(id: string | null): void {
		const view = views.value?.views.find(item => item.id === id) ?? null

		currentId.value = view?.id ?? null
		put(view ?? base.value)
	}

	/** Saves the sheet as it stands as a new view, and makes it the one chosen. */
	function saveAs(name: string): void {
		if (!views.value) {
			return
		}

		const id = crypto.randomUUID()

		keep(addView(views.value, { id, name, ...state.value }, { locale: locale.value }))
		currentId.value = id
	}

	/** Saves the sheet as it stands into the view chosen. */
	function save(): void {
		if (views.value && currentId.value) {
			keep(updateView(views.value, currentId.value, state.value))
		}
	}

	function rename(name: string): void {
		if (views.value && currentId.value) {
			keep(renameView(views.value, currentId.value, name, { locale: locale.value }))
		}
	}

	/** Deletes the view chosen. The sheet stays as it is on screen, now as no view. */
	function remove(): void {
		if (views.value && currentId.value) {
			keep(removeView(views.value, currentId.value))
			currentId.value = null
		}
	}

	/** Opens the sheet in the view chosen from now on, or no longer. */
	function toggleDefault(): void {
		if (views.value && currentId.value) {
			keep(setDefaultView(views.value, views.value.defaultId === currentId.value ? null : currentId.value))
		}
	}

	return { views, currentId, current, modified, open, show, saveAs, save, rename, remove, toggleDefault }
}

export type SavedViewsHandle = ReturnType<typeof useSavedViews>
