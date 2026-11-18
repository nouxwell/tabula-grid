import type { ColorMode } from "~/theme/palette"

/**
 * Light or dark, kept in a cookie so the server draws the page in the mode the user chose: a page
 * that arrives light and turns dark a moment later flashes.
 */
export function useColorMode() {
	return useCookie<ColorMode>("color-mode", {
		default: () => "light",
		sameSite: "lax",
		maxAge: 60 * 60 * 24 * 365
	})
}
