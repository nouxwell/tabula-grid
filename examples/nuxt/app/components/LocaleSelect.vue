<template>
	<AppSelect
		v-model:value="locale"
		:options="options"
		:render-label="renderLabel"
		:consistent-menu-width="false"
		aria-label="Dil"
	/>
</template>

<script setup lang="ts">
/** The language, each with its flag, as the CRM's language select shows them. */
import type { SelectOption } from "naive-ui"
import type { VNodeChild } from "vue"
import AppFlag from "~/components/atoms/AppFlag.vue"
import { LOCALES, type Locale } from "~/utils/locales"

const locale = defineModel<Locale>({ required: true })
const options: SelectOption[] = LOCALES.map(({ label, value }) => ({ label, value }))

function renderLabel(option: SelectOption): VNodeChild {
	return h("span", { class: "inline-flex items-center gap-2" }, [
		h(AppFlag, { code: option.value as Locale, size: 16 }),
		String(option.label)
	])
}
</script>
