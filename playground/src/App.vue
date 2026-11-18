<script setup lang="ts">
import {
	applyFormulas,
	arrangeColumns,
	csvDelimiterFor,
	decodeText,
	DraftSaver,
	exportTable,
	importTable,
	parseCsv,
	toCsv,
	FormulaEngine,
	LookupResolver,
	ModuleSchema,
	openDraft,
	readDraft,
	RowStore,
	rowsWithIssues,
	RowView,
	SheetChanges,
	SheetSession,
	SheetValidator,
	suggestRenames,
	UndoHistory,
	VALUE_SETTINGS,
	type Draft,
	type ColumnLayout,
	type DraftChanges,
	type DraftOpening,
	type Issue,
	type ProcessOutcome,
	type ProcessPlan,
	type RowId,
	type TableImport
} from "@nouxwell/tabula-core"
import {
	TabulaFormulaBar,
	TabulaGrid,
	TabulaDraftMapping,
	TabulaIssues,
	TabulaPreview,
	TabulaSheetTabs,
	TabulaStatusBar,
	type GridMenuItem,
	type GridTheme,
	type SheetTab
} from "@nouxwell/tabula-vue"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { FakeBackend } from "./backend"
import { clearStoredDraft, loadStoredDraft, storeDraft } from "./drafts"
import { priceUpdate, sampleRows, withChannels } from "./sample"

const params = new URLSearchParams(location.search)
const rowCount = Number(params.get("rows") ?? 10_000)
const initialTheme = params.get("theme")
// `?issues=sheet`: the issues as a phone shows them, a bar that opens a sheet from the bottom.
const issueVariant = params.get("issues") === "sheet" ? "sheet" : "panel"

// `?channels=1`: a multi-select column of sales channels after the others.
const channels = params.get("channels") === "1"
const schema = ModuleSchema.from(channels ? withChannels(priceUpdate) : priceUpdate)

// A draft left from last time is opened, unless the schema has moved on since: then the user sees
// what changed, maps the fields that went, and decides. `accept=1` is that decision, and `rename`
// the mapping, as JSON, both taken from the address once used.
const stored = loadStoredDraft()
let draft: Draft | null = null
let opening: DraftOpening | null = null
let draftProblem: string | null = null

if (stored !== null) {
	try {
		draft = readDraft(stored)
		opening = openDraft(draft, schema, {
			accept: params.get("accept") === "1",
			rename: JSON.parse(params.get("rename") ?? "{}") as Record<string, string>
		})
	} catch (error) {
		draftProblem = error instanceof Error ? error.message : String(error)
	}
}

if (params.has("accept") || params.has("rename")) {
	params.delete("accept")
	params.delete("rename")
	window.history.replaceState(null, "", `${location.pathname}${params.size > 0 ? `?${params}` : ""}`)
}

const opened = opening?.status === "opened" ? opening : null
const review = opening?.status === "review" ? opening.changes : null
/** Where the fields the schema lost go, as the user maps them; the likely renames to start with. */
const draftRename = ref<Readonly<Record<string, string>>>(review && draft ? suggestRenames(draft, schema) : {})
// Formula fields worked out before the store exists: opening the sheet is no change of the user's.
const store = new RowStore({ rows: opened ? opened.rows : applyFormulas(schema, sampleRows(rowCount, { channels })) })
// Keeps them worked out as the sheet changes; what it writes joins the edit's undo step.
const formulas = new FormulaEngine({ schema, store })

const theme = ref<GridTheme>(initialTheme === "dark" || initialTheme === "auto" ? initialTheme : "light")
const language = ref<keyof typeof VALUE_SETTINGS>(params.get("values") === "en" ? "en" : "tr")
const valueSettings = computed(() => VALUE_SETTINGS[language.value])

// One validator for the grid and the panel, so both tell the same story.
const validator = new SheetValidator(schema, store, valueSettings.value)

watch(valueSettings, settings => validator.setSettings(settings))

// The playground's own history, so its buttons know when there is something to undo or redo.
const history = new UndoHistory(store)
const historyVersion = shallowRef(history.version)
const canUndo = computed(() => historyVersion.value >= 0 && history.canUndo)
const canRedo = computed(() => historyVersion.value >= 0 && history.canRedo)

