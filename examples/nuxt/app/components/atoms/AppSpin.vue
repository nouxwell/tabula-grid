<template>
	<!--
		The slots are passed on only when the caller gave one, as the CRM's AppSpin does. Naive UI
		branches on their mere presence: an icon slot, even an empty one, replaces the spinner itself,
		and a default slot turns it into an overlay around its content. Passed on always, they drew
		nothing.
	-->
	<n-spin size="small">
		<template v-if="$slots.description" #description><slot name="description" /></template>
		<template v-if="$slots.default" #default><slot /></template>
	</n-spin>
</template>

<script setup lang="ts">
/** Every spinner in the application: a part of the page waiting for its data. */
import { NSpin, type SpinProps } from "naive-ui"

interface AppSpinProps extends /* @vue-ignore */ SpinProps {}

defineProps<AppSpinProps>()
</script>
