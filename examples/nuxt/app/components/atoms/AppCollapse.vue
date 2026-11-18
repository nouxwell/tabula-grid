<template>
	<n-collapse arrow-placement="left">
		<slot />
	</n-collapse>
</template>

<script setup lang="ts">
/** Every collapse in the application, holding `AppCollapseItem`s. Naive UI's props pass through. */
import { NCollapse, type CollapseProps } from "naive-ui"

interface AppCollapseProps extends /* @vue-ignore */ CollapseProps {}

defineProps<AppCollapseProps>()
</script>
