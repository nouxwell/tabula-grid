<template>
	<AppModal v-model:show="show" :title="`İçe aktar · ${fileName}`" width="880px">
		<AppModalScrollWrapper>
			<div class="flex flex-col gap-3">
				<p class="m-0 text-sm text-muted">
					{{ rowCount }} satır, {{ header.length }} sütun. Her sütunun tabloda nereye gideceğini seçin; "İçe
					aktar"a basana kadar tabloya dokunulmaz.
				</p>

				<!-- Added at the end, or written into the rows the file finds. -->
				<div class="flex flex-col gap-2.5 rounded-app border border-divider bg-surface-alt px-3.5 py-3">
					<div class="flex flex-wrap items-center gap-3">
						<strong class="text-sm">Satırlar</strong>
						<span
							class="inline-flex overflow-hidden rounded-app border border-divider bg-surface text-sm"
							role="radiogroup"
							aria-label="Satırlar ne olsun"
						>
							<button
								v-for="(item, index) in MODES"
								:key="item.value"
								type="button"
								role="radio"
								class="px-3 py-1.5"
								:class="[
									index > 0 ? 'border-l border-divider' : '',
									mode === item.value ? 'bg-primary/10 font-semibold text-primary-text' : 'text-muted'
								]"
								:aria-checked="mode === item.value"
								@click="setMode(item.value)"
							>
								{{ item.label }}
							</button>
						</span>
					</div>
					<div v-if="mode === 'update'" class="flex flex-wrap items-center gap-2 text-sm text-muted">
						<span>Satırları</span>
						<AppSelect
							v-model:value="matchColumn"
							class="w-44!"
							:options="headerOptions"
							aria-label="Satırları bulan sütun"
						/>
						<span>sütunu, tablodaki</span>
						<AppSelect
							v-model:value="matchField"
							class="w-44!"
							:options="keyOptions"
							aria-label="Satırların bulunduğu alan"
						/>
						<span>alanına göre bulur.</span>
					</div>
					<div
						v-if="mode === 'update' && matching"
						class="flex flex-wrap items-center gap-2 text-sm text-muted"
					>
						<span>
							<strong class="text-text">{{ matching.found }}</strong>
							satır tablodaki bir satırı buldu, o satırlar güncellenecek.
						</span>
						<template v-if="matching.lost > 0">
							<span>
								<strong class="text-text">{{ matching.lost }}</strong>
								satır bulamadı:
							</span>
							<AppSelect
								v-model:value="unmatched"
								class="w-36!"
								:options="UNMATCHED"
								aria-label="Bulamayan satırlar"
							/>
						</template>
					</div>
				</div>

				<div>
					<div
						class="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1.05fr)] gap-3 pb-1.5 text-xs font-semibold text-muted"
					>
						<span>Dosyadaki sütun · ilk değerler</span>
						<span />
						<span>Tablodaki alan</span>
					</div>
					<div
						v-for="column in rows"
						:key="column.index"
						class="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1.05fr)] items-start gap-3 border-t border-divider py-2.5"
					>
						<div class="flex min-w-0 flex-col gap-0.5">
							<strong class="truncate text-sm">
								{{ column.header || `${column.index + 1}. sütun` }}
							</strong>
							<span class="truncate text-xs text-muted tabular-nums">
								{{ column.samples.length > 0 ? `${column.samples.join(" · ")} …` : "boş" }}
							</span>
						</div>
						<span class="pt-1.5 text-center text-muted" aria-hidden="true">→</span>
						<div class="flex min-w-0 flex-col gap-1.5">
							<AppSelect
								v-if="column.status !== 'key'"
								:value="targets[column.index] ?? NONE"
								:options="fieldOptions"
								:aria-label="`${column.header} sütunu nereye gitsin`"
								@update:value="
									(value: string) => setTarget(column.index, value === NONE ? null : value)
								"
							/>
							<div
								v-else
								class="flex h-7 items-center rounded-app border border-info/60 px-2.5 text-sm"
								:aria-label="`${column.header} satırları bulur`"
							>
								{{ labelOf(matchField) }}
							</div>
							<span class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
								<AppTag v-if="column.note.tag" :type="column.note.type">{{ column.note.tag }}</AppTag>
								{{ column.note.text }}
							</span>
						</div>
					</div>
				</div>
			</div>
		</AppModalScrollWrapper>
		<template #footer>
			<div class="flex flex-wrap items-center gap-2.5">
				<span class="flex-1 text-sm text-muted">{{ summary }}</span>
				<AppButton @click="show = false">Vazgeç</AppButton>
				<AppButton type="primary" :disabled="!ready" @click="submit">{{ action }}</AppButton>
			</div>
		</template>
	</AppModal>
