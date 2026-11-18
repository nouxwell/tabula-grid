<template>
	<div class="flex h-full min-h-0 flex-col">
		<header class="flex h-14 flex-none items-center gap-3 border-b border-divider bg-surface px-4 md:px-6">
			<div class="flex items-center gap-2">
				<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
					<rect x="0" y="0" width="10" height="10" rx="2.5" class="fill-primary" />
					<rect x="12" y="0" width="10" height="10" rx="2.5" class="fill-primary" />
					<rect x="0" y="12" width="10" height="10" rx="2.5" class="fill-primary" />
					<rect x="12" y="12" width="10" height="10" rx="2.5" class="fill-primary opacity-55" />
				</svg>
				<span class="font-display text-lg font-semibold">Tabula</span>
			</div>
			<span class="hidden h-5 w-px bg-divider md:block" aria-hidden="true" />
			<nav aria-label="Konum" class="hidden items-center gap-2 text-sm text-muted md:flex">
				<span>Ürünler</span>
				<span aria-hidden="true">/</span>
				<span class="font-semibold text-text">Toplu işlemler</span>
			</nav>
			<div class="ml-auto flex items-center gap-2">
				<AppTooltip>
					<template #trigger>
						<AppButton
							:size="controlSize"
							:icon="dark ? 'sun' : 'moon'"
							:aria-label="themeLabel"
							class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
							@click="dark = !dark"
						/>
					</template>
					{{ themeLabel }}
				</AppTooltip>
				<!--
					On plain elements: Naive UI's styles are not in a CSS layer, so they win over Tailwind's
					display utilities set on Naive UI's own components.
				-->
				<span class="hidden w-40 md:block"><LocaleSelect v-model="locale" /></span>
				<span class="md:hidden">
					<AppDropdown :options="localeMenu()" @select="pickLocale">
						<AppButton :size="controlSize" icon="more" aria-label="Dil" class="min-h-11 min-w-11" />
					</AppDropdown>
				</span>
			</div>
		</header>

		<div class="flex flex-none flex-col gap-3 px-4 pt-4 md:px-6">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h1 class="m-0 font-display text-xl font-semibold md:text-2xl">{{ input?.title }}</h1>
				<AppTooltip :content-style="FIT_TOOLTIP_STYLE">
					<template #trigger>
						<span><AppTag>Taslak</AppTag></span>
					</template>
					<AppFitText
						text="Bir taslak üzerinde çalışıyorsunuz: İşle'ye basana kadar hiçbir kayıt değişmez. Taslak bu tarayıcıda saklanır."
					/>
				</AppTooltip>
				<span v-if="sheet" class="hidden text-sm text-muted md:inline">
					<AppNumberAnimation :from="0" :to="rowCount" locale="tr-TR" />
					satır
				</span>
				<span class="flex w-full items-center gap-1.5 text-sm text-muted md:ml-auto md:w-auto" role="status">
					<AppIcon name="saved" :size="16" class="text-primary-text" />
					<Transition name="fade" mode="out-in">
						<span :key="savedText">{{ savedText }}</span>
					</Transition>
				</span>
				<div class="hidden items-center gap-2 md:flex">
					<AppButton :disabled="!sheet" @click="saveDraft">
						<template #icon><AppIcon name="save" :size="16" /></template>
						Taslağı kaydet
					</AppButton>
					<AppButton :disabled="!sheet" :loading="phase === 'checking'" @click="check">
						<template #icon><AppIcon name="check" :size="16" /></template>
						Kontrol et
					</AppButton>
					<AppButton type="primary" :disabled="!sheet" :loading="phase === 'processing'" @click="process">
						<template #icon><AppIcon name="play" :size="16" /></template>
						İşle
					</AppButton>
				</div>
			</div>

			<!-- On a narrow screen the toolbar scrolls sideways, under a bar that stays clear of its buttons. -->
			<AppScrollbar x-scrollable trigger="none">
				<div role="toolbar" aria-label="Tablo araçları" class="flex w-max min-w-full items-center gap-2 pb-2">
					<AppTooltip>
						<template #trigger>
							<AppButton
								:size="controlSize"
								icon="undo"
								:disabled="!canUndo"
								aria-label="Geri al"
								class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
								@click="grid?.undo()"
							/>
						</template>
						Geri al (Ctrl+Z)
					</AppTooltip>
					<AppTooltip>
						<template #trigger>
							<AppButton
								:size="controlSize"
								icon="redo"
								:disabled="!canRedo"
								aria-label="Yinele"
								class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
								@click="grid?.redo()"
							/>
						</template>
						Yinele (Ctrl+Y)
					</AppTooltip>
					<span class="mx-1 hidden h-5 w-px bg-divider md:block" aria-hidden="true" />
					<AppDropdown :options="importOptions" @select="chooseImport">
						<AppButton
							:size="controlSize"
							:disabled="!sheet"
							:loading="importing"
							class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
						>
							<template #icon><AppIcon name="upload" /></template>
							<span class="hidden md:inline">İçe aktar</span>
							<span class="sr-only md:hidden">İçe aktar</span>
							<AppIcon name="chevronDown" :size="14" class="ml-1 hidden md:block" />
						</AppButton>
					</AppDropdown>
					<AppDropdown :options="exportOptions" @select="chooseExport">
						<AppButton
							:size="controlSize"
							:disabled="!sheet"
							class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
						>
							<template #icon><AppIcon name="download" /></template>
							<span class="hidden md:inline">Dışa aktar</span>
							<span class="sr-only md:hidden">Dışa aktar</span>
							<AppIcon name="chevronDown" :size="14" class="ml-1 hidden md:block" />
						</AppButton>
					</AppDropdown>
					<AppButton
						:size="controlSize"
						class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
						@click="columnsOpen = true"
					>
						<template #icon><AppIcon name="columns" /></template>
						<span class="hidden md:inline">Sütunlar</span>
						<span class="sr-only md:hidden">Sütunlar</span>
					</AppButton>
					<AppDropdown :options="templateOptions" @select="chooseTemplate">
						<AppButton
							:size="controlSize"
							:disabled="!sheet"
							class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
						>
							<template #icon><AppIcon name="template" /></template>
							<span class="hidden md:inline">{{ templateLabel }}</span>
							<span class="sr-only md:hidden">Şablon: {{ templateLabel }}</span>
							<AppIcon name="chevronDown" :size="14" class="ml-1 hidden md:block" />
						</AppButton>
					</AppDropdown>
					<AppDropdown :options="viewOptions" @select="chooseView">
						<AppButton
							:size="controlSize"
							:disabled="!sheet"
							class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
						>
							<template #icon><AppIcon name="views" /></template>
							<span class="hidden md:inline">{{ viewLabel }}</span>
							<span class="sr-only md:hidden">Görünüm: {{ viewLabel }}</span>
							<span v-if="viewModified" class="ml-1.5 hidden text-muted md:inline">· değişti</span>
							<AppIcon name="chevronDown" :size="14" class="ml-1 hidden md:block" />
						</AppButton>
					</AppDropdown>
					<input ref="csvInput" type="file" accept=".csv,text/csv" hidden @change="importChosen" />
				</div>
			</AppScrollbar>

			<TabulaFormulaBar :grid="grid" :theme="theme" :locale="locale" />
		</div>

		<main class="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 md:flex-row md:px-6">
			<div class="min-h-[320px] min-w-0 flex-1">
				<Transition name="fade" mode="out-in">
					<TabulaGrid
						v-if="sheet"
						:key="sheetKey"
						ref="grid"
						v-model:columns="columns"
						v-model:column-widths="widths"
						v-model:filters="filters"
						v-model:sort="sort"
						class="h-full"
						:schema="sheet.schema"
						:store="sheet.store"
						:issues="sheet.session.issues"
						:results="sheet.session.results"
						:history="sheet.history"
						:lookups="sheet.lookups"
						:view="sheet.view"
						:theme="theme"
						:locale="locale"
						:value-settings="valueSettings"
						:row-height="narrow ? 40 : 30"
					/>
					<!-- Only the part that waits spins; the rest of the page is there and works. -->
					<div
						v-else
						class="flex h-full flex-col items-center justify-center gap-3 rounded-app border border-divider bg-surface text-sm text-muted"
						role="status"
					>
						<template v-if="rowsError">
							<span>Satırlar yüklenemedi.</span>
							<AppButton icon="refresh" @click="loadRows">Yeniden dene</AppButton>
						</template>
						<template v-else>
							<AppSpin />
							<span>Tablo hazırlanıyor…</span>
						</template>
					</div>
				</Transition>
			</div>
			<TabulaIssues
				v-if="sheet"
				v-model:only-issue-rows="onlyIssueRows"
				v-model:open="issuesOpen"
				class="md:w-[340px] md:flex-none"
				:variant="narrow ? 'sheet' : 'panel'"
				:issues="sheet.session.issues"
				:schema="sheet.schema"
				:store="sheet.store"
				:theme="theme"
				:locale="locale"
				:value-settings="valueSettings"
				@select="issue => grid?.goTo(issue.rowId!, issue.field)"
				@refresh-rows="sheet.view.refresh()"
			>
				<template v-if="narrow" #actions>
					<AppButton
						type="primary"
						size="large"
						icon="refresh"
						block
						:loading="phase === 'checking'"
						@click="check"
					>
						Yeniden kontrol et
					</AppButton>
				</template>
			</TabulaIssues>
		</main>

		<div class="hidden flex-none border-t border-divider md:block">
			<TabulaStatusBar :grid="grid" :theme="theme" :locale="locale" />
		</div>

		<div class="flex flex-none gap-2 border-t border-divider bg-surface px-4 py-3 md:hidden">
			<AppButton size="large" class="flex-1" :disabled="!sheet" @click="saveDraft">Taslağı kaydet</AppButton>
			<AppButton size="large" class="flex-1" :disabled="!sheet" :loading="phase === 'checking'" @click="check">
				Kontrol et
			</AppButton>
			<AppButton
				size="large"
				type="primary"
				class="flex-1"
				:disabled="!sheet || errors > 0"
				:loading="phase === 'processing'"
				@click="process"
			>
				İşle
			</AppButton>
		</div>

		<AppDrawer v-model:show="columnsOpen">
			<AppDrawerContent title="Sütunlar">
				<ul class="m-0 flex list-none flex-col gap-1 p-0">
					<li
						v-for="field in fields"
						:key="field.key"
						class="flex min-h-11 items-center gap-3 rounded-app px-2 hover:bg-surface-alt"
					>
						<span class="flex-1">{{ field.label }}</span>
						<label class="flex items-center gap-1.5 text-sm text-muted">
							<AppSwitch
								:value="!isHidden(field.key)"
								@update:value="(shown: boolean) => change(field.key, { hidden: !shown })"
							/>
							Göster
						</label>
						<label class="flex items-center gap-1.5 text-sm text-muted">
							<AppSwitch
								:value="isPinned(field.key)"
								@update:value="(pinned: boolean) => change(field.key, { pinned })"
							/>
							Sabitle
						</label>
					</li>
				</ul>
			</AppDrawerContent>
		</AppDrawer>

		<AppModal v-model:show="importOpen" title="İçe aktarma" width="560px">
			<AppModalScrollWrapper>
				<div v-if="imported" class="flex flex-col gap-4">
					<p class="m-0">
						<strong>{{ imported.added }}</strong>
						satır eklendi
						<template v-if="imported.unreadable > 0">
							;
							<strong>{{ imported.unreadable }}</strong>
							hücre okunamadı ve işaretlendi
						</template>
						.
					</p>
					<ul class="m-0 flex list-none flex-col gap-1 p-0">
						<li
							v-for="column in imported.columns"
							:key="column.index"
							class="flex min-h-9 items-center gap-3 rounded-app px-2 odd:bg-surface-alt"
						>
							<span class="flex-1 truncate">{{ column.header || `${column.index + 1}. sütun` }}</span>
							<span
								class="text-sm"
								:class="column.status === 'matched' ? 'text-primary-text' : 'text-muted'"
							>
								{{ columnStatus(column) }}
							</span>
						</li>
					</ul>
					<p v-if="imported.missing.length > 0" class="m-0 text-error">
						Dosyada olmayan zorunlu alanlar: {{ imported.missing.map(labelOf).join(", ") }}
					</p>
				</div>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex justify-end">
					<AppButton type="primary" @click="importOpen = false">Tamam</AppButton>
				</div>
			</template>
		</AppModal>

		<AppModal
			v-model:show="nameOpen"
			:title="naming === 'rename' ? 'Görünümü yeniden adlandır' : 'Yeni görünüm'"
			width="440px"
		>
			<AppModalScrollWrapper>
				<form class="flex flex-col gap-2" @submit.prevent="submitName">
					<label for="view-name" class="text-sm text-muted">
						Sütunlar, genişlikler, süzgeçler ve sıralama bu adla saklanır.
					</label>
					<AppInput
						v-model:value="viewName"
						:input-props="{ id: 'view-name' }"
						:maxlength="VIEW_NAME_LIMIT"
						:status="nameProblemText ? 'error' : undefined"
						placeholder="Örn. Haftalık fiyatlar"
						autofocus
					/>
					<p v-if="nameProblemText" class="m-0 text-sm text-error" role="alert">{{ nameProblemText }}</p>
				</form>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex justify-end gap-2">
					<AppButton @click="nameOpen = false">Vazgeç</AppButton>
					<AppButton type="primary" @click="submitName">Kaydet</AppButton>
				</div>
			</template>
		</AppModal>

		<AppModal v-model:show="removeOpen" title="Görünümü sil" width="440px">
			<AppModalScrollWrapper>
				<p class="m-0">
					“{{ currentView?.name }}” görünümü silinsin mi? Bu geri alınamaz; tablo şimdiki hâliyle kalır.
				</p>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex justify-end gap-2">
					<AppButton @click="removeOpen = false">Vazgeç</AppButton>
					<AppButton type="error" @click="confirmRemove">Sil</AppButton>
				</div>
			</template>
		</AppModal>
	</div>
