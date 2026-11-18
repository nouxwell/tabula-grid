<template>
	<n-button size="small">
		<template v-if="icon" #icon>
			<Transition name="icon-swap" mode="out-in">
				<AppIcon :key="icon" :name="icon" :size="iconSize" />
			</Transition>
		</template>
		<template v-for="name in passed" :key="name" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-button>
</template>

<script setup lang="ts">
/**
 * Every button in the application. Naive UI's props pass through (`type`, `secondary`, `loading`,
 * `disabled`…); what all buttons share, such as their size, is decided here once. `icon` names an
 * `AppIcon`; when it changes, such as a theme switch's sun and moon, the new one turns in. As the
 * CRM's.
 */
import { NButton, type ButtonProps } from "naive-ui"
import type { IconName } from "./AppIcon.vue"

interface AppButtonProps extends /* @vue-ignore */ ButtonProps {
	icon?: IconName
	iconSize?: number
}

const props = withDefaults(defineProps<AppButtonProps>(), { icon: undefined, iconSize: 18 })
const slots = useSlots()
const passed = computed(() => Object.keys(slots).filter(name => !(props.icon && name === "icon")))
</script>

<style scoped>
.icon-swap-enter-active,
.icon-swap-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.icon-swap-enter-from {
	opacity: 0;
	transform: scale(0.6) rotate(-90deg);
}

.icon-swap-leave-to {
	opacity: 0;
	transform: scale(0.6) rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
	.icon-swap-enter-active,
	.icon-swap-leave-active {
		transition: none;
	}
}
</style>
