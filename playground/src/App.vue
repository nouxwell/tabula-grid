<script setup lang="ts">
import {
	ModuleSchema,
	RowStore,
	SheetSession,
	SheetValidator,
	UndoHistory,
	VALUE_SETTINGS,
	type Issue,
	type ProcessOutcome
} from "@nouxwell/tabula-core"
import { TabulaGrid, TabulaIssues, type GridTheme } from "@nouxwell/tabula-vue"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { FakeBackend } from "./backend"
import { priceUpdate, sampleRows } from "./sample"

const params = new URLSearchParams(location.search)
const rowCount = Number(params.get("rows") ?? 10_000)
const initialTheme = params.get("theme")

const schema = ModuleSchema.from(priceUpdate)
const store = new RowStore({ rows: sampleRows(rowCount) })

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
const session = new SheetSession({ schema, store, validator, history, adapters: backend.adapters, pollInterval: 300 })
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
		result: (o: ProcessOutcome) => `${o.succeeded} başarılı, ${o.failed} başarısız, ${o.skipped} işlenmedi.`
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
		result: (o: ProcessOutcome) => `${o.succeeded} processed, ${o.failed} failed, ${o.skipped} not processed.`
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
	session.dispose()
	validator.dispose()
	history.dispose()
})

const widths = ref<Readonly<Record<string, number>>>({})
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

.playground-status {
	color: inherit;
	opacity: 0.8;
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
