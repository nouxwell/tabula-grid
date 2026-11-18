import { TabulaError } from "./errors.js"

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

export const COLUMN_ALIGNS = Object.freeze(["left", "center", "right"] as const)
export type ColumnAlign = (typeof COLUMN_ALIGNS)[number]

/** The most digits after the point a column can be told to show. */
export const MAX_SHOWN_DECIMALS = 6

/**
 * How a column's values are drawn. Never what they are: a number shown with fewer digits keeps every
 * digit it has, and the backend is sent the same value whatever is shown.
 */
export interface ColumnFormat {
	/** Where the values sit in their cells. Left out, numbers on the right and the rest on the left. */
	readonly align?: ColumnAlign
	/** Digits after the point a number column shows, 0 to `MAX_SHOWN_DECIMALS`. Left out, its field's. */
	readonly decimals?: number
}

/**
 * A user's arrangement of the columns, kept with their view of the sheet. Only how the columns are
 * shown: hiding a required column relaxes nothing, and its issues are still listed.
 *
 * Keys the schema does not have are passed over, so a layout saved before a column was removed
 * still applies.
 */
export interface ColumnLayout {
	/** Columns in the order to show them; those left out follow, in the schema's order. */
	readonly order?: readonly string[]
	readonly hidden?: readonly string[]
	/** Columns kept in place on the left while the sheet scrolls sideways. They are shown first. */
	readonly pinned?: readonly string[]
	/** How each column's values are drawn, by field key. */
	readonly formats?: Readonly<Record<string, ColumnFormat>>
}

export interface ArrangedColumns<F> {
	/** The columns shown, in order: the pinned ones first. */
	readonly fields: readonly F[]
	/** How many of the first are pinned. */
	readonly pinned: number
}

/** The columns a layout shows, in the order it shows them. */
export function arrangeColumns<F extends { readonly key: string }>(
	fields: readonly F[],
	layout: ColumnLayout = {}
): ArrangedColumns<F> {
	const byKey = new Map(fields.map(field => [field.key, field]))
	const hidden = new Set(layout.hidden ?? [])
	const pinned = new Set(layout.pinned ?? [])
	const ordered: F[] = []
	const seen = new Set<string>()

	for (const key of [...(layout.order ?? []), ...fields.map(field => field.key)]) {
		const field = byKey.get(key)

		if (field && !seen.has(key)) {
			seen.add(key)
			ordered.push(field)
		}
	}

	const shown = ordered.filter(field => !hidden.has(field.key))
	const first = shown.filter(field => pinned.has(field.key))

	return Object.freeze({
		fields: Object.freeze([...first, ...shown.filter(field => !pinned.has(field.key))]),
		pinned: first.length
	})
}

/** The layout with one column hidden or shown, pinned or let go. */
export function withColumn(
	layout: ColumnLayout,
	key: string,
	change: { readonly hidden?: boolean; readonly pinned?: boolean }
): ColumnLayout {
	const toggle = (list: readonly string[] | undefined, on: boolean | undefined): readonly string[] | undefined => {
		if (on === undefined) {
			return list
		}

		const rest = (list ?? []).filter(item => item !== key)

		return Object.freeze(on ? [...rest, key] : rest)
	}

	return Object.freeze({
		...layout,
		...(change.hidden === undefined ? {} : { hidden: toggle(layout.hidden, change.hidden) }),
		...(change.pinned === undefined ? {} : { pinned: toggle(layout.pinned, change.pinned) })
	})
}

/**
 * The layout with one column drawn another way: what `change` gives replaces what the column had,
 * a property given as `undefined` goes back to the default, and `null` takes the whole format off.
 *
 * @throws TabulaError `invalid_argument` for an alignment that is not one, or decimals out of 0–6
 */
export function withColumnFormat(
	layout: ColumnLayout,
	key: string,
	change: { readonly align?: ColumnAlign | undefined; readonly decimals?: number | undefined } | null
): ColumnLayout {
	const formats: Record<string, ColumnFormat> = { ...layout.formats }

	if (change === null) {
		delete formats[key]
	} else {
		const next: { align?: ColumnAlign; decimals?: number } = { ...formats[key] }

		for (const name of ["align", "decimals"] as const) {
			if (!(name in change)) {
				continue
			}

			const value = change[name]

			if (value === undefined) {
				delete next[name]
			} else if (name === "align") {
				next.align = alignOf(value)
			} else {
				next.decimals = decimalsOf(value)
			}
		}

		if (Object.keys(next).length === 0) {
			delete formats[key]
		} else {
			formats[key] = next
		}
	}

	const rest: ColumnLayout = Object.fromEntries(Object.entries(layout).filter(([name]) => name !== "formats"))

	return freezeColumnLayout(Object.keys(formats).length === 0 ? rest : { ...rest, formats })
}

/**
 * A layout read from JSON, each problem reported under `path`: what a view, a draft and a template
 * keep. Undefined when there is none.
 */
