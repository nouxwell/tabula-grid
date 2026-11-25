<template>
	<component :is="narrow ? AppDrawer : AppModal" v-model:show="show" v-bind="frame">
		<component :is="narrow ? AppDrawerContent : AppModalScrollWrapper" v-bind="inner">
			<div class="flex flex-col gap-4">
				<!-- Where the work stands: checked, looked over, sent. -->
				<ol class="m-0 flex list-none items-center gap-2 p-0 text-[13px] text-muted" aria-label="Adımlar">
					<template v-for="(item, index) in STEPS" :key="item.key">
						<li v-if="index > 0" class="h-px w-5 bg-divider" aria-hidden="true" />
						<li
							class="flex items-center gap-1.5"
							:class="stepState(index) === 'on' ? 'font-semibold text-text' : ''"
							:aria-current="stepState(index) === 'on' ? 'step' : undefined"
						>
							<span
								class="flex size-5 items-center justify-center rounded-full text-xs font-bold transition-colors duration-200"
								:class="
									stepState(index) === 'done'
										? 'bg-primary/10 text-primary-text'
										: stepState(index) === 'on'
											? 'bg-primary-text text-surface'
											: 'bg-divider/60 text-muted'
								"
							>
								<AppIcon v-if="stepState(index) === 'done'" name="tick" :size="13" />
								<template v-else>{{ index + 1 }}</template>
							</span>
							{{ item.label }}
						</li>
					</template>
				</ol>

				<Transition name="fade" mode="out-in">
					<p v-if="step === 'checking'" key="checking" class="m-0 text-sm text-muted">
						Sayfalar denetleniyor. Siz onaylayana kadar hiçbir şey gönderilmez.
					</p>
					<p v-else-if="step === 'review'" key="review" class="m-0 text-sm text-muted">
						{{ entries.length }} sayfa denetlendi. Siz onaylayana kadar hiçbir şey gönderilmez; bir sayfayı
						açınca önizlemesi görünür.
					</p>
					<div v-else-if="step === 'running'" key="running" class="flex flex-col gap-2" role="status">
						<div class="flex justify-between text-[13px] text-muted">
							<span>Sayfa {{ Math.min(runIndex + 1, sendable.length) }} / {{ sendable.length }}</span>
							<span>
								<AppNumberAnimation :to="sentRows" locale="tr-TR" />
								/ {{ totalRows }} satır
							</span>
						</div>
						<div class="h-1.5 overflow-hidden rounded-full bg-divider/60">
							<div
								class="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
								:style="{ width: `${progress}%` }"
							/>
						</div>
					</div>
					<div v-else key="done" class="grid grid-cols-3 gap-2.5">
						<div class="flex flex-col rounded-app border border-divider bg-surface-alt px-3.5 py-3">
							<strong class="font-display text-2xl text-primary-text tabular-nums">
								<AppNumberAnimation :to="doneRows" locale="tr-TR" />
							</strong>
							<span class="text-[13px] text-muted">satır uygulandı</span>
						</div>
						<div class="flex flex-col rounded-app border border-divider bg-surface-alt px-3.5 py-3">
							<strong
								class="font-display text-2xl tabular-nums"
								:class="refusedRows > 0 ? 'text-error' : ''"
							>
								<AppNumberAnimation :to="refusedRows" locale="tr-TR" />
							</strong>
							<span class="text-[13px] text-muted">satır reddedildi</span>
						</div>
						<div class="flex flex-col rounded-app border border-divider bg-surface-alt px-3.5 py-3">
							<strong class="font-display text-2xl tabular-nums">
								<AppNumberAnimation :to="heldSheets" locale="tr-TR" />
							</strong>
							<span class="text-[13px] text-muted">sayfa bekletildi</span>
						</div>
					</div>
				</Transition>

				<!-- Each sheet: where it stands, what it would send, and its preview. -->
				<section class="flex flex-col gap-2" aria-label="Sayfalar">
					<h3 class="m-0 text-[13px] font-semibold text-muted">Sayfalar</h3>
					<ul class="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-divider p-0">
						<li v-for="entry in entries" :key="entry.id" class="border-divider not-first:border-t">
							<div class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
								<span
									class="flex size-6 flex-none items-center justify-center rounded-full"
									:class="TONES[tone(entry)]"
								>
									<span
										v-if="busy(entry)"
										class="size-4 animate-spin rounded-full border-2 border-divider border-t-primary motion-reduce:animate-none"
										aria-label="Sürüyor"
									/>
									<AppIcon v-else :name="ICONS[tone(entry)]" :size="14" />
								</span>
								<span class="flex min-w-0 flex-1 basis-[55%] flex-col">
									<strong class="truncate" :class="tone(entry) === 'idle' ? 'text-muted' : ''">
										{{ entry.name }}
									</strong>
									<Transition name="fade" mode="out-in">
										<span :key="detail(entry)" class="text-[13px] text-muted">
											{{ detail(entry) }}
										</span>
									</Transition>
								</span>
								<span
									v-if="pill(entry) || action(entry)"
									class="flex flex-none items-center gap-2 max-md:ml-9"
								>
									<span
										v-if="pill(entry)"
										class="flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
										:class="TONES[tone(entry)]"
									>
										{{ pill(entry) }}
									</span>
									<AppButton
										v-if="action(entry)"
										text
										type="primary"
										class="flex-none"
										@click="go(entry.id, action(entry) === 'issues')"
									>
										{{ action(entry) === "issues" ? "Reddedilenleri aç" : "Sayfaya git" }}
									</AppButton>
								</span>
								<AppButton
									v-if="step === 'review' && plans.get(entry.id) && sendableIds.has(entry.id)"
									quaternary
									:icon="entry.expanded ? 'chevronUp' : 'chevronDown'"
									:aria-label="`${entry.name} önizlemesini ${entry.expanded ? 'kapat' : 'aç'}`"
									:aria-expanded="entry.expanded"
									@click="entry.expanded = !entry.expanded"
								/>
							</div>
							<Transition name="fade">
								<div
									v-if="
										step === 'review' &&
										entry.expanded &&
										plans.get(entry.id) &&
										sheets.get(entry.id)
									"
									class="border-t border-divider bg-surface-alt px-3.5 py-3"
								>
									<AppScrollbar style="max-height: 320px">
										<TabulaPreview
											:session="sheets.get(entry.id)!.sheet.session"
											:plan="plans.get(entry.id)!"
											name-field="productId"
											:theme="theme"
											:locale="locale"
											:value-settings="valueSettings"
											:limit="20"
											@select="rowId => go(entry.id, false, rowId)"
										/>
									</AppScrollbar>
								</div>
							</Transition>
						</li>
					</ul>
				</section>

				<!-- A product two sheets would send differently: the user says which goes, or neither. -->
				<Transition name="fade-up">
					<section
						v-if="step === 'review' && conflicts.length > 0"
						class="flex flex-col gap-2"
						aria-label="Aynı ürün iki sayfada"
					>
						<h3 class="m-0 text-[13px] font-semibold text-muted">
							Aynı ürün birden çok sayfada · {{ conflicts.length }} ürün
						</h3>
						<div class="overflow-hidden rounded-xl border border-warning/40 bg-warning/5">
							<div class="flex items-start gap-2.5 px-3.5 py-3">
								<AppIcon name="alert" :size="18" class="mt-0.5 flex-none text-warning-text" />
								<div class="flex flex-col gap-0.5">
									<strong>Hangi sayfadaki değer geçsin?</strong>
									<span class="text-[13px] text-muted">
										Bu ürünler sayfalarda farklı değerlerle duruyor. Seçmediğiniz ürün hiçbir
										sayfadan gönderilmez ve sayfasında kalır.
									</span>
								</div>
							</div>
							<div
								v-for="record in conflicts"
								:key="record.key"
								class="flex flex-col gap-2 border-t border-warning/25 px-3.5 py-2.5 md:flex-row md:items-center md:gap-3"
							>
								<strong class="md:w-36 md:flex-none">{{ record.label }}</strong>
								<span class="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1 text-[13px]">
									<span v-for="row in record.rows" :key="row.sheetId" class="flex flex-col">
										<span class="tabular-nums">{{ shown(row, record.differs) }}</span>
										<span class="text-xs text-muted">
											{{ nameOf(row.sheetId) }}
											<template v-if="changedIn(row, record.differs)">· değiştirdiniz</template>
										</span>
									</span>
								</span>
								<div class="md:w-56 md:flex-none">
									<AppSelect
										:value="choices[record.key] ?? ''"
										:options="choiceOptions(record)"
										:aria-label="`${record.label} için geçen sayfa`"
										@update:value="(value: string) => (choices[record.key] = value)"
									/>
								</div>
							</div>
						</div>
					</section>
				</Transition>

				<!-- What happens next, and the way to it. -->
				<div
					class="sticky bottom-0 -mx-px flex flex-wrap items-center gap-2.5 border-t border-divider bg-surface pt-3.5 pb-1"
				>
					<span class="flex min-w-0 flex-1 flex-col max-md:basis-full">
						<strong v-if="step === 'review'">
							{{ sendable.length }} sayfa, {{ totalRows.toLocaleString("tr-TR") }} satır uygulanacak
						</strong>
						<span class="text-[13px] text-muted">{{ footNote }}</span>
					</span>
					<template v-if="step === 'checking' || step === 'review'">
						<AppButton :size="narrow ? 'large' : 'medium'" class="max-md:flex-1" @click="show = false">
							Vazgeç
						</AppButton>
						<AppButton
							type="primary"
							icon="play"
							:size="narrow ? 'large' : 'medium'"
							:disabled="step !== 'review' || totalRows === 0"
							:loading="step === 'checking'"
							@click="run"
						>
							{{ totalRows.toLocaleString("tr-TR") }} satırı uygula
						</AppButton>
					</template>
					<AppButton
						v-else-if="step === 'running'"
						:size="narrow ? 'large' : 'medium'"
						:disabled="stopping"
						@click="stopping = true"
					>
						{{ stopping ? "Bu sayfadan sonra duracak" : "Durdur" }}
					</AppButton>
					<template v-else>
						<AppButton
							icon="download"
							:size="narrow ? 'large' : 'medium'"
							:disabled="issueRows === 0"
							@click="downloadIssues"
						>
							Hatalı satırları indir ({{ issueRows }})
						</AppButton>
						<AppButton type="primary" :size="narrow ? 'large' : 'medium'" @click="show = false">
							Kapat
						</AppButton>
					</template>
				</div>
			</div>
		</component>
	</component>
