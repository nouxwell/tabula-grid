<template>
	<n-switch size="small">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-switch>
</template>

<script setup lang="ts">
/** Every switch in the application, bound with `v-model:value`. Naive UI's props pass through. */
import { NSwitch, type SwitchProps } from "naive-ui"

interface AppSwitchProps extends /* @vue-ignore */ SwitchProps {}

defineProps<AppSwitchProps>()
</script>
