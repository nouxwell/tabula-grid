<template>
	<!-- The page fills the window: the provider's own element passes the height on. -->
	<n-config-provider
		class="h-full"
		:theme="theme"
		:theme-overrides="overrides"
		:locale="trTR"
		:date-locale="dateTrTR"
		inline-theme-disabled
	>
		<n-message-provider placement="top-right">
			<slot />
		</n-message-provider>
		<n-global-style />
	</n-config-provider>
</template>

<script setup lang="ts">
import { darkTheme, dateTrTR, NConfigProvider, NGlobalStyle, NMessageProvider, trTR } from "naive-ui"
import { naiveOverrides } from "~/theme/palette"

const mode = useColorMode()
const theme = computed(() => (mode.value === "dark" ? darkTheme : null))
const overrides = computed(() => naiveOverrides(mode.value))
</script>
