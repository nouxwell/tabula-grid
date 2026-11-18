<template>
	<span ref="textRef" class="inline-block max-w-full align-top">{{ text }}</span>
</template>

<script setup lang="ts">
/**
 * Long text in a tooltip, its box shrunk to its widest wrapped line: without it, a wrapped sentence
 * keeps the full width of the box and leaves a blank strip on the right. As the CRM's.
 */
const props = defineProps<{ text: string }>()

const textRef = ref<HTMLElement | null>(null)

function fit(): void {
	const element = textRef.value

	if (!element) {
		return
	}

	element.style.width = ""

	const layoutWidth = element.offsetWidth

	if (!layoutWidth) {
		return
	}

	const range = document.createRange()

	range.selectNodeContents(element)

	const lines = Array.from(range.getClientRects())

	if (lines.length < 2) {
		return
	}

	const scale = element.getBoundingClientRect().width / layoutWidth || 1
	const widest = Math.max(...lines.map(line => line.width)) / scale

	element.style.width = `${Math.ceil(widest) + 1}px`
}

onMounted(fit)
watch(
	() => props.text,
	() => nextTick(fit)
)
</script>