history.subscribe(() => (historyVersion.value = history.version))

// The way to the backend: here a pretend one, in a real application the adapters call its API.
const backend = new FakeBackend()
const session = new SheetSession({
	schema,
	store,
	validator,
	history,
	adapters: backend.adapters,
	pollInterval: 300,
	...(opened ? { restore: opened.session } : {})
})

// Names typed or pasted into the product column become products, many in one request; the editor
// lists the catalog as the user types.
const lookups = new LookupResolver({ schema, store, adapters: backend.lookups })

// The rows on screen: all of them, or only those with issues when the panel's switch says so.
const view = new RowView(store)
// What the user changed since the sheet opened, marked on its cells.
const changes = new SheetChanges({ schema, store })
// The playground's own item in the grid's right-click menu: rounding what is selected.
const menuItems: readonly GridMenuItem[] = [
	{ key: "round", label: "Yuvarla", children: [{ key: "round:1", label: "Tam sayıya" }] }
]

// `?letters=1`: the columns' letters over their headers.
const columnLetters = params.get("letters") === "1"

// `?tabs=1`: the sheet tabs under the sheet, over a list kept here, for their tests.
const showTabs = params.get("tabs") === "1"
const sheetTabs = ref<SheetTab[]>([
	{ id: "a", name: "Fiyat listesi", errors: 2 },
	{ id: "b", name: "Mart", done: true },
	{ id: "c", name: "Mağaza" }
])
const openTab = ref("a")

function addTab(): void {
	const id = `t${sheetTabs.value.length + 1}`

	sheetTabs.value = [...sheetTabs.value, { id, name: `Sayfa ${sheetTabs.value.length + 1}` }]
	openTab.value = id
}

function renameTab(id: string, name: string): void {
	sheetTabs.value = sheetTabs.value.map(tab => (tab.id === id ? { ...tab, name } : tab))
}

function duplicateTab(id: string): void {
	const at = sheetTabs.value.findIndex(tab => tab.id === id)
	const source = sheetTabs.value[at]

	if (source) {
		const copy = { id: `${id}-copy`, name: `${source.name} (kopya)` }

		sheetTabs.value = [...sheetTabs.value.slice(0, at + 1), copy, ...sheetTabs.value.slice(at + 1)]
		openTab.value = copy.id
	}
}

function moveTab(id: string, to: number): void {
	const moving = sheetTabs.value.find(tab => tab.id === id)
	const others = sheetTabs.value.filter(tab => tab.id !== id)

	if (moving) {
		sheetTabs.value = [...others.slice(0, to), moving, ...others.slice(to)]
	}
}

function removeTab(id: string): void {
	sheetTabs.value = sheetTabs.value.filter(tab => tab.id !== id)

	if (openTab.value === id) {
		openTab.value = sheetTabs.value[0]?.id ?? ""
	}
}
const onlyIssueRows = ref(false)
const shownRows = shallowRef(view.size)

view.subscribe(() => (shownRows.value = view.size))
// Named, so it stands beside the column filters the grid sets and goes without them.
watch(onlyIssueRows, only => (only ? view.filter(rowsWithIssues(session.issues), "issues") : view.clear("issues")))

if (opened) {
	void lookups.resolveAll()
}

const widths = ref<Readonly<Record<string, number>>>(opened?.view.columnWidths ?? {})
// The user's columns: hidden, pinned, moved. Kept in the draft with the widths.
const columns = ref<ColumnLayout>(opened?.view.columns ?? {})

// Saves the sheet a second after the user stops changing it. Not while a draft waits to be reviewed
// or could not be read: that would write the sample sheet over it.
const saver =
	review || draftProblem || opening?.status === "wrong_module"
		? null
		: new DraftSaver({
				schema,
				store,
				session,
				save: storeDraft,
				delay: 1000,
				...(opened && draft ? { id: draft.id, name: draft.name } : {}),
				view: () => ({ columnWidths: widths.value, columns: columns.value })
			})
const saverVersion = shallowRef(saver?.version ?? 0)

saver?.subscribe(() => (saverVersion.value = saver.version))
watch([widths, columns], () => saver?.changed())

