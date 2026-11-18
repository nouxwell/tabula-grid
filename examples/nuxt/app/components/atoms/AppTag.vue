<template>
	<n-tag size="small" :bordered="false" round>
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-tag>
</template>

<script setup lang="ts">
/** Every small label in the application, such as a page's "Taslak". Naive UI's props pass through. */
import { NTag, type TagProps } from "naive-ui"

interface AppTagProps extends /* @vue-ignore */ TagProps {}

defineProps<AppTagProps>()
</script>
