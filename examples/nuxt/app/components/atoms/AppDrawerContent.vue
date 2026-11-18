<template>
	<n-drawer-content closable>
		<template v-if="$slots.header" #header><slot name="header" /></template>
		<slot />
		<template v-if="$slots.footer" #footer><slot name="footer" /></template>
	</n-drawer-content>
</template>

<script setup lang="ts">
/**
 * What goes in an `AppDrawer`: a header with a close button, a body that scrolls on its own and a
 * footer that stays. `title` and Naive UI's other props pass through. As the CRM's.
 */
import { NDrawerContent, type DrawerContentProps } from "naive-ui"

interface AppDrawerContentProps extends /* @vue-ignore */ DrawerContentProps {}

defineProps<AppDrawerContentProps>()
</script>
