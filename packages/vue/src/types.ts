import type { CellSummary, FieldSchema, FormulaPart, RowId } from "@nouxwell/tabula-core"

/**
 * The colours the grid draws with. `auto` follows the viewer's system setting; an application with
 * its own light and dark switch passes `light` or `dark` instead.
 */
export type GridTheme = "light" | "dark" | "auto"

/** The grid's active cell, as a formula bar shows it (`TabulaGrid`'s `cell`). */
export interface ActiveCell {
	readonly rowId: RowId
	readonly field: FieldSchema
	/** "D9": the column's letters as the columns stand on screen, and the row's number in the sheet. */
	readonly address: string
	/** What an editor opens with: the value, every digit kept. */
	readonly text: string
	/** Whether it can be typed into now: an editable column, in a row no run has locked. */
	readonly editable: boolean
	/** A column worked out by a formula: the formula in pieces, its fields written with their labels. */
	readonly formula: readonly FormulaPart[] | null
	/**
	 * The fields the formula reads, each once, in the order it reads them. The grid colours each
	 * one's column with the colour of its place, and a formula bar colours it the same.
	 */
	readonly references: readonly string[]
}

/** An item the host adds to the menu a right click opens on a cell or a row's number. */
export interface GridMenuItem {
	/** What `menu` is emitted with when it is chosen. */
	readonly key: string
	readonly label: string
	/** The keys that do the same, shown beside it, such as "Ctrl+D". */
	readonly shortcut?: string
	readonly disabled?: boolean
	/** Items opened beside this one; choosing one of them emits its own key. */
	readonly children?: readonly GridMenuItem[]
}

/** The cells selected, as a status bar shows them (`TabulaGrid`'s `selected`). */
export interface SelectedCells extends CellSummary {
	/** "D9:D11", or "D9" for one cell. */
	readonly address: string
	readonly rows: number
	readonly columns: number
	/** The first numeric column in the selection: the sum and average are written as it writes a number. */
	readonly field: FieldSchema | null
}
