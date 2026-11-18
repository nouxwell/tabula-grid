<template>
	<svg
		class="app-icon"
		:width="size"
		:height="size"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		:aria-hidden="label ? undefined : 'true'"
		:role="label ? 'img' : undefined"
		:aria-label="label"
	>
		<path v-for="(d, index) in ICONS[name]" :key="index" :d="d" />
	</svg>
</template>

<script setup lang="ts">
/**
 * Every icon in the application, by name: one stroke style, one size scale. A name the set does not
 * have is a type error, not a blank square.
 */
const ICONS = {
	undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
	redo: ["m15 14 5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
	upload: ["M12 15V3", "m7 8 5-5 5 5", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
	download: ["M12 3v12", "m7 10 5 5 5-5", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
	columns: ["M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M9 4v16", "M15 4v16"],
	chevronDown: ["m6 9 6 6 6-6"],
	sun: [
		"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
		"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
	],
	moon: ["M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"],
	more: [
		"M5 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z",
		"M12 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z",
		"M19 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
	],
	save: ["M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M7 3v5h8V3", "M7 21v-7h10v7"],
	check: ["M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z", "m9 12 2 2 4-4"],
	saved: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "m8 12 3 3 5-6"],
	play: ["M7 4v16l13-8Z"],
	views: ["m12 3 9 4.5-9 4.5-9-4.5Z", "m3 12 9 4.5 9-4.5", "m3 16.5 9 4.5 9-4.5"],
	tick: ["m5 12.5 4.5 4.5L19 7.5"],
	template: ["M6 3h9l4 4v14H6Z", "M15 3v4h4", "M9 12h7", "M9 16h7"],
	refresh: ["M20 11a8 8 0 0 0-14.9-3.5L4 9", "M4 4v5h5", "M4 13a8 8 0 0 0 14.9 3.5L20 15", "M20 20v-5h-5"]
} as const

export type IconName = keyof typeof ICONS

withDefaults(defineProps<{ name: IconName; size?: number; label?: string }>(), { size: 18, label: undefined })
</script>

<style scoped>
.app-icon {
	flex: none;
}
</style>
