<template>
	<!--
		No mask: the sheet stays in view and in reach while the rules are written beside it. Nor does a
		click outside close it, as Naive UI does a drawer with no mask: a click in the sheet, or in the
		window that names a new template, is work beside the drawer, not leaving it.
	-->
	<AppDrawer
		v-model:show="show"
		:width-responsive="560"
		:show-mask="false"
		:mask-closable="false"
		:trap-focus="false"
		:block-scroll="false"
	>
		<AppDrawerContent :title="creating ? 'Kurallar · yeni şablon' : `Kurallar · ${template.name}`">
			<div class="flex flex-col gap-2.5">
				<div class="flex gap-2" role="group" aria-label="Kurallar">
					<AppButton
						:type="tab === 'checks' ? 'primary' : 'default'"
						:secondary="tab === 'checks'"
						:aria-pressed="tab === 'checks'"
						:disabled="busy"
						@click="tab = 'checks'"
					>
						Satır kuralları · {{ checks.length }}
					</AppButton>
					<AppButton
						:type="tab === 'columns' ? 'primary' : 'default'"
						:secondary="tab === 'columns'"
						:aria-pressed="tab === 'columns'"
						:disabled="busy"
						@click="tab = 'columns'"
					>
						Hesaplanan sütunlar · {{ columns.length }}
					</AppButton>
				</div>

				<!-- Row checks -->
				<template v-if="tab === 'checks'">
					<p class="m-0 text-sm text-muted">
						Satır kuralları şablona yazılır ve onunla açan herkes için geçerlidir. Modül şemasının
						kurallarını yalnız daraltabilir.
					</p>

					<div
						v-for="item in moduleItems"
						:key="item.id"
						class="flex items-center gap-2.5 rounded-app border border-divider bg-surface-alt px-3 py-2.5"
					>
						<span class="flex-1 text-sm text-muted">{{ item.text }}</span>
						<AppTag size="small">Modül</AppTag>
					</div>

					<template v-for="(item, index) in items" :key="item.id">
						<RuleForm
							v-if="editing && editing.index === index"
							v-model:draft="editing.draft"
							:schema="sheet.schema"
							:preview="preview"
							:showing="showing"
							@save="keep"
							@cancel="stopEditing"
							@toggle-rows="toggleRows"
						/>
						<AppCard v-else content-class="flex items-center gap-2.5 px-3! py-2.5!">
							<span
								class="size-2 flex-none rounded-full"
								:class="item.severity === 'error' ? 'bg-error' : 'bg-warning'"
								aria-hidden="true"
							/>
							<span class="flex-1 text-sm">{{ item.text }}</span>
							<AppTag size="small" :type="item.severity === 'error' ? 'error' : 'warning'">
								{{ item.severity === "error" ? "Hata" : "Uyarı" }} · {{ item.count }} satır
							</AppTag>
							<AppTooltip>
								<template #trigger>
									<AppButton
										icon="edit"
										aria-label="Kuralı düzenle"
										:disabled="busy"
										@click="edit(index)"
									/>
								</template>
								Kuralı düzenle
							</AppTooltip>
							<AppTooltip>
								<template #trigger>
									<AppButton
										icon="trash"
										aria-label="Kuralı sil"
										:disabled="busy"
										@click="remove(index)"
									/>
								</template>
								Kuralı sil
							</AppTooltip>
						</AppCard>
					</template>

					<p v-if="items.length === 0 && !editing" class="m-0 text-sm text-muted">
						Bu şablonda henüz satır kuralı yok.
					</p>

					<RuleForm
						v-if="editing && editing.index === null"
						v-model:draft="editing.draft"
						:schema="sheet.schema"
						:preview="preview"
						:showing="showing"
						@save="keep"
						@cancel="stopEditing"
						@toggle-rows="toggleRows"
					/>
					<span v-if="!busy">
						<AppButton icon="plus" @click="add">Kural ekle</AppButton>
					</span>
				</template>

				<!-- The template's own columns -->
				<template v-else>
					<p class="m-0 text-sm text-muted">
						Şablonun kendi sütunları: bir formülle hesaplanır ya da elle doldurulur. Hiçbiri sunucuya
						gönderilmez.
					</p>

					<template v-for="(item, index) in columnItems" :key="item.key">
						<ColumnForm
							v-if="columnEditing && columnEditing.index === index"
							v-model:draft="columnEditing.draft"
							:fields="formulaFields"
							:locale="locale"
							:preview="columnPreview"
							@save="keepColumn"
							@cancel="columnEditing = null"
						/>
						<AppCard v-else content-class="flex items-center gap-2.5 px-3! py-2.5!">
							<span
								class="w-5 flex-none text-center font-mono text-sm"
								:class="item.formula ? 'text-primary-text' : 'text-muted'"
							>
								{{ item.formula ? "ƒ" : "Aa" }}
							</span>
							<span class="flex min-w-0 flex-1 flex-col">
								<strong class="text-sm">{{ item.label }}</strong>
								<span class="truncate font-mono text-xs text-muted">
									{{ item.formula ? `= ${item.formula}` : "yardımcı sütun, elle doldurulur" }}
								</span>
							</span>
							<AppTag size="small">{{ item.kind }}</AppTag>
							<AppTooltip>
								<template #trigger>
									<AppButton
										icon="edit"
										aria-label="Sütunu düzenle"
										:disabled="busy"
										@click="editColumn(index)"
									/>
								</template>
								Sütunu düzenle
							</AppTooltip>
							<AppTooltip>
								<template #trigger>
									<AppButton
										icon="trash"
										aria-label="Sütunu sil"
										:disabled="busy"
										@click="removeColumn(index)"
									/>
								</template>
								Sütunu sil
							</AppTooltip>
						</AppCard>
					</template>

					<p v-if="columnItems.length === 0 && !columnEditing" class="m-0 text-sm text-muted">
						Bu şablonun kendi sütunu yok.
					</p>

					<ColumnForm
						v-if="columnEditing && columnEditing.index === null"
						v-model:draft="columnEditing.draft"
						:fields="formulaFields"
						:locale="locale"
						:preview="columnPreview"
						@save="keepColumn"
						@cancel="columnEditing = null"
					/>
					<span v-if="!busy">
						<AppButton icon="plus" @click="addColumn">Sütun ekle</AppButton>
					</span>
				</template>
			</div>

			<template #footer>
				<div class="flex w-full flex-col gap-2">
					<p v-if="templateProblem" class="m-0 text-sm text-error" role="alert">{{ templateProblem }}</p>
					<div class="flex w-full items-center gap-2.5">
						<span class="flex-1 text-sm text-muted">
							{{
								previewing
									? "Tablodaki sütunlar kaydedilmedi."
									: changed
										? "Kaydedilmemiş değişiklik var."
										: "Değişiklik yok."
							}}
						</span>
						<AppButton :disabled="!changed" @click="reset">Vazgeç</AppButton>
						<AppButton
							type="primary"
							:disabled="!changed || busy || templateProblem !== null"
							@click="saveTemplate"
						>
							{{ creating ? "Şablon olarak kaydet…" : "Şablonu kaydet" }}
						</AppButton>
					</div>
				</div>
			</template>
		</AppDrawerContent>
	</AppDrawer>