</template>

<script setup lang="ts">
/**
 * "Tüm sayfaları uygula": every sheet of the workbook checked first, looked over with what each
 * would send, a product two sheets disagree on asked about, then the sheets sent one after another
 * in tab order. A sheet with an error is held back; the others go. Nothing is sent before the user
 * says so. A phone has it as a sheet of the whole screen.
 */
import {
	formatCell,
	sharedRecords,
	type ProcessPlan,
	type RowId,
	type SharedRecord,
	type SharedRecordRow,
	type ValueSettings
} from "@nouxwell/tabula-core"
import type { GridLocale, GridTheme } from "@nouxwell/tabula-vue"
import { useMessage } from "naive-ui"
import AppDrawer from "~/components/atoms/AppDrawer.vue"
import AppDrawerContent from "~/components/atoms/AppDrawerContent.vue"
import type { IconName } from "~/components/atoms/AppIcon.vue"
import AppModal from "~/components/atoms/AppModal.vue"
import AppModalScrollWrapper from "~/components/atoms/AppModalScrollWrapper.vue"
import { downloadCsv, type Sheet } from "~/utils/sheet"

const props = defineProps<{
	/** The workbook's sheets, in the order of their tabs. */
	readonly tabs: readonly { readonly id: string; readonly name: string }[]
	/** A sheet to check and send: the open one as it is, or one made for this and let go after (`own`). */
	readonly open: (id: string) => { readonly sheet: Sheet; readonly own: boolean } | null
	/** Keeps a sheet sent in the background: its draft and what its tab shows. */
	readonly keep: (id: string, sheet: Sheet) => Promise<void>
	readonly locale: GridLocale
	readonly valueSettings: ValueSettings
	readonly theme: GridTheme
	readonly narrow: boolean
}>()

