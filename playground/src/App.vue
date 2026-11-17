<script setup lang="ts">
import {
	DraftSaver,
	ModuleSchema,
	openDraft,
	readDraft,
	RowStore,
	SheetSession,
	SheetValidator,
	UndoHistory,
	VALUE_SETTINGS,
	type Draft,
	type DraftChanges,
	type DraftOpening,
	type Issue,
	type ProcessOutcome
} from "@nouxwell/tabula-core"
import { TabulaGrid, TabulaIssues, type GridTheme } from "@nouxwell/tabula-vue"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { FakeBackend } from "./backend"
import { clearStoredDraft, loadStoredDraft, storeDraft } from "./drafts"
import { priceUpdate, sampleRows } from "./sample"

const params = new URLSearchParams(location.search)
const rowCount = Number(params.get("rows") ?? 10_000)
const initialTheme = params.get("theme")

const schema = ModuleSchema.from(priceUpdate)

// A draft left from last time is opened, unless the schema has moved on since: then the user sees
// what changed and decides. `accept=1` is that decision, taken from the address once it is used.
const stored = loadStoredDraft()
let draft: Draft | null = null
let opening: DraftOpening | null = null
let draftProblem: string | null = null

if (stored !== null) {
	try {
		draft = readDraft(stored)
		opening = openDraft(draft, schema, { accept: params.get("accept") === "1" })
	} catch (error) {
		draftProblem = error instanceof Error ? error.message : String(error)
	}
}

if (params.has("accept")) {
	params.delete("accept")
	window.history.replaceState(null, "", `${location.pathname}${params.size > 0 ? `?${params}` : ""}`)
}

const opened = opening?.status === "opened" ? opening : null
const review = opening?.status === "review" ? opening.changes : null
const store = new RowStore({ rows: opened ? opened.rows : sampleRows(rowCount) })

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

const widths = ref<Readonly<Record<string, number>>>(opened?.view.columnWidths ?? {})

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
				view: () => ({ columnWidths: widths.value })
			})
const saverVersion = shallowRef(saver?.version ?? 0)

saver?.subscribe(() => (saverVersion.value = saver.version))
watch(widths, () => saver?.changed())

// A draft opened under a newer schema is saved under it at once, so it is not reviewed again.
if (opened?.changes) {
	void saver?.save()
}

// A save started as the page goes away writes before it is gone.
const flush = (): void => void saver?.flush()

window.addEventListener("pagehide", flush)

function openAnyway(): void {
	params.set("accept", "1")
	location.search = params.toString()
}

function startOver(): void {
	saver?.dispose()
	window.removeEventListener("pagehide", flush)
	clearStoredDraft()
	location.reload()
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

async function ask(): Promise<void> {
	const outcome = await session.refresh()

	lastRun.value = outcome.status === "unknown" ? null : outcome
}

onBeforeUnmount(() => {
	window.removeEventListener("pagehide", flush)
	saver?.dispose()
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
		widths: () => widths.value
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
			<span>{{ size.toLocaleString("tr-TR") }} satır</span>
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
			</span>
			<span class="playground-draft" role="status">{{ draftStatus }}</span>
		</div>
		<div v-if="draftNotice" class="playground-draft-review" role="alert">
			<span>{{ draftNotice }}</span>
			<button v-if="review" type="button" class="playground-open-anyway" @click="openAnyway">
				{{ words.openAnyway }}
			</button>
			<button type="button" class="playground-discard" @click="startOver">{{ words.discard }}</button>
		</div>
		<main class="playground-main">
			<TabulaGrid
				ref="grid"
				v-model:column-widths="widths"
				class="playground-grid"
				:schema="schema"
				:store="store"
				:issues="session.issues"
				:results="session.results"
				:history="history"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
			/>
			<TabulaIssues
				class="playground-issues"
				:issues="session.issues"
				:schema="schema"
				:store="store"
				:theme="theme"
				:locale="language"
				:value-settings="valueSettings"
				@select="goTo"
			/>
		</main>
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
</style>
