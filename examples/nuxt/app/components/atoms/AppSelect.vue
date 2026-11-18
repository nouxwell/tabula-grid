<template>
	<n-select size="small">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-select>
</template>

<script setup lang="ts">
/** Every select in the application, bound with `v-model:value`. Naive UI's props pass through. */
import { NSelect, type SelectProps } from "naive-ui"

interface AppSelectProps extends /* @vue-ignore */ SelectProps {}

defineProps<AppSelectProps>()
</script>