</template>

<script setup lang="ts">
import {
	VALUE_SETTINGS,
	VIEW_NAME_LIMIT,
	viewNameProblem,
	withColumn,
	type ColumnFilters,
	type ColumnLayout,
	type ColumnSort,
	type ModuleSchemaInput,
	type RowInit,
	type ViewNameProblem
} from "@nouxwell/tabula-core"
import type { TabulaGrid as Grid } from "@nouxwell/tabula-vue"
import { useMessage, type DropdownOption } from "naive-ui"
import { h } from "vue"
import AppIcon from "~/components/atoms/AppIcon.vue"
import { localeMenu, type Locale } from "~/utils/locales"
import type { ImportResult, Sheet } from "~/utils/sheet"
import { FIT_TOOLTIP_STYLE } from "~/utils/tooltip"

// The schema comes with the page: the server draws the title and the shell from it. The rows only
// the grid needs, and the grid is drawn in the browser, so the browser fetches them: in the page's
// payload they would be sent twice.
const { data: input } = await useFetch<ModuleSchemaInput>("/api/modules/price-update")
const {
	data: rows,
	error: rowsError,
	refresh: refreshRows
} = useFetch<RowInit[]>("/api/price-updates/rows", { server: false })
// The templates prepared for the module: small, so they come with the page, and the menu is drawn.
const { data: templates } = await useFetch<readonly { readonly id: string; readonly name: string }[]>(
	"/api/modules/price-update/templates"
)

