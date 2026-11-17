<script setup lang="ts">
import { version } from "@nouxwell/tabula-core"
import { TabulaWorkspace } from "@nouxwell/tabula-vue"
</script>

<template>
	<main>
		<h1>Tabula Grid playground</h1>
		<p>Core version {{ version }}. The workspace below is an empty shell.</p>
		<TabulaWorkspace>
			<p>Nothing to show yet.</p>
		</TabulaWorkspace>
	</main>
</template>
