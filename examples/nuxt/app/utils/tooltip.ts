/**
 * The width cap of a tooltip holding a sentence or more, with `AppFitText` inside: it keeps the box
 * from stretching across a desktop page. As the CRM's `FIT_TOOLTIP_STYLE`.
 */
export const FIT_TOOLTIP_STYLE = { width: "max-content", maxWidth: "min(320px, calc(100vw - 32px))" } as const