/** Fetches the rows again after a failure; the button spins until they are in. */
function loadRows(): Promise<void> {
	return refreshRows()
}

const message = useMessage()
const mode = useColorMode()
const dark = computed({
	get: () => mode.value === "dark",
	set: value => (mode.value = value ? "dark" : "light")
})
const theme = computed(() => (dark.value ? "dark" : "light"))
const themeLabel = computed(() => (dark.value ? "Açık temaya geç" : "Koyu temaya geç"))

const locale = ref<Locale>("tr")
const valueSettings = computed(() => VALUE_SETTINGS[locale.value])

const sheet = shallowRef<Sheet | null>(null)
const grid = ref<InstanceType<typeof Grid> | null>(null)
const columns = ref<ColumnLayout>({})
const widths = ref<Readonly<Record<string, number>>>({})
const filters = ref<ColumnFilters>({})
const sort = ref<ColumnSort | null>(null)
const savedViews = useSavedViews({ columns, widths, filters, sort }, locale)
const { views, currentId: viewId, current: currentView, modified: viewModified } = savedViews
const columnsOpen = ref(false)
const onlyIssueRows = ref(false)
const issuesOpen = ref(false)
const csvInput = ref<HTMLInputElement | null>(null)
const importOpen = ref(false)
/** A file being read: the İçe aktar button spins until its rows are in. */
const importing = ref(false)
const imported = shallowRef<ImportResult | null>(null)

