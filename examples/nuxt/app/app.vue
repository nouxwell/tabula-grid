<template>
	<AppProvider>
		<NuxtPage />
	</AppProvider>
</template>

<script setup lang="ts">
import { paletteCss } from "~/theme/palette"

const mode = useColorMode()

// Rendered on the server with the page: the palette's variables and the dark class are there
// before anything runs in the browser.
useHead({
	htmlAttrs: { class: computed(() => (mode.value === "dark" ? "dark" : "")) },
	style: [{ key: "palette", textContent: computed(() => paletteCss(mode.value)) }]
})
</script>
