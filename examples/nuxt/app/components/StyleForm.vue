<template>
	<form
		class="flex flex-col gap-3.5 rounded-app border border-primary bg-surface p-3.5 shadow-[0_0_0_3px_rgba(0,178,123,0.12)]"
		@submit.prevent="save"
	>
		<div class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Alan</span>
				<AppSelect v-model:value="draft.condition.field" :options="fieldOptions" @update:value="fix" />
			</label>
			<label class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">Koşul</span>
				<AppSelect v-model:value="draft.condition.op" :options="ops" />
			</label>
			<label v-if="compares" class="flex min-w-0 flex-col gap-1">
				<span class="text-xs font-semibold text-muted">
					{{ draft.condition.against === "" ? "Değer" : "Alan" }}
				</span>
				<AppInput
					v-if="draft.condition.against === ''"
					v-model:value="draft.condition.text"
					size="small"
					:placeholder="example"
				/>
				<AppSelect v-else v-model:value="draft.condition.against" :options="against" />
			</label>
		</div>
		<span v-if="compares && against.length > 1">
			<AppButton text type="primary" @click="toggleAgainst">
				{{ draft.condition.against === "" ? "Başka bir alanla karşılaştır" : "Bir değerle karşılaştır" }}
			</AppButton>
		</span>

		<div class="flex flex-wrap items-end gap-6">
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-semibold text-muted">Dolgu</span>
				<span class="flex gap-1.5" role="group" aria-label="Dolgu">
					<button
						type="button"
						class="size-7 rounded-app border border-divider bg-surface"
						:class="draft.fill === null ? 'ring-2 ring-primary' : ''"
						aria-label="Dolgu yok"
						:aria-pressed="draft.fill === null"
						@click="draft.fill = null"
					>
						<AppIcon name="close" :size="14" class="text-muted" />
					</button>
					<button
						v-for="swatch in MARK_SWATCHES"
						:key="swatch.value"
						type="button"
						class="size-7 rounded-app border border-divider"
						:class="draft.fill === swatch.value ? 'ring-2 ring-primary' : ''"
						:style="{ background: `color-mix(in srgb, ${swatch.hex} 24%, white)` }"
						:aria-label="swatch.label"
						:aria-pressed="draft.fill === swatch.value"
						@click="draft.fill = swatch.value"
					/>
				</span>
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-semibold text-muted">Yazı</span>
				<span class="flex gap-1.5" role="group" aria-label="Yazı rengi">
					<button
						type="button"
						class="size-7 rounded-app border border-divider bg-surface"
						:class="draft.color === null ? 'ring-2 ring-primary' : ''"
						aria-label="Yazı rengi yok"
						:aria-pressed="draft.color === null"
						@click="draft.color = null"
					>
						<AppIcon name="close" :size="14" class="text-muted" />
					</button>
					<button
						v-for="swatch in MARK_SWATCHES"
						:key="swatch.value"
						type="button"
						class="size-7 rounded-app border border-divider"
						:class="draft.color === swatch.value ? 'ring-2 ring-primary' : ''"
						:style="{ background: swatch.hex }"
						:aria-label="swatch.label"
						:aria-pressed="draft.color === swatch.value"
						@click="draft.color = swatch.value"
					/>
				</span>
			</div>
			<label class="flex items-center gap-2 pb-1 text-sm">
				<AppSwitch v-model:value="draft.bold" />
				Kalın
			</label>
		</div>

		<div class="flex gap-2" role="group" aria-label="Nereye">
			<AppButton
				:type="draft.scope === 'cell' ? 'primary' : 'default'"
				:secondary="draft.scope === 'cell'"
				:aria-pressed="draft.scope === 'cell'"
				@click="draft.scope = 'cell'"
			>
				Yalnız hücre
			</AppButton>
			<AppButton
				:type="draft.scope === 'row' ? 'primary' : 'default'"
				:secondary="draft.scope === 'row'"
				:aria-pressed="draft.scope === 'row'"
				@click="draft.scope = 'row'"
			>
				Bütün satır
			</AppButton>
		</div>

		<p v-if="preview?.problem" class="m-0 text-sm text-error" role="alert">{{ preview.problem }}</p>
		<div
			v-else-if="preview"
			class="flex items-center gap-2.5 rounded-app border border-divider px-3 py-2"
			role="status"
		>
			<span class="flex-1 text-sm">
				Şimdi
				<strong>
					<AppNumberAnimation :from="0" :to="preview.count" locale="tr-TR" />
					satır
				</strong>
				bu renge boyanır.
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
 * One colour rule being written, in the rules drawer's Renkler tab: when it colours, what it puts
 * on, and whether on the field's cell or the whole row. The drawer works out how many rows it would
 * colour now from the draft as it changes, and keeps it only on "Kuralı kaydet".
 */
import type { FieldSchema, ModuleSchema } from "@nouxwell/tabula-core"
import { comparableFields, opsFor } from "~/utils/rules"
import { MARK_SWATCHES, type StyleDraft } from "~/utils/styles"

const draft = defineModel<StyleDraft>("draft", { required: true })

const props = defineProps<{
	schema: ModuleSchema
	/** How the rule stands on the sheet now; null while there is nothing to say. */
	preview: { readonly problem: string | null; readonly count: number } | null
	/** Whether the grid shows only the rows the rule colours. */
	showing: boolean
}>()

const emit = defineEmits<{ save: []; cancel: []; toggleRows: [] }>()

const fieldOptions = computed(() => props.schema.fields.map(field => ({ label: field.label, value: field.key })))
const field = computed<FieldSchema | undefined>(() =>
	props.schema.has(draft.value.condition.field) ? props.schema.field(draft.value.condition.field) : undefined
)
const ops = computed(() => opsFor(field.value, props.schema.fields, false))
const compares = computed(() => draft.value.condition.op !== "filled" && draft.value.condition.op !== "empty")
const against = computed(() => {
	const own = field.value
	const others = own ? comparableFields(own, props.schema.fields) : []

	return [
		...(own?.type === "lookup" ? [] : [{ label: "bir değer", value: "" }]),
		...others.map(other => ({ label: other.label, value: other.key }))
	]
})
const example = computed(() => {
	const type = field.value?.type

	return type === "date" ? "01.12.2026" : type === "bool" ? "Evet" : type === "string" ? "" : "100"
})

/** A field changed: what was said of the last one may not apply to it. */
function fix(): void {
	if (!ops.value.some(op => op.value === draft.value.condition.op)) {
		draft.value.condition.op = "filled"
	}

	draft.value.condition.against = ""
	draft.value.condition.text = ""
}

function toggleAgainst(): void {
	draft.value.condition.against =
		draft.value.condition.against === "" ? (against.value.find(item => item.value !== "")?.value ?? "") : ""
}

function save(): void {
	if (!props.preview?.problem) {
		emit("save")
	}
}
</script>