/** A phone's width: the issues open as a sheet from the bottom, and buttons are a finger wide. */
const narrow = ref(false)
const controlSize = computed(() => (narrow.value ? "large" : "small"))
let stopMedia: (() => void) | null = null

onMounted(() => {
	const media = window.matchMedia("(max-width: 767px)")
	const follow = () => (narrow.value = media.matches)

	follow()
	media.addEventListener("change", follow)
	stopMedia = () => media.removeEventListener("change", follow)
})

const route = useRoute()
/** The template the sheet works with, by its id in the address: `?template=december-rise`. */
const templateId = computed(() => (typeof route.query.template === "string" ? route.query.template : null))
/** Counts the sheets made, so the grid is made afresh for a new one. */
const sheetKey = ref(0)

/**
 * Makes the sheet with the template the address names, and opens it in the user's default view or
 * the template's arrangement. `carried` rows are the sheet's own, when it is made again for another
 * template: what the user typed stays.
 */
function makeSheet(schemaInput: ModuleSchemaInput, rowList: readonly RowInit[], carried?: readonly RowInit[]): void {
	const template = templates.value?.find(item => item.id === templateId.value) ?? null
	const made = createSheet(
		schemaInput,
		carried ?? rowList,
		locale,
		{ columns, widths },
		{ template, carried: carried !== undefined }
	)

	sheetKey.value++
	sheet.value = made
	savedViews.open(made.schema, made.restored, made.template?.view ?? undefined)

	if (made.templateError) {
		message.error("Şablon uygulanamadı; tablo modül şemasıyla açıldı.")
	}
}

