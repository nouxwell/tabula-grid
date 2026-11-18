<template>
	<n-scrollbar>
		<slot />
	</n-scrollbar>
</template>

<script setup lang="ts">
/**
 * Every scroll area of the application's own, as the CRM's: Naive UI hides the browser's bar and
 * draws a thin one that turns the pointer into a hand and can be dragged. Naive UI's props pass
 * through: `x-scrollable`, `content-class`, `trigger`…
 */
import { NScrollbar, type ScrollbarProps } from "naive-ui"

interface AppScrollbarProps extends /* @vue-ignore */ ScrollbarProps {}

defineProps<AppScrollbarProps>()
</script>
