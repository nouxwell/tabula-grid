import { TabulaError } from "./errors"

/**
 * How wide a column may be, and how much of its header is shown.
 *
 * Two upper limits, kept apart on purpose. A column sized from its header stops at `maxAutoWidth`,
 * so one long header does not push the rest of the sheet off screen. A user dragging a column can go
 * on to `maxWidth`, because they asked for it.
 *
 * Characters and pixels are separate too. A header longer than `headerDisplayMaxLength` characters
 * is cut and ends in "…"; a shorter one that is still too wide for its column is cut by the column.
 * Either way the full header stays available as the column's tooltip, and no cell value is ever cut
 * in the data, only in how it is drawn.
 */
export interface ColumnSizing {
	/** Pixels. No column is narrower, however it is sized. */
	readonly minWidth: number
	/** Pixels. The widest a column is made on its own. */
	readonly maxAutoWidth: number
	/** Pixels. The widest a user can make a column. */
	readonly maxWidth: number
	/** Characters of a header shown before it is cut with "…". */
	readonly headerDisplayMaxLength: number
	/** Whether the user can drag the column's edge. */
	readonly resizable: boolean
}

export const DEFAULT_COLUMN_SIZING: ColumnSizing = Object.freeze({
	minWidth: 100,
	maxAutoWidth: 320,
	maxWidth: 1000,
	headerDisplayMaxLength: 100,
	resizable: true
})

/**
 * The sizing for one column: the defaults, then each layer over the one before, such as the
 * module's settings and then the column's own.
 *
 * @throws TabulaError when the limits cannot all hold, such as a minimum above a maximum
 */
export function resolveColumnSizing(...layers: readonly (Partial<ColumnSizing> | undefined)[]): ColumnSizing {
	const sizing: ColumnSizing = Object.assign({}, DEFAULT_COLUMN_SIZING, ...layers.filter(Boolean))

	for (const name of ["minWidth", "maxAutoWidth", "maxWidth", "headerDisplayMaxLength"] as const) {
		const value = sizing[name]

		if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
			throw new TabulaError(
				"invalid_argument",
				`Column sizing ${name} must be a number, 1 or more; got ${String(value)}.`
			)
		}
	}

	if (sizing.minWidth > sizing.maxAutoWidth) {
		throw new TabulaError(
			"invalid_argument",
			`Column sizing minWidth ${sizing.minWidth} is above maxAutoWidth ${sizing.maxAutoWidth}.`
		)
	}

	if (sizing.minWidth > sizing.maxWidth) {
		throw new TabulaError(
			"invalid_argument",
			`Column sizing minWidth ${sizing.minWidth} is above maxWidth ${sizing.maxWidth}.`
		)
	}

	return Object.freeze(sizing)
}

/**
 * The header as it is drawn: whole when it fits the character limit, cut and ending in "…" when it
 * does not. Counted in characters a reader sees, so a cut never splits one in half.
 */
export function headerDisplayText(label: string, maxLength: number): string {
	const characters = Array.from(label)

	return characters.length <= maxLength ? label : `${characters.slice(0, maxLength).join("")}…`
}

/** The width for content of this many pixels, kept between `minWidth` and the automatic maximum. */
export function autoColumnWidth(contentWidth: number, sizing: ColumnSizing): number {
	return clamp(Math.ceil(contentWidth), sizing.minWidth, Math.min(sizing.maxAutoWidth, sizing.maxWidth))
}

/** A width the user set, kept between `minWidth` and `maxWidth`. */
export function clampColumnWidth(width: number, sizing: ColumnSizing): number {
	return clamp(Math.round(width), sizing.minWidth, sizing.maxWidth)
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}