// Made once the rows are in the browser.
watch(
	[input, rows],
	([schemaInput, rowList]) => {
		if (!sheet.value && schemaInput && rowList) {
			makeSheet(schemaInput, rowList)
		}
	},
	{ immediate: true }
)

// Another template: the same rows, under the schema as that template narrows it.
watch(templateId, () => {
	const current = sheet.value

	if (!current || !input.value || !rows.value) {
		return
	}

	const carried = current.store.snapshot()

	current.dispose()
	makeSheet(input.value, rows.value, carried)

	const name = sheet.value?.template?.name

	if (name) {
		message.success(`Tablo «${name}» şablonuyla açıldı.`)
	} else if (!sheet.value?.templateError) {
		message.info("Tablo şablonsuz, modül şemasıyla açıldı.")
	}
})

onBeforeUnmount(() => {
	stopMedia?.()
	sheet.value?.dispose()
})

watch(onlyIssueRows, only => sheet.value?.onlyIssueRows(only))

// Read through the sheet's version, so these follow the parts that keep their own state.
const version = computed(() => sheet.value?.version.value ?? 0)
const canUndo = computed(() => version.value >= 0 && (sheet.value?.history.canUndo ?? false))
const canRedo = computed(() => version.value >= 0 && (sheet.value?.history.canRedo ?? false))
const phase = computed(() => (version.value >= 0 ? sheet.value?.session.state.phase : undefined))
const rowCount = computed(() => (version.value >= 0 ? (sheet.value?.store.size ?? 0) : 0))
const errors = computed(() => (version.value >= 0 ? (grid.value?.issueSummary.errors ?? 0) : 0))

const savedText = computed(() => {
	const state = version.value >= 0 ? sheet.value?.saver.state : undefined

	if (!state || state.status === "unsaved") {
		return state?.savedAt ? `Değişiklikler kaydedilecek · son kayıt ${clock(state.savedAt)}` : "Henüz kaydedilmedi"
	}

	if (state.status === "saving") {
		return "Kaydediliyor…"
	}

	if (state.status === "failed") {
		return "Taslak kaydedilemedi"
	}

	// Saved with nothing ever written: the sheet is as the server sent it.
	return state.savedAt === null ? "Kaydedilecek değişiklik yok" : `Taslak kaydedildi · ${clock(state.savedAt)}`
})

