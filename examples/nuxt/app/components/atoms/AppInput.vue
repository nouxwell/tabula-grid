<template>
	<n-input>
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-input>
</template>

<script setup lang="ts">
/**
 * Every text field in the application. Naive UI's props pass through: `v-model:value`, `maxlength`,
 * `placeholder`, `status` for a field whose value is refused…
 */
import { NInput, type InputProps } from "naive-ui"

interface AppInputProps extends /* @vue-ignore */ InputProps {}

defineProps<AppInputProps>()
</script>