const show = defineModel<boolean>("show", { required: true })
const emit = defineEmits<{
	/** To a sheet: its rows with issues only, or a row of it. */
	go: [id: string, onlyIssues: boolean, rowId?: RowId]
}>()

const message = useMessage()

type Step = "checking" | "review" | "running" | "done"
type CheckState = "waiting" | "checking" | "ready" | "warnings" | "blocked" | "nothing" | "failed" | "review"
type RunState = "queued" | "sending" | "done" | "held" | "skipped" | "stopped" | "lost"
type Tone = "ok" | "warn" | "bad" | "idle" | "busy"

interface Entry {
	readonly id: string
	readonly name: string
	state: CheckState
	updates: number
	creates: number
	unknown: number
	errors: number
	warnings: number
	expanded: boolean
	run: RunState | null
	succeeded: number
	failed: number
}

const STEPS = [
	{ key: "check", label: "Denetle" },
	{ key: "review", label: "Gözden geçir" },
	{ key: "run", label: "Uygula" }
] as const

const TONES: Readonly<Record<Tone, string>> = {
	ok: "bg-primary/10 text-primary-text",
	warn: "bg-warning/15 text-warning-text",
	bad: "bg-error/10 text-error",
	idle: "bg-divider/60 text-muted",
	busy: "bg-transparent text-muted"
}

