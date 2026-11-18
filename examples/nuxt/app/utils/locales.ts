import type { DropdownOption } from "naive-ui"
import AppFlag from "~/components/atoms/AppFlag.vue"

/** The languages the sheet speaks: its words, and how it reads and writes numbers and dates. */
export type Locale = "tr" | "en"

export const LOCALES: readonly { readonly label: string; readonly value: Locale }[] = [
	{ label: "Türkçe", value: "tr" },
	{ label: "English", value: "en" }
]

/** The languages as a menu's options, each with its flag, for a phone's ⋯ menu. */
export function localeMenu(): DropdownOption[] {
	return LOCALES.map(({ label, value }) => ({ label, key: value, icon: () => h(AppFlag, { code: value, size: 16 }) }))
}