// A draft opened under a newer schema is saved under it at once, so it is not reviewed again.
if (opened?.changes) {
	void saver?.save()
}

// A save started as the page goes away writes before it is gone.
const flush = (): void => void saver?.flush()

window.addEventListener("pagehide", flush)

function openAnyway(): void {
	params.set("accept", "1")

	if (Object.keys(draftRename.value).length > 0) {
		params.set("rename", JSON.stringify(draftRename.value))
	}

	location.search = params.toString()
}

function startOver(): void {
	saver?.dispose()
	window.removeEventListener("pagehide", flush)
	clearStoredDraft()
	location.reload()
}

// ---------------------------------------------------------------- CSV

const csvInput = ref<HTMLInputElement | null>(null)
/** What the last import brought, for the line that says so. */
const imported = shallowRef<TableImport | null>(null)

/**
 * Reads a CSV file as Excel writes it, in UTF-8 or in Windows-1254, and adds its rows at the end
 * of the sheet as one change: one Ctrl+Z takes the whole import back, product matches included.
 */
async function importCsv(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]

	input.value = ""

	if (!file) {
		return
	}

	const text = decodeText(new Uint8Array(await file.arrayBuffer()))
	const result = importTable(parseCsv(text), { schema, settings: valueSettings.value })

	if (result.rows.length > 0) {
		const first = store.size

		store.transact(() => store.appendRows(result.rows), { origin: "import" })

		const rowId = store.rowIdAt(first)

		if (rowId !== undefined) {
			grid.value?.goTo(rowId)
		}
	}

	imported.value = result
}

