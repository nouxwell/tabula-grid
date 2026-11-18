<template>
	<n-button size="small" :loading="loading || busy" @click="click">
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
 * Every button in the application. Naive UI's props pass through (`type`, `secondary`,
 * `disabled`…); what all buttons share, such as their size, is decided here once.
 *
 * A click whose handler returns a promise spins the button until it settles, as the CRM's buttons
 * do: saving, checking, sending. Nothing else on the page is covered, and a second click while it
 * spins does nothing, so an action is never sent twice. `loading` still spins it from outside, for
 * work started elsewhere.
 *
 * `icon` names an `AppIcon`; when it changes, such as a theme switch's sun and moon, the new one
 * turns in.
 */
import { NButton, type ButtonProps } from "naive-ui"
import type { IconName } from "./AppIcon.vue"

interface AppButtonProps extends /* @vue-ignore */ ButtonProps {
	icon?: IconName
	iconSize?: number
	loading?: boolean
	/** One handler, or several where a dropdown or a tooltip adds its own to the page's. */
	onClick?: ClickHandler | ClickHandler[]
}

type ClickHandler = (event: MouseEvent) => unknown

const props = withDefaults(defineProps<AppButtonProps>(), {
	icon: undefined,
	iconSize: 18,
	loading: false,
	onClick: undefined
})
const slots = useSlots()
const passed = computed(() => Object.keys(slots).filter(name => !(props.icon && name === "icon")))
const busy = ref(false)

async function click(event: MouseEvent): Promise<void> {
	if (busy.value || props.loading) {
		return
	}

	const handlers = Array.isArray(props.onClick) ? props.onClick : props.onClick ? [props.onClick] : []
	const waiting = handlers.map(handler => handler(event)).filter(result => result instanceof Promise)

	if (waiting.length > 0) {
		busy.value = true

		try {
			await Promise.allSettled(waiting)
		} finally {
			busy.value = false
		}
	}
}
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
