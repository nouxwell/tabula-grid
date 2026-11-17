import type { ModuleSchema, RowStore, Selection, SheetValidator, UndoHistory } from "@nouxwell/tabula-core"

/** What the playground puts on the page for the browser tests to read. */
export interface PlaygroundHandle {
	readonly schema: ModuleSchema
	readonly store: RowStore
	readonly selection: Selection
	readonly validator: SheetValidator
	readonly history: UndoHistory
	readonly widths: () => Readonly<Record<string, number>>
}

declare global {
	interface Window {
		__playground?: PlaygroundHandle
	}
}