function clock(iso: string): string {
	const date = new Date(iso)

	return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
}

const fields = computed(
	() => input.value?.fields.map(field => ({ key: field.key, label: field.label ?? field.key })) ?? []
)

function isHidden(key: string): boolean {
	return columns.value.hidden?.includes(key) ?? false
}

function isPinned(key: string): boolean {
	return columns.value.pinned?.includes(key) ?? false
}

function change(key: string, what: { hidden?: boolean; pinned?: boolean }): void {
	columns.value = withColumn(columns.value, key, what)
}

function pickLocale(key: string | number): void {
	locale.value = key === "en" ? "en" : "tr"
}

const importOptions: DropdownOption[] = [
	{ label: "CSV dosyası", key: "csv" },
	{ label: "Excel dosyası (sunucuda okunur)", key: "xlsx", disabled: true }
]
const exportOptions: DropdownOption[] = [
	{ label: "CSV dosyası", key: "csv" },
	{ label: "Excel dosyası (sunucuda yazılır)", key: "xlsx", disabled: true }
]

function chooseImport(): void {
	csvInput.value?.click()
}

function chooseExport(): void {
	sheet.value?.exportCsv()
}

async function importChosen(event: Event): Promise<void> {
	const field = event.target as HTMLInputElement
	const file = field.files?.[0]

	field.value = ""

	if (!file || !sheet.value) {
		return
	}

	importing.value = true

	const result = await sheet.value.importCsv(file).finally(() => (importing.value = false))

	if (result.firstRowId) {
		grid.value?.goTo(result.firstRowId)
	}

	imported.value = result
	importOpen.value = true
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
	unknown: "Tanınmadı, alınmadı",
	duplicate: "Aynı alan iki kez, alınmadı",
	read_only: "Elle girilmez, alınmadı",
	skipped: "Alınmadı"
}

/** What became of a column of the file: the field it went to, or why it was left out. */
function columnStatus(column: ImportResult["columns"][number]): string {
	return column.status === "matched" && column.field
		? `→ ${labelOf(column.field)}`
		: (STATUS_TEXT[column.status] ?? "")
}

function labelOf(key: string): string {
	return input.value?.fields.find(field => field.key === key)?.label ?? key
}

// ---------------------------------------------------------------- templates

const templateLabel = computed(() => templates.value?.find(item => item.id === templateId.value)?.name ?? "Şablonsuz")

const templateOptions = computed<DropdownOption[]>(() => {
	const tick = (on: boolean) => (on ? () => h(AppIcon, { name: "tick", size: 16 }) : undefined)

	return [
		{
			type: "group",
			label: "Şablonlar",
			key: "templates",
			children: [
				{ label: "Şablonsuz (modül şeması)", key: "template:", icon: tick(templateId.value === null) },
				...(templates.value ?? []).map(item => ({
					label: item.name,
					key: `template:${item.id}`,
					icon: tick(item.id === templateId.value)
				}))
			]
		}
	]
})

/** Puts the template in the address, so a reload or a shared link opens the sheet with it. */
function chooseTemplate(key: string | number): void {
	const id = String(key).slice("template:".length)

	void navigateTo({ query: { ...route.query, template: id || undefined } }, { replace: true })
}

// ---------------------------------------------------------------- saved views

const viewLabel = computed(() => currentView.value?.name ?? "Standart düzen")

const viewOptions = computed<DropdownOption[]>(() => {
	const tick = (on: boolean) => (on ? () => h(AppIcon, { name: "tick", size: 16 }) : undefined)
	const chosen = currentView.value
	const opensIn = views.value?.defaultId ?? null

	return [
		{
			type: "group",
			label: "Görünümler",
			key: "views",
			children: [
				{ label: "Standart düzen", key: "view:", icon: tick(viewId.value === null) },
				...(views.value?.views ?? []).map(view => ({
					label: view.id === opensIn ? `${view.name} · açılışta` : view.name,
					key: `view:${view.id}`,
					icon: tick(view.id === viewId.value)
				}))
			]
		},
		{ type: "divider", key: "divider" },
		{ label: "Değişiklikleri kaydet", key: "save", disabled: !chosen || !viewModified.value },
		{ label: "Yeni görünüm olarak kaydet…", key: "saveAs" },
		{ label: "Yeniden adlandır…", key: "rename", disabled: !chosen },
		{
			label: chosen && chosen.id === opensIn ? "Açılışta bu görünümle açma" : "Açılışta bu görünümle aç",
			key: "default",
			disabled: !chosen
		},
		{ label: "Görünümü sil…", key: "remove", disabled: !chosen }
	]
})

