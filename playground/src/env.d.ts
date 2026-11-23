import type {
	Adjustment,
	CellMarks,
	ColumnFormats,
	ColumnLayout,
	DraftSaver,
	FormulaEngine,
	LookupResolver,
	ModuleSchema,
	RowStore,
	RowView,
	Selection,
	SheetChanges,
	SheetSession,
	SheetValidator,
	UndoHistory
} from "@nouxwell/tabula-core"
import type { GridPosition } from "@nouxwell/tabula-vue"
import type { FakeBackend } from "./backend"

/** What the playground puts on the page for the browser tests to read. */
export interface PlaygroundHandle {
	readonly schema: ModuleSchema
	readonly store: RowStore
	readonly selection: Selection
	readonly validator: SheetValidator
	readonly history: UndoHistory
	readonly session: SheetSession
	readonly backend: FakeBackend
	/** Null while a stored draft waits to be reviewed. */
	readonly saver: DraftSaver | null
	readonly lookups: LookupResolver
	readonly formulas: FormulaEngine
	readonly view: RowView
	readonly changes: SheetChanges
	/** The grid's `adjustSelection`: how many cells it changed. */
	readonly adjust: (adjustment: Adjustment) => number
	/** The grid's `position()` and `restorePosition()`. */
	readonly position: () => GridPosition | null
	readonly restorePosition: (position: GridPosition) => void
	readonly widths: () => Readonly<Record<string, number>>
	readonly columns: () => ColumnLayout
	/** With `?format=1`: the marks the user puts on cells. */
	readonly marks: CellMarks | null
	readonly setColumns: (layout: ColumnLayout) => void
	/** The grid's `defaultFormats`: a template's formats, under the user's own. */
	readonly setDefaultFormats: (formats: ColumnFormats | undefined) => void
}

declare global {
	interface Window {
		__playground?: PlaygroundHandle
	}
}
