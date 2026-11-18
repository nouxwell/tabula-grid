<template>
	<form
		class="flex flex-col gap-3 rounded-app border border-primary bg-surface p-3.5 shadow-[0_0_0_3px_rgba(0,178,123,0.12)]"
		@submit.prevent="save"
	>
		<div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_90px] gap-2.5">
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Başlık</span>
				<AppInput v-model:value="draft.label" size="small" />
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Tür</span>
				<AppSelect v-model:value="draft.type" :options="COLUMN_TYPES as never" />
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Ondalık</span>
				<AppInput v-model:value="draft.decimals" size="small" :disabled="!takesDecimals(draft.type)" />
			</label>
		</div>

		<div class="flex flex-col gap-1">
			<label :for="formulaId" class="text-xs font-semibold text-muted">Formül</label>
			<FormulaInput v-model="draft.formula" :fields="fields" :locale="locale" :input-id="formulaId" />
			<span class="text-xs text-muted">Boş bırakılırsa elle doldurulan bir yardımcı sütun olur.</span>
		</div>

		<p v-if="preview?.problem" class="m-0 text-sm text-error" role="alert">{{ preview.problem }}</p>
		<div
			v-else-if="preview && preview.values.length > 0"
			class="flex flex-col gap-1 rounded-app border px-3 py-2 text-sm"
			:class="preview.errors > 0 ? 'border-warning/50 bg-warning/10' : 'border-primary/35 bg-primary/5'"
			role="status"
		>
			<span>
				<span
					v-for="(part, index) in previewParts"
					:key="index"
					:class="part.strong ? 'font-semibold' : ''"
					v-text="part.text"
				/>
			</span>
			<span class="text-xs text-muted">
				{{
					preview.errors === 0
						? "Hiçbir satırda hata yok."
						: `${preview.errors} satırda hata: ${preview.firstError}`
				}}
			</span>
		</div>

		<div class="flex justify-end gap-2">
			<AppButton @click="emit('cancel')">Vazgeç</AppButton>
			<AppButton type="primary" :disabled="Boolean(preview?.problem)" @click="save">Sütunu kaydet</AppButton>
		</div>
	</form>
</template>

<script setup lang="ts">
/**
 * One of a template's own columns being written: its header, its kind, and its formula, with the
 * values the formula gives on the first rows and how many rows it fails on, as it is typed. The
 * drawer works the preview out; "Sütunu kaydet" keeps the column and shows it in the sheet, not yet
 * saved.
 */
import type { GridLocale } from "@nouxwell/tabula-vue"
import { COLUMN_TYPES, takesDecimals, type ColumnDraft } from "~/utils/columns"

const draft = defineModel<ColumnDraft>("draft", { required: true })

const props = defineProps<{
	fields: readonly { readonly key: string; readonly label: string; readonly kind: string }[]
	locale: GridLocale
	/** The formula on the sheet as it stands: values on the first rows, or why it cannot be one. */
	preview: {
		readonly problem: string | null
		readonly values: readonly string[]
		readonly errors: number
		readonly firstError: string
	} | null
}>()

const emit = defineEmits<{ save: []; cancel: [] }>()

const formulaId = useId()

/** "İlk satırlar: 2,5 · 11,8 · …" in parts, so its spaces are written as they are. */
const previewParts = computed(() => [
	{ text: "İlk satırlar: ", strong: false },
	...(props.preview?.values ?? []).flatMap((value, index) => [
		...(index > 0 ? [{ text: " · ", strong: false }] : []),
		{ text: value === "" ? "boş" : value, strong: true }
	])
])

function save(): void {
	emit("save")
}
</script>