const ICONS: Readonly<Record<Tone, IconName>> = {
	ok: "tick",
	warn: "alert",
	bad: "alert",
	idle: "minus",
	busy: "minus"
}

const step = ref<Step>("checking")
const entries = ref<Entry[]>([])
/** The sheets checked, kept apart from Vue's proxies: their parts hold private fields. */
const sheets = shallowRef(new Map<string, { readonly sheet: Sheet; readonly own: boolean }>())
const plans = shallowRef(new Map<string, ProcessPlan>())
const conflicts = shallowRef<readonly SharedRecord[]>([])
/** Which sheet's row goes for each product the sheets disagree on, by its key; "" for none. */
const choices = reactive<Record<string, string>>({})
const runIndex = ref(0)
const stopping = ref(false)
/** Moves on each opening, so a check still going when the window closes stops counting. */
let round = 0

const frame = computed(() =>
	props.narrow
		? {
				placement: "bottom",
				height: "calc(100% - 28px)",
				maskClosable: false,
				closeOnEsc: step.value !== "running"
			}
		: {
				title: "Tüm sayfaları uygula",
				width: "880px",
				maskClosable: false,
				closable: step.value !== "running",
				closeOnEsc: step.value !== "running"
			}
)
const inner = computed(() =>
	props.narrow
		? { title: "Tüm sayfaları uygula", closable: step.value !== "running" }
		: { maxHeight: "calc(100vh - 150px)" }
)

const sendable = computed(() => entries.value.filter(entry => entry.state === "ready" || entry.state === "warnings"))
const sendableIds = computed(() => new Set(sendable.value.map(entry => entry.id)))

/** The rows of a sheet a product's choice keeps out of its run. */
function leftOut(id: string): Set<RowId> {
	const rows = new Set<RowId>()

	for (const record of conflicts.value) {
		if ((choices[record.key] ?? "") !== id) {
			record.rows.filter(row => row.sheetId === id).forEach(row => rows.add(row.rowId))
		}
	}

	return rows
}

function rowsOf(entry: Entry): number {
	return Math.max(0, entry.updates + entry.creates + entry.unknown - leftOut(entry.id).size)
}