/** Writes the rows and columns on screen as the sheet shows them, for Excel in the sheet's language. */
function exportCsv(): void {
	const fields = arrangeColumns(schema.fields, columns.value).fields
	const rowIds = Array.from({ length: view.size }, (_, index) => view.rowIdAt(index) ?? "")
	const settings = valueSettings.value
	const text = toCsv(exportTable({ store, fields, rowIds, settings }), { delimiter: csvDelimiterFor(settings) })
	const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
	const link = document.createElement("a")

	link.href = url
	link.download = `${schema.module}.csv`
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
const sessionVersion = shallowRef(session.version)
const resultVersion = shallowRef(session.results.version)
const lastRun = shallowRef<ProcessOutcome | null>(null)

session.subscribe(() => (sessionVersion.value = session.version))
session.results.subscribe(() => (resultVersion.value = session.results.version))

// The session hands out a new state object on every change, so reading it after the version is enough.
const state = computed(() => {
	void sessionVersion.value

	return session.state
})
const anySucceeded = computed(
	() =>
		resultVersion.value >= 0 &&
		store.rowIds().some(rowId => session.results.resultOf(rowId)?.outcome === "succeeded")
)

const WORDS = {
	tr: {
		undo: "Geri al",
		redo: "Yinele",
		check: "Kontrol et",
		process: "İşle",
		preview: "Önizle",
		stop: "Durdur",
		resend: "Yeniden gönder",
		ask: "Durumu sor",
		removeDone: "İşlenenleri çıkar",
		checking: "Kontrol ediliyor…",
		sending: "Gönderiliyor…",
		running: "İşleniyor",
		unknown: "Yanıt gelmedi; işlemin sonucu bilinmiyor. Aynı isteği yeniden gönderin ya da durumu sorun.",
		valid: "Ön kontrol temiz.",
		invalid: "Ön kontrol sorun buldu.",
		checkFailed: "Ön kontrol yapılamadı",
		cancelled: "Durduruldu.",
		blocked: "Hatalar giderilmeden işlenemez",
		nothing: "Gönderilecek satır yok.",
		result: (o: ProcessOutcome) => `${o.succeeded} başarılı, ${o.failed} başarısız, ${o.skipped} işlenmedi.`,
		saved: "Taslak kaydedildi",
		unsaved: "Kaydedilmemiş değişiklik var",
		saving: "Taslak kaydediliyor…",
		failed: "Taslak kaydedilemedi",
		saveDraft: "Taslağı kaydet",
		startOver: "Yeni sayfa",
		importCsv: "CSV içe aktar",
		exportCsv: "CSV dışa aktar",
		imported: (result: TableImport, label: (key: string) => string) =>
			[
				`${result.rows.length} satır içe aktarıldı.`,
				listed("Eşleşmeyen kolonlar", result, "unknown"),
				listed("Salt okunur kolonlar atlandı", result, "read_only"),
				result.unreadable > 0 ? `${result.unreadable} hücre okunamadı; işaretlendi.` : "",
				result.missing.length > 0 ? `Eksik zorunlu alanlar: ${result.missing.map(label).join(", ")}.` : ""
			]
				.filter(Boolean)
				.join(" "),
		openAnyway: "Taslağı yine de aç",
		discard: "Taslağı at",
		unreadable: "Kayıtlı taslak okunamadı.",
		otherModule: "Kayıtlı taslak başka bir modülün.",
		changes: (c: DraftChanges) =>
			[
				`Bu taslak şemanın ${c.fromVersion}. sürümüyle kaydedilmiş; şimdiki sürüm ${c.toVersion}.`,
				c.added.length > 0 ? `Yeni alanlar boş açılacak: ${c.added.join(", ")}.` : "",
				c.removed.length > 0
					? `Kaldırılan alanlar: ${c.removed.join(", ")}; ${c.losing} satırdaki değerleri atılacak.`
					: "",
				c.retyped.length > 0
					? `Türü değişen alanlar yeniden kontrol edilecek: ${c.retyped.map(field => field.key).join(", ")}.`
					: ""
			]
				.filter(Boolean)
				.join(" ")
	},
	en: {
		undo: "Undo",
		redo: "Redo",
		check: "Check",
		process: "Process",
		preview: "Preview",
		stop: "Stop",
		resend: "Send again",
		ask: "Ask status",
		removeDone: "Remove processed",
		checking: "Checking…",
		sending: "Sending…",
		running: "Processing",
		unknown: "No answer came; the outcome is unknown. Send the same request again, or ask how it went.",
		valid: "The check found nothing.",
		invalid: "The check found issues.",
		checkFailed: "The check could not be made",
		cancelled: "Stopped.",
		blocked: "Fix the errors before processing",
		nothing: "No rows to send.",
		result: (o: ProcessOutcome) => `${o.succeeded} processed, ${o.failed} failed, ${o.skipped} not processed.`,
		saved: "Draft saved",
		unsaved: "Unsaved changes",
		saving: "Saving the draft…",
		failed: "The draft could not be saved",
		saveDraft: "Save draft",
		startOver: "New sheet",
		importCsv: "Import CSV",
		exportCsv: "Export CSV",
		imported: (result: TableImport, label: (key: string) => string) =>
			[
				`${result.rows.length} rows imported.`,
				listed("Columns not matched", result, "unknown"),
				listed("Read-only columns passed over", result, "read_only"),
				result.unreadable > 0 ? `${result.unreadable} cells could not be read; they are marked.` : "",
				result.missing.length > 0 ? `Required fields missing: ${result.missing.map(label).join(", ")}.` : ""
			]
				.filter(Boolean)
				.join(" "),
		openAnyway: "Open the draft anyway",
		discard: "Discard the draft",
		unreadable: "The saved draft could not be read.",
		otherModule: "The saved draft is of another module.",
		changes: (c: DraftChanges) =>
			[
				`This draft was saved with version ${c.fromVersion} of the schema; it is now version ${c.toVersion}.`,
				c.added.length > 0 ? `New fields open empty: ${c.added.join(", ")}.` : "",
				c.removed.length > 0
					? `Removed fields: ${c.removed.join(", ")}; their values in ${c.losing} rows are dropped.`
					: "",
				c.retyped.length > 0
					? `Fields of another type are checked again: ${c.retyped.map(field => field.key).join(", ")}.`
					: ""
			]
				.filter(Boolean)
				.join(" ")
	}
} as const

const words = computed(() => WORDS[language.value])

/** "Title: a, b." for the columns of an import in one state; nothing when there are none. */
function listed(title: string, result: TableImport, status: string): string {
	const headers = result.columns.filter(column => column.status === status).map(column => column.header)

	return headers.length > 0 ? `${title}: ${headers.join(", ")}.` : ""
}

const importNotice = computed(() =>
	imported.value ? words.value.imported(imported.value, key => schema.field(key).label) : ""
)

/** One line on where the sheet stands with the backend. */
const status = computed(() => {
	const now = state.value
	const run = now.run
	const text = words.value

	if (now.phase === "checking") {
		return text.checking
	}

	if (now.phase === "processing") {
		return run?.progress ? `${text.running} ${run.progress.done}/${run.progress.total}…` : text.sending
	}

	if (now.phase === "unknown") {
		return text.unknown
	}

	if (lastRun.value) {
		const outcome = lastRun.value

		if (outcome.status === "blocked") {
			return `${text.blocked} (${outcome.blocked}).`
		}

		return outcome.status === "nothing" ? text.nothing : text.result(outcome)
	}

	if (now.failure) {
		return `${text.checkFailed}: ${now.failure.message}`
	}

	if (now.check) {
		return now.check.outcome === "cancelled"
			? text.cancelled
			: now.check.outcome === "valid"
				? text.valid
				: text.invalid
	}

	return ""
})

/** One line on the draft: saved when, or what stops it being saved. */
const draftStatus = computed(() => {
	void saverVersion.value

	const text = words.value
	const now = saver?.state

	if (!now) {
		return ""
	}

	if (now.status === "saved" && now.savedAt) {
		return `${text.saved} · ${new Date(now.savedAt).toLocaleTimeString(language.value === "en" ? "en-GB" : "tr-TR")}`
	}

	if (now.status === "failed") {
		return `${text.failed}: ${now.failure?.message ?? ""}`
	}

	return now.status === "saving" ? text.saving : now.status === "unsaved" ? text.unsaved : ""
})

/** Why the stored draft was not opened, when it was not. */
const draftNotice = computed(() => {
	const text = words.value

	if (review) {
		return text.changes(review)
	}

	if (draftProblem) {
		return text.unreadable
	}

	return opening?.status === "wrong_module" ? text.otherModule : ""
})

async function check(): Promise<void> {
	lastRun.value = null
	await session.check()
}

async function process(): Promise<void> {
	lastRun.value = null

	const outcome = await session.process()

	lastRun.value = outcome.status === "unknown" ? null : outcome
}

/** What a run would do, by a check made for it when the last one no longer says. */
const plan = shallowRef<ProcessPlan | null>(null)

async function preview(): Promise<void> {
	lastRun.value = null

	if (!session.plan().current) {
		await session.check()
	}

	plan.value = session.plan()
}

function showPlanned(rowId: RowId): void {
	plan.value = null
	grid.value?.goTo(rowId)
}

/** The playground's own menu item, by its key: rounding the numbers selected. */
function onMenu(key: string): void {
	if (key.startsWith("round:")) {
		grid.value?.adjustSelection({ kind: "round", step: key.slice("round:".length) })
	}
}

async function ask(): Promise<void> {
	const outcome = await session.refresh()

	lastRun.value = outcome.status === "unknown" ? null : outcome
}

onBeforeUnmount(() => {
	window.removeEventListener("pagehide", flush)
	saver?.dispose()
	lookups.dispose()
	formulas.dispose()
	view.dispose()
	changes.dispose()
	session.dispose()
	validator.dispose()
	history.dispose()
})

const grid = ref<InstanceType<typeof TabulaGrid> | null>(null)
const revision = shallowRef(store.revision)
const size = shallowRef(store.size)
const position = shallowRef("")

store.subscribe(change => {
	revision.value = change.revision
	size.value = store.size
})

const dark = computed(() => theme.value === "dark")

function goTo(issue: Issue): void {
	if (issue.rowId !== null) {
		grid.value?.goTo(issue.rowId, issue.field)
	}
}

onMounted(() => {
	const selection = grid.value?.selection

	if (!selection) {
		return
	}

	const describe = (): void => {
		const range = selection.range

		position.value = range ? `R${range.top + 1}C${range.left + 1}:R${range.bottom + 1}C${range.right + 1}` : ""
	}

	selection.subscribe(describe)
	describe()

	window.__playground = {
		schema,
		store,
		selection,
		validator,
		history,
		session,
		backend,
		saver,
		lookups,
		formulas,
		view,
		changes,
		adjust: adjustment => grid.value?.adjustSelection(adjustment) ?? 0,
		position: () => grid.value?.position() ?? null,
		restorePosition: position => grid.value?.restorePosition(position),
		widths: () => widths.value,
		columns: () => columns.value
	}
	grid.value?.focus()
})
</script>

<template>
	<div class="playground" :class="{ 'is-dark': dark }">
		<header class="playground-bar">
			<strong>{{ schema.title }}</strong>
			<span class="playground-buttons">
				<button type="button" class="playground-undo" :disabled="!canUndo" title="Ctrl+Z" @click="grid?.undo()">
					{{ words.undo }}
				</button>
				<button type="button" class="playground-redo" :disabled="!canRedo" title="Ctrl+Y" @click="grid?.redo()">
					{{ words.redo }}
				</button>
			</span>
			<span class="playground-size">
				{{ onlyIssueRows ? `${shownRows.toLocaleString("tr-TR")} / ` : ""
				}}{{ size.toLocaleString("tr-TR") }} satır
			</span>
			<span>Seçim {{ position }}</span>
			<span>Sürüm {{ revision }}</span>
			<label>
				Tema
				<select v-model="theme">
					<option value="light">Açık</option>
					<option value="dark">Koyu</option>
					<option value="auto">Sistem</option>
				</select>
			</label>
			<label>
				Dil ve biçim
				<select v-model="language">
					<option value="tr">Türkçe</option>
					<option value="en">English</option>
				</select>
			</label>
		</header>
		<div class="playground-bar playground-run">
			<span class="playground-buttons">
				<button
					type="button"
					class="playground-check"
					:disabled="state.phase === 'processing' || state.phase === 'unknown'"
					@click="check"
				>
					{{ words.check }}
				</button>
				<button type="button" class="playground-process" :disabled="state.phase !== 'idle'" @click="process">
					{{ words.process }}
				</button>
				<button
					type="button"
					class="playground-preview-open"
					:disabled="state.phase !== 'idle'"
					@click="preview"
				>
					{{ words.preview }}
				</button>
				<button
					v-if="state.phase === 'checking' || state.phase === 'processing'"
					type="button"
					class="playground-stop"
					@click="session.cancel()"
				>
					{{ words.stop }}
				</button>
				<template v-if="state.phase === 'unknown'">
					<button type="button" class="playground-resend" @click="process">{{ words.resend }}</button>
					<button type="button" class="playground-ask" @click="ask">{{ words.ask }}</button>
				</template>
				<button
					v-if="anySucceeded && state.phase === 'idle'"
					type="button"
					class="playground-remove-done"
					@click="session.removeSucceeded()"
				>
					{{ words.removeDone }}
				</button>
			</span>
			<span class="playground-status" role="status">{{ status }}</span>
			<span class="playground-buttons playground-draft-buttons">
				<button v-if="saver" type="button" class="playground-save" @click="saver.save()">
					{{ words.saveDraft }}
				</button>
				<button type="button" class="playground-start-over" @click="startOver">{{ words.startOver }}</button>
				<button type="button" class="playground-import" @click="csvInput?.click()">
					{{ words.importCsv }}
				</button>
				<input
					ref="csvInput"
					class="playground-import-file"
					type="file"
					accept=".csv,text/csv"
					hidden
					@change="importCsv"
				/>
				<button type="button" class="playground-export" @click="exportCsv">{{ words.exportCsv }}</button>
			</span>
			<span class="playground-draft" role="status">{{ draftStatus }}</span>
		</div>
		<div v-if="importNotice" class="playground-imported" role="status">
			<span>{{ importNotice }}</span>
			<button type="button" class="playground-imported-close" @click="imported = null">×</button>
		</div>
		<div v-if="draftNotice" class="playground-draft-review" role="alert">
			<span>{{ draftNotice }}</span>
			<button v-if="review" type="button" class="playground-open-anyway" @click="openAnyway">
				{{ words.openAnyway }}
			</button>
			<button type="button" class="playground-discard" @click="startOver">{{ words.discard }}</button>
			<TabulaDraftMapping
				v-if="review && draft"
				v-model:rename="draftRename"
				class="playground-mapping"
				:draft="draft"
				:schema="schema"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
			/>
		</div>
		<div v-if="plan" class="playground-preview">
			<TabulaPreview
				:session="session"
				:plan="plan"
				name-field="productId"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
				@select="showPlanned"
			/>
			<button type="button" class="playground-preview-close" @click="plan = null">×</button>
		</div>
		<TabulaFormulaBar :grid="grid" :theme="theme" :locale="language" />
		<main class="playground-main" :class="{ 'is-sheet': issueVariant === 'sheet' }">
			<TabulaGrid
				ref="grid"
				v-model:column-widths="widths"
				v-model:columns="columns"
				class="playground-grid"
				:schema="schema"
				:store="store"
				:issues="session.issues"
				:results="session.results"
				:history="history"
				:lookups="lookups"
				:view="view"
				:changes="changes"
				:column-letters="columnLetters"
				:menu-items="menuItems"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
				@menu="onMenu"
			/>
			<TabulaIssues
				v-model:only-issue-rows="onlyIssueRows"
				class="playground-issues"
				:issues="session.issues"
				:schema="schema"
				:store="store"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
				:variant="issueVariant"
				@select="goTo"
				@refresh-rows="view.refresh()"
			/>
		</main>
		<TabulaSheetTabs
			v-if="showTabs"
			v-model:active="openTab"
			class="playground-tabs"
			:tabs="sheetTabs"
			:theme="theme"
			:locale="language"
			@add="addTab"
			@rename="renameTab"
			@duplicate="duplicateTab"
			@remove="removeTab"
			@move="moveTab"
		/>
		<TabulaStatusBar class="playground-statusbar" :grid="grid" :theme="theme" :locale="language" />
	</div>
</template>

<style>
html,
body,
#app {
	height: 100%;
	margin: 0;
}

