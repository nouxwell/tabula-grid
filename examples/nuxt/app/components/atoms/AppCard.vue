<template>
	<n-card size="small" :segmented="{ content: true }" header-class="py-3!">
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-card>
</template>

<script setup lang="ts">
/**
 * Every card in the application, as the CRM's: small, its header set apart from its content, on the
 * palette's surface colour. A card that holds a sheet or a list edge to edge takes
 * `content-class="p-0!"`. Naive UI's props and slots pass through.
 */
import { NCard, type CardProps } from "naive-ui"

interface AppCardProps extends /* @vue-ignore */ CardProps {}

defineProps<AppCardProps>()
</script>