const totalRows = computed(() => sendable.value.reduce((sum, entry) => sum + rowsOf(entry), 0))
const sentRows = computed(() => entries.value.reduce((sum, entry) => sum + entry.succeeded + entry.failed, 0))
const progress = computed(() => (totalRows.value === 0 ? 0 : Math.min(100, (sentRows.value / totalRows.value) * 100)))
const doneRows = computed(() => entries.value.reduce((sum, entry) => sum + entry.succeeded, 0))
const refusedRows = computed(() => entries.value.reduce((sum, entry) => sum + entry.failed, 0))
const heldSheets = computed(() => entries.value.filter(entry => entry.run === "held").length)
const issueRows = ref(0)

const footNote = computed(() => {
	if (step.value === "checking") {
		return "Her sayfa kendi şablonuyla denetleniyor."
	}

	if (step.value === "running") {
		return "Sayfalar sekmelerin sırasıyla gönderilir. Gönderilen sayfa yarıda kesilmez; Durdur sıradakileri bekletir."
	}

	if (step.value === "done") {
		return "Tüm sayfalar tek dosyada, her satırın sayfası bir sütunda."
	}

	const held = entries.value.filter(entry => ["blocked", "failed", "review"].includes(entry.state))
	const dropped = conflicts.value.filter(record => (choices[record.key] ?? "") === "").length

	return [
		held.length > 0 ? `${held.map(entry => entry.name).join(", ")} bekletilecek` : "",
		dropped > 0 ? `${dropped} ürün gönderilmeyecek` : ""
	]
		.filter(Boolean)
		.join(" · ")
})

function stepState(index: number): "done" | "on" | "next" {
	const at = step.value === "checking" ? 0 : step.value === "review" ? 1 : 2

	return index < at || step.value === "done" ? "done" : index === at ? "on" : "next"
}

function busy(entry: Entry): boolean {
	return entry.state === "checking" || entry.run === "sending"
}

function tone(entry: Entry): Tone {
	if (busy(entry) || entry.state === "waiting" || entry.run === "queued") {
		return "busy"
	}

	if (entry.run !== null) {
		return entry.run === "done"
			? entry.failed > 0
				? "bad"
				: "ok"
			: entry.run === "held"
				? "warn"
				: entry.run === "lost"
					? "bad"
					: "idle"
	}

	return entry.state === "ready"
		? "ok"
		: entry.state === "warnings"
			? "warn"
			: entry.state === "nothing"
				? "idle"
				: "bad"
}

function detail(entry: Entry): string {
	const rows = [
		entry.updates > 0 ? `${entry.updates} satır güncellenecek` : "",
		entry.creates > 0 ? `${entry.creates} yeni ürün` : "",
		entry.unknown > 0 ? `${entry.unknown} satırın sonucu belli değil` : ""
	].filter(Boolean)

	switch (entry.run) {
		case "queued":
			return "Sırada"
		case "sending":
			return "Gönderiliyor…"
		case "done":
			return entry.failed > 0
				? `${entry.succeeded} satır uygulandı, ${entry.failed} satırı sunucu reddetti`
				: `${entry.succeeded} satır uygulandı`
		case "held":
			return entry.state === "review"
				? "Bekletildi: taslak önce açılıp eşlenmeli"
				: entry.state === "failed"
					? "Bekletildi: denetlenemedi"
					: `Bekletildi: ${entry.errors} hata düzeltilmeli`
		case "skipped":
			return "Değişiklik yok"
		case "stopped":
			return "Durduruldu; gönderilmedi"
		case "lost":
			return "Yanıt alınamadı; sayfa açılınca yeniden sorulur"
		default:
	}

	switch (entry.state) {
		case "waiting":
			return "Sırada"
		case "checking":
			return "Denetleniyor…"
		case "nothing":
			return "Değişiklik yok"
		case "failed":
			return "Denetlenemedi; bu sayfa gönderilmez"
		case "review":
			return "Taslak eski bir şemayla kaydedilmiş; önce sayfayı açın"
		case "blocked":
			return `${[...rows, `${entry.errors} hata`].join(" · ")}: düzeltilene kadar gönderilmez`
		case "warnings":
			return `${[...rows, `${entry.warnings} uyarı`].join(" · ")}, gönderimi durdurmaz`
		default:
			return rows.join(" · ")
	}
}

