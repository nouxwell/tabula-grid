import type { GlobalThemeOverrides } from "naive-ui"

/**
 * The example's palette: neutral greys for the page and the sheet, one green for the main action,
 * the selection and the open tab, one red for errors, a dark orange for warnings; the dark theme in
 * layered greys. It is the one place the colours are written: Naive UI's theme, the CSS variables
 * Tailwind's colours read, and Tabula Grid's own colours are all made from it, so changing one
 * value here changes all three. Every colour that carries words reads at 4.5:1 or more.
 */
export type ColorMode = "light" | "dark"

export interface Palette {
	/** The page behind the cards. */
	readonly body: string
	/** Cards, the grid's cells, menus. */
	readonly surface: string
	/** Headers and read-only cells: a step away from the surface. */
	readonly surfaceAlt: string
	readonly text: string
	readonly muted: string
	readonly primary: string
	/**
	 * The primary colour where it carries text: buttons and links. A green that fills well reads under
	 * the 4.5:1 text needs on white, so light mode takes a darker step of it. Borders, the
	 * selection and fills keep `primary`.
	 */
	readonly primaryText: string
	/** The words on a primary button. */
	readonly onPrimary: string
	readonly info: string
	readonly success: string
	readonly warning: string
	/** The warning colour where it carries words: a step towards the text colour, to read at 4.5:1. */
	readonly warningText: string
	readonly error: string
	readonly divider: string
	readonly hover: string
	/** The scroll bars' thumb, and under the pointer: the text colour at 20% and 30%. */
	readonly scrollbar: string
	readonly scrollbarHover: string
}

export const PALETTE: Readonly<Record<ColorMode, Palette>> = {
	light: {
		body: "#f4f5f7",
		surface: "#ffffff",
		surfaceAlt: "#f9fafb",
		text: "#101318",
		muted: "#5b6573",
		primary: "#00a06c",
		primaryText: "#007a54",
		onPrimary: "#ffffff",
		info: "#3b6fd8",
		success: "#00a06c",
		warning: "#d98a00",
		warningText: "#8a5a00",
		error: "#c4183c",
		divider: "#dde1e6",
		hover: "rgba(16, 19, 24, 0.05)",
		scrollbar: "rgba(16, 19, 24, 0.2)",
		scrollbarHover: "rgba(16, 19, 24, 0.3)"
	},
	dark: {
		body: "#0e1013",
		surface: "#16191e",
		surfaceAlt: "#1a1e24",
		text: "#e7e9ec",
		muted: "#9aa3af",
		primary: "#22b57f",
		primaryText: "#3fcf95",
		onPrimary: "#04140d",
		info: "#6ea0ff",
		success: "#22b57f",
		warning: "#f0b44c",
		warningText: "#f0b44c",
		error: "#ff6b81",
		divider: "#2e333b",
		hover: "rgba(231, 233, 236, 0.06)",
		scrollbar: "rgba(231, 233, 236, 0.2)",
		scrollbarHover: "rgba(231, 233, 236, 0.3)"
	}
}

export const FONT_FAMILY =
	"'Helvetica Neue', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"

/**
 * The palette as CSS variables: `--app-*` for Tailwind's colours (main.css), and the grid's own
 * `--tabula-*` colours, set over the grid's defaults for whichever theme it draws in.
 */
export function paletteCss(mode: ColorMode): string {
	const colors = PALETTE[mode]
	const app = Object.entries(colors)
		.map(([name, value]) => `--app-${kebab(name)}: ${value};`)
		.join(" ")
	const grid = [
		`--tabula-accent: ${colors.primary};`,
		`--tabula-accent-text: ${colors.primaryText};`,
		`--tabula-bg: ${colors.surface};`,
		`--tabula-bg-alt: ${colors.surfaceAlt};`,
		`--tabula-fg: ${colors.text};`,
		`--tabula-muted: ${colors.muted};`,
		`--tabula-error: ${colors.error};`,
		`--tabula-warning: ${colors.warning};`,
		`--tabula-success: ${colors.success};`,
		`--tabula-scrollbar: ${colors.scrollbar};`,
		`--tabula-scrollbar-hover: ${colors.scrollbarHover};`
	].join(" ")

	// The grid sets its colours on .tabula-theme[data-tabula-theme]; this is one step more specific.
	return `:root { ${app} } html .tabula-theme[data-tabula-theme] { ${grid} }`
}

/** Naive UI's theme from the palette: its colours, the CRM's corners and type. */
export function naiveOverrides(mode: ColorMode): GlobalThemeOverrides {
	const colors = PALETTE[mode]

	return {
		common: {
			// Naive UI writes buttons and links in its primary colour: the step that reads as text.
			primaryColor: colors.primaryText,
			primaryColorHover: mix(colors.primaryText, "#ffffff", 0.15),
			primaryColorPressed: mix(colors.primaryText, "#000000", 0.1),
			primaryColorSuppl: mix(colors.primaryText, "#ffffff", 0.15),
			infoColor: colors.info,
			infoColorHover: mix(colors.info, "#ffffff", 0.15),
			infoColorPressed: mix(colors.info, "#000000", 0.1),
			successColor: colors.success,
			successColorHover: mix(colors.success, "#ffffff", 0.15),
			successColorPressed: mix(colors.success, "#000000", 0.1),
			warningColor: colors.warning,
			warningColorHover: mix(colors.warning, "#ffffff", 0.15),
			warningColorPressed: mix(colors.warning, "#000000", 0.1),
			errorColor: colors.error,
			errorColorHover: mix(colors.error, "#ffffff", 0.15),
			errorColorPressed: mix(colors.error, "#000000", 0.1),
			bodyColor: colors.body,
			cardColor: colors.surface,
			modalColor: colors.surface,
			popoverColor: colors.surface,
			textColorBase: colors.text,
			textColor1: colors.text,
			textColor2: colors.text,
			textColor3: colors.muted,
			dividerColor: colors.divider,
			borderColor: colors.divider,
			hoverColor: colors.hover,
			// Scroll bars as the grid's: 5px, the text colour at 20%.
			scrollbarColor: colors.scrollbar,
			scrollbarColorHover: colors.scrollbarHover,
			scrollbarWidth: "5px",
			scrollbarHeight: "5px",
			scrollbarBorderRadius: "5px",
			borderRadius: "6px",
			borderRadiusSmall: "3px",
			fontFamily: FONT_FAMILY,
			fontSize: "15px",
			lineHeight: "1.35"
		},
		Button: {
			textColorPrimary: colors.onPrimary,
			textColorHoverPrimary: colors.onPrimary,
			textColorPressedPrimary: colors.onPrimary,
			textColorFocusPrimary: colors.onPrimary,
			textColorDisabledPrimary: colors.onPrimary
		}
	}
}

function kebab(name: string): string {
	return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

/** Two #rrggbb colours mixed, `amount` of the second: for the hover and pressed shades Naive UI asks for. */
function mix(color: string, other: string, amount: number): string {
	const channels = (hex: string): number[] => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16))
	const [a, b] = [channels(color), channels(other)]

	return `#${a
		.map((value, index) => Math.round(value * (1 - amount) + (b[index] ?? 0) * amount))
		.map(value => value.toString(16).padStart(2, "0"))
		.join("")}`
}