body {
	font-family: system-ui, "Segoe UI", sans-serif;
}

.playground {
	display: flex;
	flex-direction: column;
	gap: 10px;
	box-sizing: border-box;
	height: 100%;
	padding: 12px 16px 16px;
	background: #f5f6f9;
	color: #161922;
}

.playground.is-dark {
	background: #111318;
	color: #e7e9f0;
}

.playground-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 18px;
	align-items: center;
	font-size: 13px;
}

.playground-buttons {
	display: inline-flex;
	gap: 6px;
}

.playground-status,
.playground-draft {
	color: inherit;
	opacity: 0.8;
}

.playground-draft-buttons {
	margin-left: auto;
}

.playground-imported {
	display: flex;
	gap: 12px;
	align-items: center;
	padding: 6px 12px;
	border: 1px solid #9fc3a8;
	border-radius: 4px;
	background: #e9f6ec;
	color: #1d4a2a;
	font-size: 13px;
}

.playground-imported button {
	margin-left: auto;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.playground-preview {
	position: relative;
	max-height: 40vh;
	padding: 10px 44px 10px 12px;
	overflow: auto;
	border: 1px solid #d5d9df;
	border-radius: 4px;
}

.playground-preview-close {
	position: absolute;
	top: 6px;
	right: 8px;
	border: 0;
	background: transparent;
	font: inherit;
	font-size: 18px;
	cursor: pointer;
}

.playground-draft-review {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 12px;
	align-items: center;
	padding: 8px 12px;
	border: 1px solid #e0b252;
	border-radius: 4px;
	background: #fdf3dc;
	color: #4d3800;
	font-size: 13px;
}

.playground-mapping {
	flex-basis: 100%;
	max-height: 40vh;
	padding: 10px 12px;
	overflow: auto;
	border-radius: 4px;
	background: #ffffff;
	color: #000000;
	font-size: 13px;
}

.playground-main {
	display: grid;
	flex: 1;
	grid-template-columns: minmax(0, 1fr) 320px;
	gap: 12px;
	min-height: 0;
}

.playground-grid,
.playground-issues {
	min-height: 0;
}

/* The issues as a phone shows them: the sheet takes the width, the bar sits under it. */
.playground-main.is-sheet {
	grid-template-columns: minmax(0, 1fr);
	grid-template-rows: minmax(0, 1fr) auto;
}

.playground-statusbar {
	border: 1px solid var(--tabula-head-line, #d6dae4);
	border-radius: 6px;
}
</style>