function pill(entry: Entry): string {
	if (entry.run !== null || step.value !== "review") {
		return ""
	}

	return entry.state === "ready"
		? "Hazır"
		: entry.state === "warnings"
			? `${entry.warnings} uyarı`
			: entry.state === "nothing"
				? "Atlanacak"
				: "Bekletilecek"
}

/** The way on from a sheet: to its refused rows after a run, or to the sheet held back. */
function action(entry: Entry): "issues" | "sheet" | null {
	if (entry.run === "done" && entry.failed > 0) {
		return "issues"
	}

	return entry.run === "held" || (step.value === "review" && ["blocked", "failed", "review"].includes(entry.state))
		? "sheet"
		: null
}

function nameOf(id: string): string {
	return props.tabs.find(tab => tab.id === id)?.name ?? id
}

/** A row's values where the sheets differ, as its cells show them. */
function shown(row: SharedRecordRow, fields: readonly string[]): string {
	const schema = sheets.value.get(row.sheetId)?.sheet.schema

	return fields
		.map(key => {
			const field = schema?.has(key) ? schema.field(key) : null
			const text = field ? formatCell(field, row.values[key] ?? null, props.valueSettings) : ""

			return fields.length > 1 && field ? `${field.label} ${text || "—"}` : text || "—"
		})
		.join(" · ")
}

/** Whether the user changed the row's differing values in its sheet, rather than leaving them as loaded. */
function changedIn(row: SharedRecordRow, fields: readonly string[]): boolean {
	const changes = sheets.value.get(row.sheetId)?.sheet.changes

	return changes !== undefined && fields.some(field => changes.isChanged(row.rowId, field))
}

function choiceOptions(record: SharedRecord): { label: string; value: string }[] {
	return [
		{ label: "Gönderme", value: "" },
		...record.rows.map(row => ({ label: `“${nameOf(row.sheetId)}” geçsin`, value: row.sheetId }))
	]
}

function go(id: string, onlyIssues: boolean, rowId?: RowId): void {
	show.value = false
	emit("go", id, onlyIssues, rowId)
}

// ---------------------------------------------------------------- the work

watch(show, open => (open ? void start() : release()), { immediate: true })

/** Checks every sheet, one after another, and finds the products they disagree on. */
async function start(): Promise<void> {
	const mine = ++round

	release()
	step.value = "checking"
	stopping.value = false
	runIndex.value = 0
	issueRows.value = 0
	Object.keys(choices).forEach(key => delete choices[key])
	conflicts.value = []
	plans.value = new Map()
	entries.value = props.tabs.map(tab => ({
		id: tab.id,
		name: tab.name,
		state: "waiting",
		updates: 0,
		creates: 0,
		unknown: 0,
		errors: 0,
		warnings: 0,
		expanded: false,
		run: null,
		succeeded: 0,
		failed: 0
	}))

	for (const entry of entries.value) {
		if (mine !== round) {
			return
		}

		entry.state = "checking"
		entry.state = await checkSheet(entry)
	}

	if (mine !== round) {
		return
	}

	findConflicts()
	// The first sheet that goes opens with its preview: the window says what will happen at once.
	const first = entries.value.find(entry => entry.state === "ready" || entry.state === "warnings")

	if (first) {
		first.expanded = true
	}

	step.value = "review"
}

