/** Measures text in pixels, drawn the way it would be drawn inside a given element. */
export type Measure = (text: string) => number

/**
 * A measurer using the element's own font, through a canvas rather than the layout.
 *
 * Measuring 60 headers or 5,000 cells by putting each into the page and reading its width forces a
 * layout per text. A canvas measures without touching the page.
 */
export function textMeasurer(element: Element): Measure {
	const style = getComputedStyle(element)
	const context = document.createElement("canvas").getContext("2d")

	if (!context) {
		const size = Number.parseFloat(style.fontSize) || 13

		return text => text.length * size * 0.6
	}

	// Put together from its parts: the computed `font` shorthand is empty in some browsers.
	context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`

	return text => context.measureText(text).width
}

/** The element's left and right padding together, in pixels. */
export function horizontalPadding(element: Element): number {
	const style = getComputedStyle(element)

	return (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
}
