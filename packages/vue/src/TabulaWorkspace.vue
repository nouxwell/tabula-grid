<script setup lang="ts">
import { version } from "@nouxwell/tabula-core"
</script>

<template>
	<div class="tabula-workspace" :data-tabula-version="version">
		<slot />
	</div>
</template>

<style>
.tabula-workspace {
	--tabula-color-surface: #ffffff;
	--tabula-color-text: #161922;
	--tabula-color-line: #d6dae4;

	box-sizing: border-box;
	border: 1px solid var(--tabula-color-line);
	background: var(--tabula-color-surface);
	color: var(--tabula-color-text);
}
</style>