async function checkSheet(entry: Entry): Promise<CheckState> {
	const opened = props.open(entry.id)

	if (!opened) {
		return "failed"
	}

	sheets.value = new Map(sheets.value).set(entry.id, opened)

	const { sheet } = opened

	if (sheet.review) {
		return "review"
	}

	if (sheet.pendingRows() === 0) {
		return "nothing"
	}

	const checked = await sheet.session.check()

	if (checked.status !== "valid" && checked.status !== "invalid") {
		return "failed"
	}

	const plan = sheet.session.plan()
	const summary = sheet.session.issues.summary()

	plans.value = new Map(plans.value).set(entry.id, plan)
	entry.updates = plan.counts.update
	entry.creates = plan.counts.create
	entry.unknown = plan.counts.unknown
	entry.errors = summary.errors
	entry.warnings = summary.warnings

	return sheet.session.blocked() > 0
		? "blocked"
		: entry.updates + entry.creates + entry.unknown === 0
			? "nothing"
			: entry.warnings > 0
				? "warnings"
				: "ready"
}

function findConflicts(): void {
	const sheetsToSend = sendable.value.flatMap(entry => {
		const sheet = sheets.value.get(entry.id)?.sheet
		const plan = plans.value.get(entry.id)

		return sheet && plan
			? [
					{
						sheetId: entry.id,
						schema: sheet.schema,
						store: sheet.store,
						rows: plan.rows.filter(row => row.action !== "unchanged").map(row => row.rowId)
					}
				]
			: []
	})

	conflicts.value = sharedRecords(sheetsToSend, { key: "productId", settings: props.valueSettings }).filter(
		record => record.differs.length > 0
	)
}

/** Sends the sheets that go, one after another in tab order; the rest are said to be held or left. */
async function run(): Promise<void> {
	step.value = "running"

	for (const entry of entries.value) {
		entry.expanded = false
		entry.run = sendableIds.value.has(entry.id) ? "queued" : entry.state === "nothing" ? "skipped" : "held"
	}

	for (const [index, entry] of sendable.value.entries()) {
		runIndex.value = index

		if (stopping.value) {
			entry.run = "stopped"
			continue
		}

		const sheet = sheets.value.get(entry.id)?.sheet

		if (!sheet) {
			entry.run = "lost"
			continue
		}

		entry.run = "sending"

		const outcome = await sheet.session.process({ leaveOut: leftOut(entry.id) })

		entry.succeeded = outcome.succeeded
		entry.failed = outcome.failed
		entry.run =
			outcome.status === "succeeded" || outcome.status === "partial" || outcome.status === "failed"
				? "done"
				: outcome.status === "nothing"
					? "skipped"
					: outcome.status === "blocked"
						? "held"
						: "lost"

		await props.keep(entry.id, sheet)
	}

	issueRows.value = issueTables().reduce((sum, table) => sum + table.rows.length, 0)
	step.value = "done"
}

/** Each sheet's rows with issues, as its own file would hold them. */
function issueTables(): { readonly name: string; readonly header: readonly string[]; readonly rows: string[][] }[] {
	return entries.value.flatMap(entry => {
		const table = sheets.value.get(entry.id)?.sheet.issueTable(props.locale) ?? null
		const [header, ...rows] = table ?? []

		return header && rows.length > 0 ? [{ name: entry.name, header, rows }] : []
	})
}

/** Every sheet's rows with issues in one file: a "Sayfa" column first, the columns of all of them. */
function downloadIssues(): void {
	const tables = issueTables()
	const columns = [...new Set(tables.flatMap(table => table.header))]
	const lines = tables.flatMap(table =>
		table.rows.map(row => [table.name, ...columns.map(column => row[table.header.indexOf(column)] ?? "")])
	)

	downloadCsv([["Sayfa", ...columns], ...lines], "tum-sayfalar-hatali-satirlar.csv", props.valueSettings)
	message.success(`${lines.length} sorunlu satır indirildi. Düzeltip her sayfaya Dosya → İçe aktar ile yükleyin.`)
}

/** Lets the sheets made for the window go; the open one stays the page's. */
function release(): void {
	for (const { sheet, own } of sheets.value.values()) {
		if (own) {
			sheet.dispose()
		}
	}

	sheets.value = new Map()
}

onBeforeUnmount(release)
</script>
