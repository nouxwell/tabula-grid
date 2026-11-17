import type {
	DraftSaver,
	ModuleSchema,
	RowStore,
	Selection,
	SheetSession,
	SheetValidator,
	UndoHistory
} from "@nouxwell/tabula-core"
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
	readonly widths: () => Readonly<Record<string, number>>
}

declare global {
	interface Window {
		__playground?: PlaygroundHandle
	}
}
