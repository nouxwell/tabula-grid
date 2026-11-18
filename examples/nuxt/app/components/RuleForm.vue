<template>
	<form
		class="flex flex-col gap-3.5 rounded-app border border-primary bg-surface p-3.5 shadow-[0_0_0_3px_rgba(0,178,123,0.12)]"
		@submit.prevent="save"
	>
		<div class="grid grid-cols-2 gap-2.5">
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Bu alan</span>
				<AppSelect
					v-model:value="draft.assert.field"
					:options="fieldOptions"
					@update:value="fix(draft.assert, true)"
				/>
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">olmalı</span>
				<AppSelect v-model:value="draft.assert.op" :options="opsOf(draft.assert, true)" />
			</label>
		</div>

		<div v-if="compares(draft.assert)" class="grid grid-cols-2 gap-2.5">
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">neyle</span>
				<AppSelect v-model:value="draft.assert.against" :options="againstOf(draft.assert)" />
			</label>
			<label v-if="draft.assert.against === ''" class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">değer</span>
				<AppInput v-model:value="draft.assert.text" size="small" :placeholder="exampleOf(draft.assert)" />
			</label>
		</div>

		<div class="flex flex-col gap-2">
			<span class="text-xs font-semibold text-muted">Ne zaman</span>
			<p v-if="draft.when.length === 0" class="m-0 text-sm text-muted">Her zaman.</p>
			<div
				v-for="(condition, index) in draft.when"
				:key="index"
				class="grid grid-cols-[minmax(0,1.2fr)_96px_minmax(0,1fr)_auto] items-center gap-2"
			>
				<AppSelect
					v-model:value="condition.field"
					:options="fieldOptions"
					aria-label="Koşulun alanı"
					@update:value="fix(condition, false)"
				/>
				<AppSelect v-model:value="condition.op" :options="opsOf(condition, false)" aria-label="Karşılaştırma" />
				<span class="min-w-0">
					<AppSelect
						v-if="compares(condition) && condition.against !== ''"
						v-model:value="condition.against"
						:options="againstOf(condition)"
						aria-label="Karşılaştırılan alan"
					/>
					<AppInput
						v-else-if="compares(condition)"
						v-model:value="condition.text"
						size="small"
						aria-label="Koşulun değeri"
						:placeholder="exampleOf(condition)"
					/>
				</span>
				<AppButton icon="close" aria-label="Koşulu kaldır" @click="draft.when.splice(index, 1)" />
			</div>
			<span>
				<AppButton text type="primary" icon="plus" @click="draft.when.push(newCondition(schema))">
					Koşul ekle
				</AppButton>
			</span>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<span class="mr-1 text-xs font-semibold text-muted">Önem</span>
			<AppButton
				:type="draft.severity === 'error' ? 'error' : 'default'"
				:secondary="draft.severity === 'error'"
				:aria-pressed="draft.severity === 'error'"
				@click="draft.severity = 'error'"
			>
				Hata · işlemeyi durdurur
			</AppButton>
			<AppButton
				:type="draft.severity === 'warning' ? 'warning' : 'default'"
				:secondary="draft.severity === 'warning'"
				:aria-pressed="draft.severity === 'warning'"
				@click="draft.severity = 'warning'"
			>
				Uyarı
			</AppButton>
		</div>

		<div class="grid grid-cols-2 gap-2.5">
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Mesaj, Türkçe (isteğe bağlı)</span>
				<AppInput v-model:value="draft.tr" size="small" placeholder="Boşsa tablo kuraldan yazar" />
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Mesaj, İngilizce</span>
				<AppInput v-model:value="draft.en" size="small" placeholder="Boşsa tablo kuraldan yazar" />
			</label>
		</div>

		<p v-if="preview?.problem" class="m-0 text-sm text-error" role="alert">{{ preview.problem }}</p>
		<div
			v-else-if="preview"
			class="flex items-center gap-2.5 rounded-app border px-3 py-2"
			:class="draft.severity === 'error' ? 'border-error/40 bg-error/5' : 'border-warning/50 bg-warning/10'"
			role="status"
		>
			<span
				class="size-2 flex-none rounded-full"
				:class="draft.severity === 'error' ? 'bg-error' : 'bg-warning'"
				aria-hidden="true"
			/>
			<span class="flex-1 text-sm">
				Bu kural şu an
				<strong>
					<AppNumberAnimation :from="0" :to="preview.count" locale="tr-TR" />
					satırda
				</strong>
				{{ draft.severity === "error" ? "hata" : "uyarı" }} verir.
			</span>
			<AppButton text type="primary" :disabled="preview.count === 0 && !showing" @click="emit('toggleRows')">
				{{ showing ? "Tüm satırlar" : "Satırları göster" }}
			</AppButton>
		</div>

		<div class="flex justify-end gap-2">
			<AppButton @click="emit('cancel')">Vazgeç</AppButton>
			<AppButton type="primary" :disabled="Boolean(preview?.problem)" @click="save">Kuralı kaydet</AppButton>
		</div>
	</form>
</template>

<script setup lang="ts">
/**
 * One rule being written, in the rules drawer: what must hold for which field, when, how serious
 * it is, and in whose words. The drawer works out the preview (how many rows the rule would catch
 * now) from the draft as it changes, and keeps the rule only on "Kuralı kaydet".
 */
import type { FieldSchema, ModuleSchema } from "@nouxwell/tabula-core"
import { comparableFields, newCondition, opsFor, type ConditionDraft, type RuleDraft } from "~/utils/rules"

const draft = defineModel<RuleDraft>("draft", { required: true })

const props = defineProps<{
	schema: ModuleSchema
	/** How the rule stands on the sheet now; null while there is nothing to say. */
	preview: { readonly problem: string | null; readonly count: number } | null
	/** Whether the grid shows only the rows the rule catches. */
	showing: boolean
}>()

const emit = defineEmits<{ save: []; cancel: []; toggleRows: [] }>()

const fieldOptions = computed(() => props.schema.fields.map(field => ({ label: field.label, value: field.key })))

function fieldOf(condition: ConditionDraft): FieldSchema | undefined {
	return props.schema.has(condition.field) ? props.schema.field(condition.field) : undefined
}

function opsOf(condition: ConditionDraft, asserting: boolean) {
	return opsFor(fieldOf(condition), props.schema.fields, asserting)
}

function compares(condition: ConditionDraft): boolean {
	return condition.op !== "filled" && condition.op !== "empty"
}

/** A value typed, or another field of its kind; a lookup only with another lookup. */
function againstOf(condition: ConditionDraft) {
	const field = fieldOf(condition)
	const others = field ? comparableFields(field, props.schema.fields) : []

	return [
		...(field?.type === "lookup" ? [] : [{ label: "bir değer", value: "" }]),
		...others.map(other => ({ label: other.label, value: other.key }))
	]
}

function exampleOf(condition: ConditionDraft): string {
	const type = fieldOf(condition)?.type

	return type === "date" ? "01.12.2026" : type === "bool" ? "Evet" : type === "string" ? "" : "1.000,00"
}

/** A field changed: what was said of the last one may not apply to it. */
function fix(condition: ConditionDraft, asserting: boolean): void {
	if (!opsOf(condition, asserting).some(op => op.value === condition.op)) {
		condition.op = "filled"
	}

	const field = fieldOf(condition)

	condition.against = field?.type === "lookup" ? (comparableFields(field, props.schema.fields)[0]?.key ?? "") : ""
	condition.text = ""
}

function save(): void {
	if (!props.preview?.problem) {
		emit("save")
	}
}
</script>