const nameOpen = ref(false)
const naming = ref<"new" | "rename">("new")
const viewName = ref("")
/** Whether Kaydet was pressed: an empty name is said to be wrong only then. */
const nameTried = ref(false)
const removeOpen = ref(false)

const NAME_TEXT: Readonly<Record<ViewNameProblem, string>> = {
	empty: "Bir ad yazın.",
	too_long: `En çok ${VIEW_NAME_LIMIT} karakter olabilir.`,
	taken: "Bu adda bir görünüm zaten var."
}

const nameProblem = computed(() =>
	views.value
		? viewNameProblem(views.value, viewName.value, {
				except: naming.value === "rename" ? viewId.value : null,
				locale: locale.value
			})
		: null
)
const nameProblemText = computed(() =>
	nameProblem.value && (nameTried.value || nameProblem.value === "taken") ? NAME_TEXT[nameProblem.value] : null
)

function chooseView(key: string | number): void {
	const choice = String(key)

	if (choice.startsWith("view:")) {
		savedViews.show(choice.slice("view:".length) || null)

		return
	}

	if (choice === "save") {
		savedViews.save()
		message.success("Görünüm kaydedildi.")
	} else if (choice === "saveAs" || choice === "rename") {
		naming.value = choice === "rename" ? "rename" : "new"
		viewName.value = choice === "rename" ? (currentView.value?.name ?? "") : ""
		nameTried.value = false
		nameOpen.value = true
	} else if (choice === "default") {
		const opening = currentView.value?.id !== views.value?.defaultId

		savedViews.toggleDefault()
		message.success(
			opening ? "Sayfa bundan sonra bu görünümle açılacak." : "Sayfa bundan sonra standart düzende açılacak."
		)
	} else if (choice === "remove") {
		removeOpen.value = true
	}
}

function submitName(): void {
	nameTried.value = true

	if (nameProblem.value !== null) {
		return
	}

	if (naming.value === "rename") {
		savedViews.rename(viewName.value)
		message.success("Görünüm yeniden adlandırıldı.")
	} else {
		savedViews.saveAs(viewName.value)
		message.success("Görünüm kaydedildi.")
	}

	nameOpen.value = false
}

function confirmRemove(): void {
	const name = currentView.value?.name ?? ""

	savedViews.remove()
	removeOpen.value = false
	message.success(`“${name}” görünümü silindi.`)
}

async function saveDraft(): Promise<void> {
	if (await sheet.value?.saver.save()) {
		message.success("Taslak kaydedildi.")
	}
}

async function check(): Promise<void> {
	const outcome = await sheet.value?.session.check()

	if (outcome?.status === "valid") {
		message.success("Sunucu sorun bulmadı.")
	} else if (outcome?.status === "invalid") {
		message.warning(`Sunucu ${outcome.issues} sorun buldu.`)
	} else if (outcome) {
		message.error("Kontrol yapılamadı.")
	}
}

async function process(): Promise<void> {
	const outcome = await sheet.value?.session.process()

	if (!outcome) {
		return
	}

	if (outcome.status === "blocked") {
		message.warning(`${outcome.blocked} satırda düzeltilmesi gereken hata var.`)
		issuesOpen.value = narrow.value
	} else if (outcome.status === "succeeded" || outcome.status === "partial" || outcome.status === "failed") {
		message.info(`${outcome.succeeded} satır işlendi, ${outcome.failed} satır işlenemedi.`)
	} else if (outcome.status === "nothing") {
		message.info("Gönderilecek satır yok.")
	} else {
		message.error("İşlem yapılamadı.")
	}
}
</script>
