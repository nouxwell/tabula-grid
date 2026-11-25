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
	rules: [
		"M4 6h10",
		"M18 6h2",
		"M16 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
		"M4 18h4",
		"M12 18h8",
		"M10 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
		"M4 12h2",
		"M10 12h10",
		"M8 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
	],
	edit: ["M4 20h4L19 9l-4-4L4 16Z"],
	trash: ["M5 7h14", "M10 7V4h4v3", "M7 7l1 13h8l1-13"],
	plus: ["M12 5v14", "M5 12h14"],
	percent: [
		"M19 5 5 19",
		"M7 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
		"M17 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
	],
	round: ["M4 18h16", "M7 14a5 5 0 0 1 10 0", "M12 4v3"],
	search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m20 20-4-4"],
	close: ["M6 6l12 12", "M18 6 6 18"],
	file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z", "M14 3v5h5"],
	alert: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 8v5", "M12 16h.01"],
	chevronRight: ["m9 6 6 6-6 6"],
	chevronUp: ["m6 15 6-6 6 6"],
	minus: ["M7 12h10"],
	globe: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M3 12h18", "M12 3a14 14 0 0 1 0 18", "M12 3a14 14 0 0 0 0 18"],
	sliders: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
	alignLeft: ["M4 6h16", "M4 12h10", "M4 18h14"],
	alignCenter: ["M4 6h16", "M7 12h10", "M5 18h14"],
	alignRight: ["M4 6h16", "M10 12h10", "M6 18h14"],
	bucket: ["m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11Z", "m5 2 5 5", "M2 13h15"],
	eraser: [
		"m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21",
		"M22 21H7",
		"m5 11 9 9"
	],
	keyboard: [
		"M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
		"M7 10h.01",
		"M11 10h.01",
		"M15 10h.01",
		"M7 14h10"
	],
	format: ["M4 7V5h16v2", "M9 19h6", "M12 5v14"],
	refresh: ["M20 11a8 8 0 0 0-14.9-3.5L4 9", "M4 4v5h5", "M4 13a8 8 0 0 0 14.9 3.5L20 15", "M20 20v-5h-5"],
	table: [
		"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
		"M3 9h18",
		"M9 9v11",
		"M15 13v4",
		"M13 15h4"
	]
} as const

export type IconName = keyof typeof ICONS

withDefaults(defineProps<{ name: IconName; size?: number; label?: string }>(), { size: 18, label: undefined })
</script>

<style scoped>
.app-icon {
	flex: none;
}
</style>
