<template>
	<svg
		class="flex-none"
		:width="size"
		:height="size"
		viewBox="0 0 24 24"
		:role="label ? 'img' : undefined"
		:aria-label="label"
		:aria-hidden="label ? undefined : 'true'"
	>
		<defs>
			<clipPath :id="clip"><circle cx="12" cy="12" r="12" /></clipPath>
		</defs>
		<g :clip-path="`url(#${clip})`">
			<template v-if="code === 'tr'">
				<rect width="24" height="24" fill="#e30a17" />
				<circle cx="9.6" cy="12" r="5.6" fill="#ffffff" />
				<circle cx="11" cy="12" r="4.5" fill="#e30a17" />
				<polygon
					fill="#ffffff"
					points="14.1,12 15.83,11.44 15.83,9.62 16.9,11.09 18.62,10.53 17.56,12 18.62,13.47 16.9,12.91 15.83,14.38 15.83,12.56"
				/>
			</template>
			<template v-else>
				<rect width="24" height="24" fill="#012169" />
				<path d="M0 0 24 24M24 0 0 24" stroke="#ffffff" stroke-width="4.8" />
				<path d="M0 0 24 24M24 0 0 24" stroke="#c8102e" stroke-width="1.6" />
				<path d="M12 0v24M0 12h24" stroke="#ffffff" stroke-width="6" />
				<path d="M12 0v24M0 12h24" stroke="#c8102e" stroke-width="3.6" />
			</template>
		</g>
	</svg>
</template>

<script setup lang="ts">
/**
 * A language's flag in a circle, as the CRM shows them by its language select. Drawn here rather
 * than fetched, so it is there with the page, on the server too. A flag's colours are the flag's,
 * not the palette's.
 */
withDefaults(defineProps<{ code: "tr" | "en"; size?: number; label?: string }>(), { size: 18, label: undefined })

const clip = `flag-${useId().replace(/[^\w-]/g, "")}`
</script>
