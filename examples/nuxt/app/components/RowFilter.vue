<template>
	<div
		class="inline-flex h-[30px] flex-none items-center gap-0.5 rounded-lg bg-surface-alt p-0.5 text-[13px] ring-1 ring-divider ring-inset"
		role="group"
		aria-label="Gösterilen satırlar"
	>
		<button
			type="button"
			:class="[BASE, onlyChanged || onlyMarked ? IDLE : ON]"
			:aria-pressed="!onlyChanged && !onlyMarked"
			@click="emit('all')"
		>
			Tümü
			<span v-if="!compact" class="hidden text-xs font-normal text-muted tabular-nums 2xl:inline">
				<AppNumberAnimation :to="all" locale="tr-TR" />
			</span>
		</button>
		<button
			type="button"
			:class="[BASE, onlyChanged ? ON : IDLE]"
			:aria-pressed="onlyChanged"
			:title="onlyChanged ? 'Yeniden basınca süzgeç tablonun şimdiki hâline uygulanır' : undefined"
			@click="emit('changed')"
		>
			Değişenler
			<span class="text-xs font-normal text-muted tabular-nums">
				<AppNumberAnimation :to="changed" locale="tr-TR" />
			</span>
		</button>
		<Transition name="grow">
			<button
				v-if="marked > 0 || onlyMarked"
				type="button"
				:class="[BASE, onlyMarked ? ON : IDLE]"
				:aria-pressed="onlyMarked"
				title="Elle renklendirilmiş hücresi olan satırlar"
				@click="emit('marked')"
			>
				Renkli
				<span class="text-xs font-normal text-muted tabular-nums">
					<AppNumberAnimation :to="marked" locale="tr-TR" />
				</span>
			</button>
		</Transition>
	</div>
</template>

<script setup lang="ts">
/**
 * Which rows the sheet shows: all, the ones changed since loading, or the ones with a colour put on
 * by hand, each with its count. One segmented control, as on the desktop's toolbar and a phone's.
 */
withDefaults(
	defineProps<{
		all: number
		changed: number
		marked: number
		onlyChanged: boolean
		onlyMarked: boolean
		/** A phone's: "Tümü" without its count, to fit the row; a desktop shows it from 1536px. */
		compact?: boolean
	}>(),
	{ compact: false }
)

const emit = defineEmits<{ all: []; changed: []; marked: [] }>()

const BASE =
	"flex h-[26px] items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none"
const ON = "bg-surface font-semibold text-text shadow-sm"
const IDLE = "text-muted hover:text-text"
</script>