</template>

<script setup lang="ts">
/**
 * The import window: a file's columns, each with its first values and the field it goes to, as the
 * core suggests and the user changes; whether the rows are added at the end or written into the
 * rows they find, by a column such as the product code; and what will happen, counted, before
 * anything does. The page remembers where each header went, for the next file.
 */
import {
	headerKey,
	importTable,
	matchRows,
	suggestColumns,
	suggestMatch,
	type ModuleSchema,
	type RowStore,
	type SuggestionReason,
	type ValueSettings
} from "@nouxwell/tabula-core"
import type { ImportChoice } from "~/utils/sheet"

/** What the page keeps of an import, to suggest the same next time. */
export interface ImportMemory {
	/** Where each header went, by `headerKey`: a field's key, or null for a column left out. */
	readonly headers: Readonly<Record<string, string | null>>
	readonly mode: "add" | "update"
	/** The field rows were found by. */
	readonly matchField: string | null
}

const show = defineModel<boolean>("show", { required: true })

const props = defineProps<{
	fileName: string
	table: readonly (readonly string[])[]
	schema: ModuleSchema
	store: RowStore
	settings: ValueSettings
	remembered: ImportMemory | null
}>()

const emit = defineEmits<{
	import: [choice: ImportChoice, memory: ImportMemory]
}>()

const MODES = [
	{ value: "add", label: "Sona yeni satır olarak ekle" },
	{ value: "update", label: "Bulduğu satırları güncelle" }
] as const

const UNMATCHED = [
	{ value: "add", label: "Sona ekle" },
	{ value: "skip", label: "Alınmasın" }
]

const REASONS: Readonly<Record<SuggestionReason, string>> = {
	remembered: "Geçen seferki gibi",
	name: "Başlık tutuyor",
	similar: "Önerilen",
	values: "Önerilen"
}

const REASON_TEXT: Readonly<Record<SuggestionReason, string>> = {
	remembered: "bu başlık son içe aktarmada buraya gitti",
	name: "başlık alanın adı",
	similar: "adı benziyor",
	values: "değerler bu alanınkilerle tutuyor"
}

/** The select's value for a column left out: a select's values cannot be null. */
const NONE = "-"

/** The field types rows can be found by, as the core finds them. */
const KEY_TYPES = new Set(["string", "integer", "lookup"])

const header = computed(() => props.table[0] ?? [])
const rowCount = computed(() => props.table.slice(1).filter(line => !line.every(cell => cell.trim() === "")).length)

/** Where each column goes, by its position: a field's key, or null. */
const targets = ref<(string | null)[]>([])
const reasons = ref<(SuggestionReason | null)[]>([])
const mode = ref<"add" | "update">("add")
const matchColumn = ref<number | null>(null)
const matchField = ref<string | null>(null)
const unmatched = ref<"add" | "skip">("add")

/** A new file: the core's suggestions, the page's memory among them. */
watch(
	[show, () => props.table],
	([open]) => {
		if (!open) {
			return
		}

		const suggested = suggestColumns(props.table, {
			schema: props.schema,
			settings: props.settings,
			remembered: props.remembered?.headers ?? {}
		})
		const found = suggestMatch(props.table, props.store, { schema: props.schema, settings: props.settings })

		targets.value = suggested.map(item => item.field)
		reasons.value = suggested.map(item => item.reason)
		matchColumn.value = found?.column ?? null
		matchField.value = found?.field ?? props.remembered?.matchField ?? null
		mode.value = found ? "update" : "add"
		unmatched.value = "add"
	},
	{ immediate: true }
)

function setMode(value: "add" | "update"): void {
	mode.value = value
}

function setTarget(index: number, value: string | null): void {
	const next = [...targets.value]

	next[index] = value
	targets.value = next
	reasons.value = reasons.value.map((reason, at) => (at === index ? null : reason))
}

function labelOf(key: string | null): string {
	return key && props.schema.has(key) ? props.schema.field(key).label : "—"
}

const fieldOptions = computed(() => [
	{ label: "Alınmasın", value: NONE },
	...props.schema.fields.filter(field => field.editable).map(field => ({ label: field.label, value: field.key }))
])

const keyOptions = computed(() =>
	props.schema.fields
		.filter(field => KEY_TYPES.has(field.type))
		.map(field => ({ label: field.label, value: field.key }))
)

