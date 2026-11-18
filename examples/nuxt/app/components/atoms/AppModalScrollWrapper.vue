<template>
	<!--
		The scrollbar lies over the content's right edge, so it would sit on the fields. The scroller
		reaches GUTTER into the card's right padding and gives the content the same padding back: the
		fields keep their width, and the bar runs in the padding. As the CRM's.
	-->
	<n-scrollbar :style="scrollStyle" :content-style="{ paddingRight: GUTTER }">
		<slot />
	</n-scrollbar>
</template>

<script setup lang="ts">
import { NScrollbar } from "naive-ui"

const props = withDefaults(defineProps<{ maxHeight?: string | number }>(), { maxHeight: "calc(100vh - 220px)" })

const GUTTER = "12px"

const scrollStyle = computed(() => ({
	maxHeight: typeof props.maxHeight === "number" ? `${props.maxHeight}px` : props.maxHeight,
	marginRight: `-${GUTTER}`,
	width: `calc(100% + ${GUTTER})`
}))
</script>
