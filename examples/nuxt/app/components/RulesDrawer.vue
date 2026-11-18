<template>
	<!-- No mask: the sheet stays in view and in reach while the rules are written beside it. -->
	<AppDrawer v-model:show="show" :width-responsive="560" :show-mask="false" :trap-focus="false" :block-scroll="false">
		<AppDrawerContent :title="`Kurallar · ${template.name}`">
			<div class="flex flex-col gap-2.5">
				<p class="m-0 text-sm text-muted">
					Satır kuralları şablona yazılır ve onunla açan herkes için geçerlidir. Modül şemasının kurallarını
					yalnız daraltabilir.
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
					<div
						v-else
						class="flex items-center gap-2.5 rounded-app border border-divider bg-surface px-3 py-2.5"
					>
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
									:disabled="editing !== null"
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
									:disabled="editing !== null"
									@click="remove(index)"
								/>
							</template>
							Kuralı sil
						</AppTooltip>
					</div>
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
				<span v-if="!editing">
					<AppButton icon="plus" @click="add">Kural ekle</AppButton>
				</span>
			</div>

			<template #footer>
				<div class="flex w-full items-center gap-2.5">
					<span class="flex-1 text-sm text-muted">
						{{ changed ? "Kaydedilmemiş değişiklik var." : "Değişiklik yok." }}
					</span>
					<AppButton :disabled="!changed" @click="reset">Vazgeç</AppButton>
					<AppButton type="primary" :disabled="!changed || editing !== null" @click="saveTemplate">
						Şablonu kaydet
					</AppButton>
				</div>
			</template>
		</AppDrawerContent>
	</AppDrawer>
</template>

<script setup lang="ts">
/**
 * The rules drawer: the template's row checks as sentences, how many rows each catches now, and the
 * editor of one. A rule is written against the sheet as it stands, so the count follows each pick
 * and keystroke, and "Satırları göster" narrows the sheet to the rows it catches. Nothing reaches
 * the template until "Şablonu kaydet", which the page hands to the server.
 */
import {
	applyTemplate,
	ModuleSchema,
	readTemplate,
	rowsBreaking,
	templateProblems,
	type CheckInput,
	type ModuleSchemaInput,
	type RowId,
	type ValueSettings
} from "@nouxwell/tabula-core"
import { describeCheck, type GridLocale } from "@nouxwell/tabula-vue"
import { checkOf, draftOf, newDraft, type RuleDraft } from "~/utils/rules"
import type { Sheet } from "~/utils/sheet"

const show = defineModel<boolean>("show", { required: true })

const props = defineProps<{
	sheet: Sheet
	moduleInput: ModuleSchemaInput
	/** The template as the server sent it. */
	template: { readonly id: string; readonly name: string; readonly checks?: readonly CheckInput[] }
	locale: GridLocale
	settings: ValueSettings
	/** Saves the template with its new checks; resolves to whether it was kept. */
	save: (template: unknown) => Promise<boolean>
}>()

const emit = defineEmits<{ showRows: [rows: readonly RowId[] | null] }>()

const moduleSchema = computed(() => ModuleSchema.from(props.moduleInput))
/** The template's checks as they are being changed here, before the template is saved. */
const working = ref<CheckInput[]>([])
const editing = ref<{ index: number | null; draft: RuleDraft } | null>(null)
const showing = ref(false)

function reset(): void {
	working.value = structuredClone(toRaw(props.template.checks ?? [])) as CheckInput[]
	editing.value = null
	hideRows()
}

watch([show, () => props.template], ([open]) => {
	if (open) {
		reset()
	} else {
		hideRows()
	}
})

const changed = computed(() => JSON.stringify(working.value) !== JSON.stringify(props.template.checks ?? []))

/** The schema with the template applied as it would be with these checks; null with its problems. */
function appliedWith(checks: readonly CheckInput[]) {
	try {
		// Copied through JSON, which reads every check: a rule pushed onto the list is then a change
		// Vue sees, where reading the raw list would leave the result as it was.
		const copy = JSON.parse(JSON.stringify(checks)) as CheckInput[]
		const template = readTemplate({ ...toRaw(props.template), checks: copy }, moduleSchema.value.module)
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

/** Read through the sheet's version, so the counts follow what is typed into the sheet. */
function caught(schema: ModuleSchema, id: string): RowId[] {
	void props.sheet.version.value

	const check = schema.checks.find(item => item.id === id)

	return check ? rowsBreaking(schema, props.sheet.store, check, props.settings) : []
}

const applied = computed(() => appliedWith(working.value))

const moduleItems = computed(() =>
	moduleSchema.value.checks.map(check => ({
		id: check.id,
		text: describeCheck(check, props.sheet.schema, props.locale, props.settings)
	}))
)

const items = computed(() =>
	working.value.map(input => {
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

	const list = [...working.value]
	const position = current.index ?? list.length

	list[position] = made.check

	const { schema, problems } = appliedWith(list)
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
	const check = schema?.checks.find(item => item.id === working.value[index]?.id)

	if (check && schema) {
		editing.value = { index, draft: draftOf(check, schema, props.settings) }
	}
}

function remove(index: number): void {
	working.value.splice(index, 1)
}

function keep(): void {
	const made = draftCheck.value

	if (!editing.value || !made?.check) {
		return
	}

	if (editing.value.index === null) {
		working.value.push(made.check)
	} else {
		working.value[editing.value.index] = made.check
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

/** The button spins until the server has answered; kept, the page makes the sheet again with it. */
async function saveTemplate(): Promise<void> {
	await props.save({ ...toRaw(props.template), checks: toRaw(working.value) })
}
</script>