const headerOptions = computed(() =>
	header.value.map((name, index) => ({ label: name.trim() || `${index + 1}. sütun`, value: index }))
)

/** The column finding the rows, while rows are written into. */
const keyColumn = computed(() => (mode.value === "update" ? matchColumn.value : null))

/** The file as it would go in now: each column's fate, its first values, what cannot be read. */
const imported = computed(() =>
	importTable(props.table, {
		schema: props.schema,
		settings: props.settings,
		columns: Object.fromEntries(targets.value.map((target, index) => [index, target])),
		key: keyColumn.value
	})
)

/** Which rows of the sheet the file's rows find, while they are written into. */
const matches = computed(() =>
	keyColumn.value !== null && matchField.value && props.schema.has(matchField.value)
		? matchRows(props.store, props.schema.field(matchField.value), imported.value.keys, props.settings)
		: null
)

const matching = computed(() => {
	if (!matches.value) {
		return null
	}

	const found = matches.value.filter(rows => rows.length > 0).length

	return { found, lost: matches.value.length - found }
})

/** A header naming a field that cannot be typed into, such as "Ürün". */
function readOnlyNamed(name: string): string | null {
	const key = headerKey(name)
	const field = props.schema.fields.find(
		item => !item.editable && (headerKey(item.label) === key || item.key.toLowerCase() === key)
	)

	return field?.label ?? null
}

type TagType = "success" | "info" | "warning" | "default"

const rows = computed(() =>
	imported.value.columns.map(column => {
		const reason = reasons.value[column.index] ?? null
		let note: { tag: string; type: TagType; text: string }

		if (column.status === "key") {
			note = { tag: "Bulan sütun", type: "info", text: "satırları bulur, değeri değişmez" }
		} else if (column.status === "duplicate") {
			note = { tag: "Aynı alan", type: "warning", text: "başka bir sütun da buraya gidiyor; yalnız ilki alınır" }
		} else if (column.status === "matched" && column.unreadable > 0) {
			note = { tag: `${column.unreadable} değer okunamadı`, type: "warning", text: "alınır, hücrede işaretlenir" }
		} else if (column.status === "matched") {
			note = reason
				? { tag: REASONS[reason], type: "success", text: REASON_TEXT[reason] }
				: { tag: "", type: "default", text: "siz seçtiniz" }
		} else {
			const named = readOnlyNamed(column.header)

			note = named
				? { tag: "Salt okunur", type: "default", text: `"${named}" sütununa yazılamıyor` }
				: { tag: "Alınmayacak", type: "default", text: "bu sütun hiçbir alana gitmez" }
		}

		return { ...column, note }
	})
)

const taken = computed(() => imported.value.columns.filter(column => column.status === "matched").length)

/** Rows the import would add at the end. */
const adding = computed(() =>
	matching.value ? (unmatched.value === "add" ? matching.value.lost : 0) : imported.value.rows.length
)

const summary = computed(() => {
	const left = header.value.length - taken.value - (keyColumn.value === null ? 0 : 1)
	const missing =
		adding.value > 0 && imported.value.missing.length > 0
			? `eklenen satırlarda boş kalacak zorunlu alan: ${imported.value.missing.map(labelOf).join(", ")}`
			: "dosyada olmayan zorunlu alan yok"

	return `${taken.value} sütun alınacak · ${left} sütun alınmayacak · ${missing}`
})

const ready = computed(() => {
	if (taken.value === 0) {
		return false
	}

	return mode.value === "add" ? imported.value.rows.length > 0 : (matching.value?.found ?? 0) + adding.value > 0
})

const action = computed(() => {
	if (mode.value === "add") {
		return `${imported.value.rows.length} satırı ekle`
	}

	const found = matching.value?.found ?? 0

	return adding.value > 0 ? `${found} satırı güncelle, ${adding.value} satır ekle` : `${found} satırı güncelle`
})

function submit(): void {
	const columns = Object.fromEntries(targets.value.map((target, index) => [index, target]))
	const headers = Object.fromEntries(
		header.value.flatMap((name, index) =>
			index === keyColumn.value ? [] : [[headerKey(name), targets.value[index] ?? null]]
		)
	)

	emit(
		"import",
		{
			columns,
			match:
				keyColumn.value !== null && matchField.value
					? { column: keyColumn.value, field: matchField.value }
					: null,
			unmatched: unmatched.value
		},
		{ headers, mode: mode.value, matchField: matchField.value }
	)
	show.value = false
}
</script>