export function readColumnLayout(
	input: unknown,
	path: string,
	problem: (path: string, message: string) => void
): ColumnLayout | undefined {
	if (input === undefined || input === null) {
		return undefined
	}

	const layout = plainObject(input)

	if (!layout) {
		problem(path, "must be an object.")

		return undefined
	}

	const result: {
		order?: readonly string[]
		hidden?: readonly string[]
		pinned?: readonly string[]
		formats?: Record<string, ColumnFormat>
	} = {}

	for (const name of ["order", "hidden", "pinned"] as const) {
		const value = layout[name]

		if (value === undefined) {
			continue
		}

		if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
			problem(`${path}.${name}`, "must be a list of field keys.")
		} else {
			result[name] = value as string[]
		}
	}

	if (layout.formats !== undefined && layout.formats !== null) {
		const formats = plainObject(layout.formats)

		if (!formats) {
			problem(`${path}.formats`, "must be an object of formats by field key.")
		} else {
			const read: Record<string, ColumnFormat> = {}

			for (const [key, value] of Object.entries(formats)) {
				const format = plainObject(value)
				const at = `${path}.formats.${key}`

				if (!format) {
					problem(at, 'must be an object such as { align: "center", decimals: 2 }.')
					continue
				}

				const next: { align?: ColumnAlign; decimals?: number } = {}

				if (format.align !== undefined) {
					if ((COLUMN_ALIGNS as readonly unknown[]).includes(format.align)) {
						next.align = format.align as ColumnAlign
					} else {
						problem(`${at}.align`, `must be one of ${COLUMN_ALIGNS.join(", ")}.`)
					}
				}

				if (format.decimals !== undefined) {
					if (isShownDecimals(format.decimals)) {
						next.decimals = format.decimals
					} else {
						problem(`${at}.decimals`, `must be a whole number from 0 to ${MAX_SHOWN_DECIMALS}.`)
					}
				}

				if (Object.keys(next).length > 0) {
					read[key] = next
				}
			}

			if (Object.keys(read).length > 0) {
				result.formats = read
			}
		}
	}

	return freezeColumnLayout(result)
}

/** A copy of the layout that cannot be changed, with nothing in it that it does not hold. */
export function freezeColumnLayout(layout: ColumnLayout): ColumnLayout {
	return Object.freeze({
		...(layout.order ? { order: Object.freeze([...layout.order]) } : {}),
		...(layout.hidden ? { hidden: Object.freeze([...layout.hidden]) } : {}),
		...(layout.pinned ? { pinned: Object.freeze([...layout.pinned]) } : {}),
		...(layout.formats && Object.keys(layout.formats).length > 0
			? {
					formats: Object.freeze(
						Object.fromEntries(
							Object.entries(layout.formats).map(([key, format]) => [key, Object.freeze({ ...format })])
						)
					)
				}
			: {})
	})
}

/** The layout with its keys passed through `key`: kept, renamed, or dropped where it gives null. */
export function mapColumnLayout(layout: ColumnLayout, key: (key: string) => string | null): ColumnLayout {
	const keys = (list: readonly string[]): string[] => list.map(key).filter((item): item is string => item !== null)
	const formats: Record<string, ColumnFormat> = {}

	for (const [from, format] of Object.entries(layout.formats ?? {})) {
		const to = key(from)

		if (to !== null) {
			formats[to] = format
		}
	}

	return freezeColumnLayout({
		...(layout.order ? { order: keys(layout.order) } : {}),
		...(layout.hidden ? { hidden: keys(layout.hidden) } : {}),
		...(layout.pinned ? { pinned: keys(layout.pinned) } : {}),
		...(Object.keys(formats).length > 0 ? { formats } : {})
	})
}

/** Whether two layouts draw their columns alike: the same formats on the same columns. */
export function sameColumnFormats(a: ColumnLayout, b: ColumnLayout): boolean {
	const left = a.formats ?? {}
	const right = b.formats ?? {}
	const keys = Object.keys(left)

	return (
		keys.length === Object.keys(right).length &&
		keys.every(key => left[key]?.align === right[key]?.align && left[key]?.decimals === right[key]?.decimals)
	)
}

function alignOf(value: unknown): ColumnAlign {
	if (!(COLUMN_ALIGNS as readonly unknown[]).includes(value)) {
		throw new TabulaError("invalid_argument", `A column aligns ${COLUMN_ALIGNS.join(", ")}; got ${String(value)}.`)
	}

	return value as ColumnAlign
}

function decimalsOf(value: unknown): number {
	if (!isShownDecimals(value)) {
		throw new TabulaError(
			"invalid_argument",
			`A column shows 0 to ${MAX_SHOWN_DECIMALS} digits after the point; got ${String(value)}.`
		)
	}

	return value
}

function isShownDecimals(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SHOWN_DECIMALS
}

function plainObject(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}
