<template>
	<n-modal preset="card" :style="style" :segmented="{ content: true, footer: true }">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-modal>
</template>

<script setup lang="ts">
/**
 * Every modal in the application, in the one shape the CRM allows: a card that never runs off the
 * screen, `width` wide at most, centred, its header and footer fixed. Its body goes in an
 * `AppModalScrollWrapper`, so long content scrolls inside it. `v-model:show` and Naive UI's other
 * props pass through.
 */
import { NModal, type ModalProps } from "naive-ui"

interface AppModalProps extends /* @vue-ignore */ ModalProps {
	/** The widest the card gets, as a CSS length; never wider than the screen less 32px. */
	width?: string
}

const props = withDefaults(defineProps<AppModalProps>(), { width: "680px" })

const style = computed(() => ({
	width: `min(${props.width}, calc(100vw - 32px))`,
	maxWidth: "calc(100vw - 32px)",
	maxHeight: "calc(100vh - 48px)",
	margin: "0 auto"
}))
</script>
