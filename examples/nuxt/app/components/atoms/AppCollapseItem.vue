<template>
	<n-collapse-item>
		<template v-for="(_, name) in $slots" #[name]="scope">
			<slot :name="name" v-bind="scope || {}" />
		</template>
	</n-collapse-item>
</template>

<script setup lang="ts">
/** One part of an `AppCollapse`: `title` and `name`, as Naive UI's, pass through. */
import { NCollapseItem, type CollapseItemProps } from "naive-ui"

interface AppCollapseItemProps extends /* @vue-ignore */ CollapseItemProps {}

defineProps<AppCollapseItemProps>()
</script>
