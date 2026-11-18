<template>
	<n-dropdown trigger="click" size="medium" :show-arrow="false">
		<slot />
	</n-dropdown>
</template>

<script setup lang="ts">
/**
 * Every menu that drops from a button in the application: `options` and `@select` as Naive UI's.
 * Opened by a click, so it works the same with a mouse, a finger and the keyboard.
 */
import { NDropdown, type DropdownProps } from "naive-ui"

interface AppDropdownProps extends /* @vue-ignore */ DropdownProps {}

defineProps<AppDropdownProps>()
</script>
