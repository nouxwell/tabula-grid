<template>
	<n-number-animation :active="true" :duration="300" show-separator :from="start" :to="to" />
</template>

<script setup lang="ts">
/**
 * Every number that counts up or down to its new value, such as a count of rows: 300ms, with the
 * thousands separated in the `locale` given, as the CRM's. It counts from `from` when it first
 * shows, and afterwards from the value it showed last, never from 0 again.
 */
import { NNumberAnimation, type NumberAnimationProps } from "naive-ui"

interface AppNumberAnimationProps extends /* @vue-ignore */ Omit<NumberAnimationProps, "from" | "to"> {
	to: number
	from?: number
}

const props = defineProps<AppNumberAnimationProps>()

const start = ref(props.from ?? props.to)

watch(
	() => props.to,
	(_now, before) => {
		start.value = before
	}
)
</script>
