<template>
	<n-drawer :width="width" placement="right">
		<slot />
	</n-drawer>
</template>

<script setup lang="ts">
/**
 * Every drawer in the application, opened with `v-model:show`, holding an `AppDrawerContent`. As
 * wide as it asks to be and no wider than the screen; the screen is measured in the browser only,
 * as the server has none.
 */
import { NDrawer, type DrawerProps } from "naive-ui"

interface AppDrawerProps extends /* @vue-ignore */ DrawerProps {
	widthResponsive?: number
}

const props = withDefaults(defineProps<AppDrawerProps>(), { widthResponsive: 420 })

const screen = ref<number | null>(null)
const width = computed(() => Math.min(props.widthResponsive, screen.value ?? props.widthResponsive))

function measure(): void {
	screen.value = window.innerWidth
}

onMounted(() => {
	measure()
	window.addEventListener("resize", measure, { passive: true })
})

onBeforeUnmount(() => window.removeEventListener("resize", measure))
</script>
