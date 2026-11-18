<template>
	<n-number-animation :active="true" :duration="300" show-separator />
</template>

<script setup lang="ts">
/**
 * Every number that counts up or down to its new value, such as a count of rows: 300ms, with the
 * thousands separated in the `locale` given. As the CRM's.
 */
import { NNumberAnimation, type NumberAnimationProps } from "naive-ui"

interface AppNumberAnimationProps extends /* @vue-ignore */ NumberAnimationProps {}

defineProps<AppNumberAnimationProps>()
</script>
