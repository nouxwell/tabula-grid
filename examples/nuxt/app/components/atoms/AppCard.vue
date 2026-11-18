<template>
	<n-card size="small" :bordered="false">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-card>
</template>

<script setup lang="ts">
/** Every card in the application, on the palette's surface colour. Naive UI's props pass through. */
import { NCard, type CardProps } from "naive-ui"

interface AppCardProps extends /* @vue-ignore */ CardProps {}

defineProps<AppCardProps>()
</script>