</template>

<script setup lang="ts">
/**
 * The rules drawer, in two tabs: the template's row checks as sentences with how many rows each
 * catches now, and the template's own columns with their formulas, each with an editor. A rule or a
 * formula is written against the sheet as it stands, so its preview follows every keystroke; a
 * column kept shows in the sheet at once, not yet saved. Nothing reaches the template until "Şablonu
 * kaydet", which the page hands to the server; "Vazgeç" and closing put the sheet back as saved.
 */
import {
	applyFormulas,
	applyTemplate,
	formatCell,
	formulaWithLabels,
	isFormulaError,
	ModuleSchema,
	readTemplate,
	rowsBreaking,
	templateProblems,
	type CheckInput,
	type FieldInput,
	type ModuleSchemaInput,
	type RowId,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { describeCheck, type GridLocale } from "@nouxwell/tabula-vue"
import {
	columnDraftOf,
	columnOf,
	columnsByLetter,
	keyFor,
	kindWord,
	newColumnDraft,
	type ColumnDraft
} from "~/utils/columns"
import { checkOf, draftOf, newDraft, type RuleDraft } from "~/utils/rules"
import type { Sheet } from "~/utils/sheet"

const show = defineModel<boolean>("show", { required: true })

const props = defineProps<{
	sheet: Sheet
	moduleInput: ModuleSchemaInput
	/** The template as the server sent it. */
	template: {
		readonly id: string
		readonly name: string
		readonly checks?: readonly CheckInput[]
		readonly columns?: readonly FieldInput[]
	}
	locale: GridLocale
	settings: ValueSettings
	/** Saves the template with its new checks and columns; resolves to whether it was kept. */
	save: (template: unknown) => Promise<boolean>
	/** Each column's letter as the columns stand on screen, by field key: what an address in a formula names. */
	letters: Readonly<Record<string, string>>
	/** No template was chosen: what is written here becomes a new template, named as it is saved. */
	creating?: boolean
}>()

const emit = defineEmits<{
	showRows: [rows: readonly RowId[] | null]
	/** The template to show the sheet with, not saved; null for the template as saved. */
	preview: [template: unknown]
}>()

/** How many rows a formula's preview shows the values of. */
const PREVIEW_ROWS = 5

const moduleSchema = computed(() => ModuleSchema.from(props.moduleInput))
const tab = ref<"checks" | "columns">("checks")
/** The template's checks and columns as they are being changed here, before the template is saved. */
const checks = ref<CheckInput[]>([])
const columns = ref<FieldInput[]>([])
const editing = ref<{ index: number | null; draft: RuleDraft } | null>(null)
const columnEditing = ref<{ index: number | null; draft: ColumnDraft } | null>(null)
const showing = ref(false)
/** Whether the sheet shows columns kept here and not yet saved. */
const previewing = ref(false)

/** A rule or a column is open: the rest waits until it is kept or let go. */
const busy = computed(() => editing.value !== null || columnEditing.value !== null)

function copy<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

function reset(): void {
	checks.value = copy(toRaw(props.template.checks ?? [])) as CheckInput[]
	columns.value = copy(toRaw(props.template.columns ?? [])) as FieldInput[]
	editing.value = null
	columnEditing.value = null
	hideRows()
	stopPreview()
}

watch([show, () => props.template], ([open]) => {
	if (open) {
		reset()
	} else {
		hideRows()
		stopPreview()
	}
})

const changed = computed(
	() =>
		JSON.stringify(checks.value) !== JSON.stringify(props.template.checks ?? []) ||
		JSON.stringify(columns.value) !== JSON.stringify(props.template.columns ?? [])
)

/** The template as it stands here, to show or to save. */
function working(withChecks = checks.value, withColumns = columns.value) {
	// Copied through JSON, which reads every entry: a rule pushed onto a list is then a change Vue
	// sees, where reading the raw list would leave a result as it was.
	return { ...toRaw(props.template), checks: copy(withChecks), columns: copy(withColumns) }
}

/** The schema with the template applied as it would be with these checks and columns; null with its problems. */
function appliedWith(withChecks: readonly CheckInput[], withColumns: readonly FieldInput[]) {
	try {
		const template = readTemplate(
			working(withChecks as CheckInput[], withColumns as FieldInput[]),
			moduleSchema.value.module
		)
		const problems = templateProblems(moduleSchema.value, template)

		return problems.length > 0
			? { schema: null, problems }
			: { schema: applyTemplate(moduleSchema.value, template), problems }
	} catch (error) {
		return {
			schema: null,
			problems: [{ path: "", message: error instanceof Error ? error.message : String(error) }]
		}
	}
}

const applied = computed(() => appliedWith(checks.value, columns.value))

/** What keeps the template from being saved as it stands, such as a formula reading a column deleted. */
const templateProblem = computed(() => {
	const problem = applied.value.problems[0]

	return problem ? `Şablon uygulanamıyor: ${problem.path} ${problem.message}` : null
})

// ---------------------------------------------------------------- row checks

/** Read through the sheet's version, so the counts follow what is typed into the sheet. */
function caught(schema: ModuleSchema, id: string): RowId[] {
	void props.sheet.version.value

	const check = schema.checks.find(item => item.id === id)

	return check ? rowsBreaking(schema, props.sheet.store, check, props.settings) : []
}

const moduleItems = computed(() =>
	moduleSchema.value.checks.map(check => ({
		id: check.id,
		text: describeCheck(check, props.sheet.schema, props.locale, props.settings)
	}))
)

const items = computed(() =>
	checks.value.map(input => {
		const schema = applied.value.schema
		const check = schema?.checks.find(item => item.id === input.id)

		return {
			id: input.id,
			text: check && schema ? describeCheck(check, schema, props.locale, props.settings) : input.id,
			severity: check?.severity ?? input.severity ?? "error",
			count: check && schema ? caught(schema, check.id).length : 0
		}
	})
)

/** The draft as it would stand on the sheet: how many rows it catches, or why it is not a rule yet. */
const draftCheck = computed(() => {
	const current = editing.value

	if (!current) {
		return null
	}

	const made = checkOf(current.draft, props.sheet.schema, props.settings)

	if ("problem" in made) {
		return { problem: made.problem, check: null, rows: [] as RowId[] }
	}

	const list = [...checks.value]
	const position = current.index ?? list.length

	list[position] = made.check

	const { schema, problems } = appliedWith(list, columns.value)
	const own = problems.find(problem => problem.path.startsWith(`checks[${position}]`)) ?? problems[0]

	return schema
		? { problem: null, check: made.check, rows: caught(schema, made.check.id) }
		: { problem: own?.message ?? "Bu kural uygulanamıyor.", check: null, rows: [] as RowId[] }
})

const preview = computed(() =>
	draftCheck.value ? { problem: draftCheck.value.problem, count: draftCheck.value.rows.length } : null
)

// What the sheet shows follows the draft while it narrows to the rule's rows. Watched by the rows
// themselves, not the result: narrowing the sheet moves its version, which works the result out
// again, and the same rows must not narrow it again, round and round.
watch(
	() => draftCheck.value?.rows.join("\u0000") ?? "",
	() => {
		if (showing.value) {
			emit("showRows", draftCheck.value?.rows ?? [])
		}
	}
)

function add(): void {
	editing.value = { index: null, draft: newDraft(props.sheet.schema) }
}

function edit(index: number): void {
	const schema = applied.value.schema
	const check = schema?.checks.find(item => item.id === checks.value[index]?.id)

	if (check && schema) {
		editing.value = { index, draft: draftOf(check, schema, props.settings) }
	}
}

function remove(index: number): void {
	checks.value.splice(index, 1)
}

function keep(): void {
	const made = draftCheck.value

	if (!editing.value || !made?.check) {
		return
	}

	if (editing.value.index === null) {
		checks.value.push(made.check)
	} else {
		checks.value[editing.value.index] = made.check
	}

	stopEditing()
}

function stopEditing(): void {
	editing.value = null
	hideRows()
}

function toggleRows(): void {
	showing.value = !showing.value
	emit("showRows", showing.value ? (draftCheck.value?.rows ?? []) : null)
}

function hideRows(): void {
	if (showing.value) {
		showing.value = false
		emit("showRows", null)
	}
}

// ---------------------------------------------------------------- columns

/** Every field a formula may name, the template's columns too, by key and by label. */
const namedFields = computed(() => [
	// By the labels the sheet shows: the template may have renamed a field, "Yeni fiyat" to "Aralık fiyatı".
	...moduleSchema.value.fields.map(field => ({
		key: field.key,
		label: props.sheet.schema.has(field.key) ? props.sheet.schema.field(field.key).label : field.label,
		kind: kindWord(field.type),
		letter: props.letters[field.key] ?? null
	})),
	...columns.value.map(column => ({
		key: column.key,
		label: column.label ?? column.key,
		kind: kindWord(column.type),
		letter: props.letters[column.key] ?? null
	}))
])

/** The fields by where their columns stand on screen, A first: what an address in a formula reads. */
const addressColumns = computed(() => columnsByLetter(namedFields.value))

/**
 * A new column takes its key from its header as it stands when kept, "Kâr marjı %" as "karMarji";
 * a column already there keeps its own, which its formulas and the drafts already name it by.
 */
function withKey(current: { readonly index: number | null; readonly draft: ColumnDraft }): ColumnDraft {
	if (current.index !== null) {
		return current.draft
	}

	const taken = new Set(namedFields.value.map(field => field.key))

	return { ...current.draft, key: keyFor(current.draft.label, taken) }
}

/** What the formula being written may read: every field but its own column. */
const formulaFields = computed(() => namedFields.value.filter(field => field.key !== columnEditing.value?.draft.key))

const columnItems = computed(() =>
	columns.value.map(column => ({
		key: column.key,
		label: column.label ?? column.key,
		kind: kindWord(column.type),
		formula: column.formula ? formulaWithLabels(column.formula, namedFields.value) : null
	}))
)

/**
 * The column being written as it would stand on the sheet: what its formula gives on the first rows,
 * how many rows it fails on, or why it cannot be a column yet.
 */
const columnPreview = computed(() => {
	const current = columnEditing.value

	if (!current) {
		return null
	}

	const made = columnOf(withKey(current), namedFields.value, addressColumns.value)
	const list = [...columns.value]
	const position = current.index ?? list.length

	list[position] = made

	const { schema, problems } = appliedWith(checks.value, list)

	if (!schema) {
		const own = problems.find(problem => problem.path.startsWith(`columns[${position}]`)) ?? problems[0]

		return { problem: `Formül uygulanamıyor: ${own?.message ?? ""}`, values: [], errors: 0, firstError: "" }
	}

	if (!made.formula) {
		return { problem: null, values: [], errors: 0, firstError: "" }
	}

	void props.sheet.version.value

	const field = schema.field(made.key)
	const rows = applyFormulas(schema, props.sheet.store.snapshot())
	const values = rows.map(row => row.values?.[made.key] ?? null)
	const failures = values.filter(value => isFormulaError(value))
	const first = failures[0]

	return {
		problem: null,
		values: values.slice(0, PREVIEW_ROWS).map(value => formatCell(field, value, props.settings)),
		errors: failures.length,
		firstError: first && isFormulaError(first) ? first.formulaError : ""
	}
})

function addColumn(): void {
	columnEditing.value = { index: null, draft: newColumnDraft(new Set(namedFields.value.map(field => field.key))) }
}

function editColumn(index: number): void {
	const column = columns.value[index]

	if (column) {
		columnEditing.value = { index, draft: columnDraftOf(column, namedFields.value) }
	}
}

function removeColumn(index: number): void {
	columns.value.splice(index, 1)
	showPreview()
}

/** Keeps the column, and shows the sheet with it: not saved until the template is. */
function keepColumn(): void {
	const current = columnEditing.value

	if (!current || columnPreview.value?.problem) {
		return
	}

	const made = columnOf(withKey(current), namedFields.value, addressColumns.value)

	if (current.index === null) {
		columns.value.push(made)
	} else {
		columns.value[current.index] = made
	}

	columnEditing.value = null
	showPreview()
}

function showPreview(): void {
	if (applied.value.schema) {
		previewing.value = true
		emit("preview", working())
	}
}

function stopPreview(): void {
	if (previewing.value) {
		previewing.value = false
		emit("preview", null)
	}
}

/** The button spins until the server has answered; kept, the page makes the sheet again with it. */
async function saveTemplate(): Promise<void> {
	if (await props.save(working())) {
		previewing.value = false
	}
}
</script>
