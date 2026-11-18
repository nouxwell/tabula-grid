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
						text="Bir taslak üzerinde çalışıyorsunuz: Değişiklikleri uygula'ya basana kadar hiçbir kayıt değişmez. Taslak bu tarayıcıda saklanır."
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
					<AppTooltip :disabled="errors === 0">
						<template #trigger>
							<span>
								<AppButton
									type="primary"
									:disabled="!sheet || errors > 0"
									:loading="phase === 'processing' || preparing"
									@click="process"
								>
									<template #icon><AppIcon name="play" :size="16" /></template>
									Değişiklikleri uygula
								</AppButton>
							</span>
						</template>
						{{ blockedText }}
					</AppTooltip>
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
					<AppTooltip :disabled="Boolean(sheet?.template)">
						<template #trigger>
							<span>
								<AppButton
									:size="controlSize"
									:disabled="!drawerTemplate"
									class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
									@click="rulesOpen = true"
								>
									<template #icon><AppIcon name="rules" /></template>
									<span class="hidden md:inline">Kurallar</span>
									<span class="sr-only md:hidden">Kurallar</span>
								</AppButton>
							</span>
						</template>
						Şablon seçili değil: yazdığınız kurallar ve formüller kaydedilince yeni bir şablon olur.
					</AppTooltip>
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
					<span class="mx-1 hidden h-5 w-px bg-divider md:block" aria-hidden="true" />
					<AppTooltip>
						<template #trigger>
							<AppButton
								:size="controlSize"
								:disabled="!sheet"
								class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
								@click="openAdjust('percent')"
							>
								<template #icon><AppIcon name="percent" /></template>
								<span class="hidden md:inline">Yüzde uygula</span>
								<span class="sr-only md:hidden">Yüzde uygula</span>
							</AppButton>
						</template>
						Seçili sayıları bir oranda artırır ya da azaltır.
					</AppTooltip>
					<AppTooltip>
						<template #trigger>
							<AppButton
								:size="controlSize"
								:disabled="!sheet"
								class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
								@click="openAdjust('add')"
							>
								<template #icon><AppIcon name="plus" /></template>
								<span class="hidden md:inline">Tutar ekle</span>
								<span class="sr-only md:hidden">Tutar ekle</span>
							</AppButton>
						</template>
						Seçili sayılara bir tutar ekler; eksi tutar düşer.
					</AppTooltip>
					<AppDropdown :options="roundOptions" @select="chooseRound">
						<AppButton
							:size="controlSize"
							:disabled="!sheet"
							class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
						>
							<template #icon><AppIcon name="round" /></template>
							<span class="hidden md:inline">Yuvarla</span>
							<span class="sr-only md:hidden">Yuvarla</span>
							<AppIcon name="chevronDown" :size="14" class="ml-1 hidden md:block" />
						</AppButton>
					</AppDropdown>
					<AppTooltip>
						<template #trigger>
							<AppButton
								:size="controlSize"
								:disabled="!sheet"
								class="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
								@click="removeRows"
							>
								<template #icon><AppIcon name="trash" /></template>
								<span class="hidden md:inline">Satırları sil</span>
								<span class="sr-only md:hidden">Satırları sil</span>
							</AppButton>
						</template>
						Seçimin geçtiği satırları siler (Ctrl+−); Ctrl+Z geri getirir.
					</AppTooltip>
					<input ref="csvInput" type="file" accept=".csv,text/csv" hidden @change="importChosen" />
				</div>
			</AppScrollbar>

			<!-- Which rows: all, or the changed ones; and the search, on the right. -->
			<div v-if="sheet" class="flex flex-wrap items-center gap-2 pb-2 text-sm">
				<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Satırlar">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-app border px-2.5 py-1"
						:class="
							onlyChanged
								? 'border-divider text-muted'
								: 'border-primary bg-primary/10 font-semibold text-primary-text'
						"
						:aria-pressed="!onlyChanged"
						@click="onlyChanged = false"
					>
						Tüm satırlar
						<span class="rounded-full bg-surface-alt px-1.5 text-xs tabular-nums">
							<AppNumberAnimation :to="rowCount" locale="tr-TR" />
						</span>
					</button>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-app border px-2.5 py-1"
						:class="
							onlyChanged
								? 'border-primary bg-primary/10 font-semibold text-primary-text'
								: 'border-divider text-muted'
						"
						:aria-pressed="onlyChanged"
						:title="onlyChanged ? 'Yeniden basınca süzgeç tablonun şimdiki hâline uygulanır' : undefined"
						@click="showChanged"
					>
						Değişenler
						<span class="rounded-full bg-surface-alt px-1.5 text-xs tabular-nums">
							<AppNumberAnimation :to="changeSummary.rows" locale="tr-TR" />
						</span>
					</button>
					<Transition name="fade">
						<span v-if="changeSummary.missing > 0" class="text-muted">
							·
							<AppNumberAnimation :to="changeSummary.missing" locale="tr-TR" />
							satır silindi
						</span>
					</Transition>
				</div>
				<div class="w-full md:ml-auto md:w-72">
					<AppInput
						v-model:value="searchText"
						:size="narrow ? 'large' : 'small'"
						clearable
						placeholder="Ürün, SKU veya not ara…"
						aria-label="Tabloda ara"
					>
						<template #prefix><AppIcon name="search" :size="16" class="text-muted" /></template>
					</AppInput>
				</div>
			</div>

			<TabulaFormulaBar :grid="grid" :theme="theme" :locale="locale" />
		</div>

		<main class="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 md:flex-row md:px-6">
			<AppCard class="min-h-[320px] min-w-0 flex-1 overflow-hidden" content-class="flex min-h-0 flex-col p-0!">
				<Transition name="fade" mode="out-in">
					<TabulaGrid
						v-if="sheet"
						:key="sheetKey"
						ref="grid"
						v-model:columns="columns"
						v-model:column-widths="widths"
						v-model:filters="filters"
						v-model:sort="sort"
						class="min-h-0 flex-1 rounded-none! border-0!"
						:schema="sheet.schema"
						:store="sheet.store"
						:issues="sheet.session.issues"
						:results="sheet.session.results"
						:history="sheet.history"
						:lookups="sheet.lookups"
						:view="sheet.view"
						:changes="sheet.changes"
						column-letters
						:menu-items="menuItems"
						:theme="theme"
						:locale="locale"
						:value-settings="valueSettings"
						:row-height="narrow ? 40 : 30"
						@menu="onMenu"
					/>
					<!-- Only the part that waits spins; the rest of the page is there and works. -->
					<div
						v-else
						class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted"
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
			</AppCard>
			<!-- On a phone the issues are a bar opening a sheet, not a card. -->
			<component
				:is="narrow ? 'div' : AppCard"
				v-if="sheet"
				class="md:w-[340px]! md:flex-none"
				v-bind="narrow ? {} : { contentClass: 'flex min-h-0 flex-col p-0!' }"
			>
				<TabulaIssues
					v-model:only-issue-rows="onlyIssueRows"
					v-model:open="issuesOpen"
					:class="narrow ? '' : 'min-h-0 flex-1 rounded-none! border-0! bg-transparent!'"
					:variant="narrow ? 'sheet' : 'panel'"
					:issues="sheet.session.issues"
					:schema="sheet.schema"
					:store="sheet.store"
					:theme="theme"
					:locale="locale"
					:value-settings="valueSettings"
					:address-of="addressOf"
					name-field="productId"
					@select="issue => grid?.goTo(issue.rowId!, issue.field)"
					@refresh-rows="sheet.view.refresh()"
				>
					<template v-if="narrow || errors > 0" #actions>
						<p
							v-if="errors > 0"
							class="m-0 flex w-full items-center gap-2 rounded-app bg-error/10 px-3 py-2.5 text-sm text-error"
							role="status"
						>
							{{ blockedText }}
						</p>
						<AppButton
							v-if="narrow"
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
			</component>
		</main>

		<!-- The workbook's sheets, as a spreadsheet's tabs, and on a wide screen the status beside them. -->
		<div class="flex flex-none items-stretch border-t border-divider bg-surface">
			<TabulaSheetTabs
				v-if="workbook"
				v-model:active="openTab"
				class="min-w-0 flex-1 px-2"
				:tabs="sheetTabs"
				:disabled="tabsBusy"
				:theme="theme"
				:locale="locale"
				@add="addTab"
				@rename="renameTab"
				@duplicate="duplicateTab"
				@remove="askRemoveTab"
			/>
			<div class="hidden flex-none md:block">
				<TabulaStatusBar :grid="grid" :theme="theme" :locale="locale" />
			</div>
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
				:loading="phase === 'processing' || preparing"
				@click="process"
			>
				Uygula
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

		<RulesDrawer
			v-if="sheet && input && drawerTemplate"
			v-model:show="rulesOpen"
			:sheet="sheet"
			:module-input="input"
			:template="drawerTemplate"
			:creating="templateId === null"
			:locale="locale"
			:settings="valueSettings"
			:save="saveTemplate"
			:letters="columnLetters"
			@show-rows="showRuleRows"
			@preview="previewTemplate"
		/>

		<AppModal v-model:show="templateNameOpen" title="Yeni şablon" width="440px">
			<AppModalScrollWrapper>
				<form class="flex flex-col gap-2" @submit.prevent="submitTemplateName">
					<label for="template-name" class="text-sm text-muted">
						Kurallar ve hesaplanan sütunlar bu adla bir şablon olur; şablon menüsünden seçen herkes onlarla
						çalışır.
					</label>
					<AppInput
						v-model:value="templateName"
						:input-props="{ id: 'template-name' }"
						:maxlength="60"
						:status="templateNameProblem ? 'error' : undefined"
						placeholder="Örn. Mart kampanyası"
						autofocus
					/>
					<p v-if="templateNameProblem" class="m-0 text-sm text-error" role="alert">
						{{ templateNameProblem }}
					</p>
				</form>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex justify-end gap-2">
					<AppButton @click="templateNameOpen = false">Vazgeç</AppButton>
					<AppButton type="primary" @click="submitTemplateName">Kaydet</AppButton>
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

		<AppModal v-model:show="previewOpen" title="Uygulanacak değişiklikler" width="880px">
			<AppModalScrollWrapper>
				<TabulaPreview
					v-if="sheet && preview"
					:session="sheet.session"
					:plan="preview"
					name-field="productId"
					:theme="theme"
					:locale="locale"
					:value-settings="valueSettings"
					@select="showPlannedRow"
				/>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex flex-wrap items-center justify-end gap-2">
					<span class="mr-auto text-sm text-muted">Bir satıra tıklayınca tabloda o satıra gidilir.</span>
					<AppButton @click="previewOpen = false">Vazgeç</AppButton>
					<AppButton type="primary" @click="run">{{ preview?.rows.length ?? 0 }} satırı uygula</AppButton>
				</div>
			</template>
		</AppModal>

		<AppModal v-model:show="adjustOpen" :title="adjustTitle" width="420px">
			<AppModalScrollWrapper>
				<form class="flex flex-col gap-2" @submit.prevent="applyAdjust">
					<label for="adjust-amount" class="text-sm text-muted">{{ adjustHint }}</label>
					<AppInput
						v-model:value="adjustText"
						:input-props="{ id: 'adjust-amount', inputmode: 'decimal' }"
						:status="adjustProblem ? 'error' : undefined"
						:placeholder="adjustKind === 'percent' ? 'Örn. 5 ya da -10' : 'Örn. 10 ya da -2,5'"
						autofocus
					>
						<template #suffix>{{ adjustKind === "percent" ? "%" : "" }}</template>
					</AppInput>
					<p v-if="adjustProblem" class="m-0 text-sm text-error" role="alert">{{ adjustProblem }}</p>
				</form>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex justify-end gap-2">
					<AppButton @click="adjustOpen = false">Vazgeç</AppButton>
					<AppButton type="primary" @click="applyAdjust">Uygula</AppButton>
				</div>
			</template>
		</AppModal>

		<AppModal
			v-model:show="reviewOpen"
			title="Taslak eski bir şemayla kaydedilmiş"
			width="760px"
			:closable="false"
			:mask-closable="false"
			:close-on-esc="false"
		>
			<AppModalScrollWrapper>
				<TabulaDraftMapping
					v-if="reviewing"
					v-model:rename="draftRename"
					:draft="reviewing.draft"
					:schema="reviewing.schema"
					:theme="theme"
					:locale="locale"
					:value-settings="valueSettings"
				/>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex flex-wrap items-center justify-end gap-2">
					<span class="mr-auto text-sm text-muted">Açılana kadar taslağa dokunulmaz.</span>
					<AppButton type="error" ghost @click="dropReviewed">Taslağı sil, sunucudan aç</AppButton>
					<AppButton type="primary" @click="openReviewed">Taslağı aç</AppButton>
				</div>
			</template>
		</AppModal>

		<AppModal v-model:show="removeTabOpen" title="Sayfayı sil" width="440px">
			<AppModalScrollWrapper>
				<p class="m-0">
					“{{ removingTab?.name }}” sayfası satırlarıyla birlikte silinsin mi? Bu geri alınamaz; öteki
					sayfalar olduğu gibi kalır.
				</p>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex justify-end gap-2">
					<AppButton @click="removeTabOpen = false">Vazgeç</AppButton>
					<AppButton type="error" @click="removeTab">Sil</AppButton>
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
	addSheet,
	createDraft,
	openSheet,
	removeSheet,
	withSheet,
	type Workbook,
	arrangeColumns,
	suggestRenames,
	VALUE_SETTINGS,
	TEMPLATE_FORMAT,
	TEMPLATE_VERSION,
	VIEW_NAME_LIMIT,
	viewNameProblem,
	withColumn,
	type ColumnFilters,
	type ColumnLayout,
	type CheckInput,
	type FieldInput,
	type ColumnSort,
	type ModuleSchemaInput,
	type Adjustment,
	type Draft,
	type ModuleSchema,
	type ProcessPlan,
	type RowId,
	type RowInit,
	type ViewNameProblem
} from "@nouxwell/tabula-core"
import {
	columnName,
	type GridMenuItem,
	type GridPosition,
	type SheetTab,
	type TabulaGrid as Grid
} from "@nouxwell/tabula-vue"
import { useMessage, type DropdownOption } from "naive-ui"
import { refDebounced } from "@vueuse/core"
import { h } from "vue"
import AppCard from "~/components/atoms/AppCard.vue"
import AppIcon from "~/components/atoms/AppIcon.vue"
import { localeMenu, type Locale } from "~/utils/locales"
import type { ImportResult, Sheet } from "~/utils/sheet"
import { loadWorkbook, newId, storeWorkbook } from "~/utils/workbook"
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
const { data: templates, refresh: refreshTemplates } = await useFetch<
	readonly {
		readonly id: string
		readonly name: string
		readonly checks?: readonly CheckInput[]
		readonly columns?: readonly FieldInput[]
	}[]
>("/api/modules/price-update/templates")

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

/** Where the user was in a sheet being made again over the same rows. */
let pendingPosition: GridPosition | null = null

// A grid made again: put back the scroll and the active cell of the one it replaced.
watch(grid, made => {
	const place = pendingPosition

	if (made && place) {
		pendingPosition = null
		void nextTick(() => made.restorePosition(place))
	}
})

/**
 * Makes the sheet with the template the address names, and opens it in the user's default view or
 * the template's arrangement. `carried` rows are the sheet's own, when it is made again for another
 * template: what the user typed stays.
 */
function makeSheet(
	schemaInput: ModuleSchemaInput,
	rowList: readonly RowInit[],
	carried?: readonly RowInit[],
	/** A template to show in place of the saved one, keeping the columns as the user has them. */
	preview?: { readonly template: unknown },
	/** The kept draft, opened with its fields mapped as the user chose. */
	draft?: { readonly rename: Readonly<Record<string, string>> }
): void {
	// The same rows again: the user stays where they were, once the new grid is there.
	if (carried) {
		pendingPosition = grid.value?.position() ?? null
	}

	const tab = currentTab.value

	if (!tab) {
		return
	}

	const sheetId = tab.sheetId
	const template = preview ? preview.template : (templates.value?.find(item => item.id === templateId.value) ?? null)
	const made = createSheet(
		schemaInput,
		carried ?? rowList,
		locale,
		{ columns, widths },
		{
			sheetId,
			kept: tab.draft,
			save: async kept => keepWorkbook(withSheet(workbookNow(), sheetId, { draft: kept })),
			template,
			carried: carried !== undefined,
			// The server's rows: what the user's changes are told against, whichever rows the sheet opens with.
			baseline: rowList,
			...(draft ? { mapping: draft } : {})
		}
	)

	// The tab remembers the template it works with, for the next time it is opened.
	if (!preview && tab.template !== templateId.value) {
		keepWorkbook(withSheet(workbookNow(), sheetId, { template: templateId.value }))
	}

	sheetKey.value++
	sheet.value = made

	if (!preview) {
		savedViews.open(made.schema, made.restored, made.template?.view ?? undefined)
	}

	if (made.templateError) {
		message.error("Şablon uygulanamadı; tablo modül şemasıyla açıldı.")
	}

	// A draft saved under another schema: the user maps its fields, or lets it go, before anything is saved.
	if (made.review) {
		reviewing.value = { draft: made.review.draft, schema: made.schema }
		draftRename.value = suggestRenames(made.review.draft, made.schema)
		reviewOpen.value = true
	}
}

// ---------------------------------------------------------------- the workbook's sheets

/** Every sheet's tab, template and draft; the open one is the sheet on screen. */
const workbook = shallowRef<Workbook | null>(null)
const currentTab = computed(() => workbook.value?.sheets.find(each => each.sheetId === workbook.value?.active) ?? null)
/** A tab is being opened: the template it puts in the address is not a change of the sheet's. */
let switchingTabs = false

function workbookNow(): Workbook {
	if (!workbook.value) {
		throw new Error("The workbook is not open yet.")
	}

	return workbook.value
}

function keepWorkbook(next: Workbook): void {
	workbook.value = next
	storeWorkbook(next)
}

/** The open sheet went through to the backend, with nothing left to send. */
const runDone = computed(
	() =>
		version.value >= 0 &&
		sheet.value?.session.state.run?.status === "succeeded" &&
		sheet.value.session.unfinishedRows().length === 0
)

/** The tabs: the open one counted as it stands, the others as they were when they were left. */
const sheetTabs = computed<SheetTab[]>(() =>
	(workbook.value?.sheets ?? []).map(each =>
		each.sheetId === workbook.value?.active
			? { id: each.sheetId, name: each.name, errors: errors.value, done: runDone.value }
			: {
					id: each.sheetId,
					name: each.name,
					errors: Number(each.meta.errors ?? 0),
					done: each.meta.done === true
				}
	)
)

/** Tabs wait while the sheet is with the backend, or while a window asks about it. */
const tabsBusy = computed(
	() =>
		!sheet.value ||
		phase.value === "checking" ||
		phase.value === "processing" ||
		phase.value === "unknown" ||
		preparing.value ||
		reviewOpen.value
)

const openTab = computed({
	get: () => workbook.value?.active ?? "",
	set: id => void switchTab(id)
})

/** Puts a template in the address, as the open tab's, without making the sheet again for it. */
async function showTemplate(template: string | null): Promise<void> {
	switchingTabs = true

	try {
		await navigateTo({ query: { ...route.query, template: template ?? undefined } }, { replace: true })
	} finally {
		switchingTabs = false
	}
}

/** Saves the open sheet into the workbook, with the counts its tab shows while closed, and lets it go. */
async function leaveTab(): Promise<void> {
	const current = sheet.value
	const tab = currentTab.value

	if (!current || !tab) {
		return
	}

	await current.saver.save()
	keepWorkbook(withSheet(workbookNow(), tab.sheetId, { meta: { errors: errors.value, done: runDone.value } }))
	current.dispose()
	sheet.value = null
}

/** Opens a sheet of the workbook: its draft, with the template it works with. */
async function enterTab(): Promise<void> {
	if (!input.value || !rows.value) {
		return
	}

	await showTemplate(currentTab.value?.template ?? null)
	makeSheet(input.value, rows.value)
}

async function switchTab(id: string): Promise<void> {
	if (tabsBusy.value || id === workbook.value?.active) {
		return
	}

	await leaveTab()
	keepWorkbook(openSheet(workbookNow(), id))
	await enterTab()
}

/** A name no tab has: "Sayfa 2", "Sayfa 3"… */
function freeName(base: string): string {
	const taken = new Set((workbook.value?.sheets ?? []).map(each => each.name))
	let number = (workbook.value?.sheets.length ?? 0) + 1

	while (taken.has(`${base} ${number}`)) {
		number++
	}

	return `${base} ${number}`
}

/** A new sheet after the open one, from the server's rows, with no template. */
async function addTab(): Promise<void> {
	if (tabsBusy.value) {
		return
	}

	await leaveTab()
	keepWorkbook(addSheet(workbookNow(), { name: freeName("Sayfa") }, workbookNow().active).workbook)
	await enterTab()
}

function renameTab(id: string, name: string): void {
	keepWorkbook(withSheet(workbookNow(), id, { name }))
}

/**
 * A copy of a sheet, after it, opened: its rows, columns and template, as a new batch. What the
 * backend did with the rows stays with the original: the copy's rows are all to be sent.
 */
async function duplicateTab(id: string): Promise<void> {
	const source = workbookNow().sheets.find(each => each.sheetId === id)

	if (tabsBusy.value || !source) {
		return
	}

	const live = id === workbookNow().active ? sheet.value : null
	const copied = live
		? createDraft({
				id: newId(),
				schema: live.schema,
				store: live.store,
				view: { columnWidths: widths.value, columns: columns.value }
			})
		: source.draft
			? { ...source.draft, id: newId(), session: { results: [], pending: null } }
			: null

	await leaveTab()
	keepWorkbook(
		addSheet(workbookNow(), { name: `${source.name} (kopya)`, template: source.template, draft: copied }, id)
			.workbook
	)
	await enterTab()
}

const removeTabOpen = ref(false)
const removingTab = shallowRef<{ readonly id: string; readonly name: string } | null>(null)

function askRemoveTab(id: string): void {
	const tab = workbookNow().sheets.find(each => each.sheetId === id)

	if (tab && !tabsBusy.value) {
		removingTab.value = { id, name: tab.name }
		removeTabOpen.value = true
	}
}

/** Takes the sheet out of the workbook; the open one goes to its neighbour. */
async function removeTab(): Promise<void> {
	const going = removingTab.value

	removeTabOpen.value = false

	if (!going) {
		return
	}

	const open = going.id === workbookNow().active

	if (open) {
		sheet.value?.dispose()
		sheet.value = null
	}

	keepWorkbook(removeSheet(workbookNow(), going.id))
	message.info(`“${going.name}” sayfası silindi.`)

	if (open) {
		await enterTab()
	}
}

/** A kept draft saved under another schema, while the user decides about it. */
const reviewing = shallowRef<{ readonly draft: Draft; readonly schema: ModuleSchema } | null>(null)
const reviewOpen = ref(false)
const draftRename = ref<Readonly<Record<string, string>>>({})

/** Opens the kept draft with its fields mapped as chosen. */
function openReviewed(): void {
	if (!input.value || !rows.value) {
		return
	}

	const mapped = Object.keys(draftRename.value).length

	reviewOpen.value = false
	sheet.value?.dispose()
	makeSheet(input.value, rows.value, undefined, undefined, { rename: draftRename.value })
	// Kept at once under the schema it now fits, so it does not come back for review.
	void sheet.value?.saver.save()
	message.success(mapped > 0 ? `Taslak açıldı; ${mapped} alan eşlendi.` : "Taslak açıldı.")
}

/** Lets the kept draft go, and goes on with the server's rows, already on screen. */
function dropReviewed(): void {
	if (!input.value || !rows.value) {
		return
	}

	keepWorkbook(withSheet(workbookNow(), workbookNow().active, { draft: null }))
	reviewOpen.value = false
	sheet.value?.dispose()
	makeSheet(input.value, rows.value)
	message.info("Taslak silindi; tablo sunucudaki satırlarla açık.")
}

// Made once the rows are in the browser: the workbook opened, the open tab with the template it
// works with, unless the address names another.
watch(
	[input, rows],
	async ([schemaInput, rowList]) => {
		if (sheet.value || !schemaInput || !rowList) {
			return
		}

		if (!workbook.value) {
			workbook.value = loadWorkbook(schemaInput.module)
		}

		const kept = currentTab.value?.template ?? null

		if (templateId.value === null && kept !== null) {
			await showTemplate(kept)
		}

		if (!sheet.value) {
			makeSheet(schemaInput, rowList)
		}
	},
	{ immediate: true }
)

// Another template: the same rows, under the schema as that template narrows it. Not when a tab is
// being opened, which puts its own template in the address and makes its own sheet.
watch(templateId, () => {
	const current = sheet.value

	if (!current || !input.value || !rows.value || switchingTabs) {
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

const rulesOpen = ref(false)
/** The template the sheet works with, as the server sent it: what the rules drawer edits. */
const templateInput = computed(() => templates.value?.find(item => item.id === templateId.value) ?? null)

/**
 * The template the rules drawer edits: the one chosen, or, with none chosen, a new one with nothing in
 * it yet, named when it is saved. None while a chosen template could not be applied.
 */
const drawerTemplate = computed(() => {
	if (templateId.value !== null) {
		return sheet.value?.template ? templateInput.value : null
	}

	return input.value
		? {
				format: TEMPLATE_FORMAT,
				version: TEMPLATE_VERSION,
				module: input.value.module,
				id: "new",
				name: "Yeni şablon",
				checks: [],
				columns: []
			}
		: null
})

/**
 * Saves the template the rules drawer changed. Kept, the sheet is made again with it and the same
 * rows; refused, the server's reasons are said. Resolves to whether it was kept.
 */
async function saveTemplate(template: unknown): Promise<boolean> {
	const id = templateId.value

	if (!id) {
		return createTemplate(template)
	}

	if (!sheet.value || !input.value || !rows.value) {
		return false
	}

	try {
		await $fetch(`/api/modules/price-update/templates/${id}`, { method: "PUT", body: template as object })
	} catch (error) {
		const problems = (error as { data?: { data?: { problems?: string[] } } }).data?.data?.problems

		message.error(problems?.[0] ? `Şablon kaydedilemedi: ${problems[0]}` : "Şablon kaydedilemedi.")

		return false
	}

	await refreshTemplates()

	const carried = sheet.value.store.snapshot()

	sheet.value.dispose()
	makeSheet(input.value, rows.value, carried)
	message.success("Şablon kaydedildi; kurallar tabloda.")

	return true
}

/**
 * Makes a new template of what was written with no template chosen: asks its name, has the server
 * keep it, and opens the sheet with it, the same rows, as choosing it from the menu does.
 */
async function createTemplate(template: unknown): Promise<boolean> {
	const name = await askTemplateName()

	if (name === null) {
		return false
	}

	let made: { readonly id: string }

	try {
		made = await $fetch<{ id: string }>("/api/modules/price-update/templates", {
			method: "POST",
			body: { ...(template as object), name }
		})
	} catch (error) {
		const problems = (error as { data?: { data?: { problems?: string[] } } }).data?.data?.problems

		message.error(problems?.[0] ? `Şablon oluşturulamadı: ${problems[0]}` : "Şablon oluşturulamadı.")

		return false
	}

	await refreshTemplates()
	await navigateTo({ query: { ...route.query, template: made.id } }, { replace: true })
	message.success(`«${name}» şablonu oluşturuldu; kuralları ve sütunları onunla açanlar görür.`)

	return true
}

const templateNameOpen = ref(false)
const templateName = ref("")
const templateNameProblem = ref<string | null>(null)
let answerName: ((name: string | null) => void) | null = null

/** Opens the name window; resolves to the name given, or null when the window is closed without one. */
function askTemplateName(): Promise<string | null> {
	templateName.value = ""
	templateNameProblem.value = null
	templateNameOpen.value = true

	return new Promise(resolve => {
		answerName = resolve
	})
}

function submitTemplateName(): void {
	const name = (templateName.value ?? "").trim()

	if (name === "") {
		templateNameProblem.value = "Şablona bir ad verin."

		return
	}

	if ((templates.value ?? []).some(item => item.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
		templateNameProblem.value = `“${name}” adında bir şablon zaten var.`

		return
	}

	const answer = answerName

	answerName = null
	templateNameOpen.value = false
	answer?.(name)
}

// Closed without a name: nothing is saved.
watch(templateNameOpen, open => {
	if (!open && answerName) {
		const answer = answerName

		answerName = null
		answer(null)
	}
})

/**
 * Shows the sheet with a template the rules drawer has changed and not saved, such as a column just
 * written, or with null as the template is saved. The same rows, and the columns as they are.
 */
function previewTemplate(template: unknown): void {
	const current = sheet.value

	if (!current || !input.value || !rows.value) {
		return
	}

	const carried = current.store.snapshot()

	current.dispose()
	makeSheet(input.value, rows.value, carried, { template: template ?? templateInput.value })
}

/** Narrows the sheet to the rows a rule being written catches, or with null shows them all again. */
function showRuleRows(rowIds: readonly RowId[] | null): void {
	const view = sheet.value?.view

	if (!view) {
		return
	}

	if (rowIds === null) {
		view.clear("rules")
	} else {
		const caught = new Set(rowIds)

		view.filter(rowId => caught.has(rowId), "rules")
	}
}

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

/** Why the changes cannot go yet: the errors standing. */
const blockedText = computed(() => `Uygulamadan önce ${errors.value} hatayı düzeltin.`)

/** A cell's address for the issues, as the grid has the columns now. */
function addressOf(rowId: RowId, field: string): string | null {
	return grid.value?.addressOf(rowId, field) ?? null
}

// ---------------------------------------------------------------- changes, search, bulk edits

/** What the user changed since the rows were loaded, counted as the sheet changes. */
const changeSummary = computed(() =>
	version.value >= 0 && sheet.value ? sheet.value.changes.summary() : { rows: 0, cells: 0, added: 0, missing: 0 }
)
const onlyChanged = ref(false)

watch(onlyChanged, only => sheet.value?.onlyChanged(only))

/** "Değişenler" again: the filter taken anew, to the sheet as it is now. */
function showChanged(): void {
	if (onlyChanged.value) {
		sheet.value?.onlyChanged(true)
	} else {
		onlyChanged.value = true
	}
}

const searchText = ref("")
// A moment after the typing stops: 10,000 rows are searched once, not at every letter.
const searchFor = refDebounced(searchText, 250)

watch(searchFor, text => sheet.value?.search(text ?? ""))

const adjustOpen = ref(false)
const adjustKind = ref<"percent" | "add">("percent")
const adjustText = ref("")
const adjustProblem = ref<string | null>(null)
const adjustTitle = computed(() =>
	adjustKind.value === "percent" ? "Seçili sayılara yüzde uygula" : "Seçili sayılara tutar ekle"
)
const adjustHint = computed(() =>
	adjustKind.value === "percent"
		? "Seçili sayılar bu oranda artar; eksi bir oran düşürür. Sonuç sütunun basamağına yuvarlanır."
		: "Seçili sayılara bu tutar eklenir; eksi bir tutar düşülür."
)
const roundOptions: DropdownOption[] = [
	{ label: "En yakın 0,05'e", key: "0.05|half" },
	{ label: "Tam sayıya", key: "1|half" },
	{ label: "Tam sayıya, yukarı", key: "1|up" },
	{ label: "Tam sayıya, aşağı", key: "1|down" },
	{ label: "En yakın 10'a", key: "10|half" }
]

function openAdjust(kind: "percent" | "add"): void {
	if (!grid.value?.selected) {
		message.warning("Önce değiştirilecek hücreleri seçin.")

		return
	}

	adjustKind.value = kind
	adjustText.value = ""
	adjustProblem.value = null
	adjustOpen.value = true
}

/** Applies a change to the numbers selected, and says how many changed. */
function adjust(adjustment: Adjustment): void {
	const changed = grid.value?.adjustSelection(adjustment) ?? 0

	if (changed > 0) {
		message.success(`${changed} hücre güncellendi. Ctrl+Z geri alır.`)
	} else {
		message.warning("Seçimde değiştirilebilir bir sayı yok.")
	}

	grid.value?.focus()
}

function applyAdjust(): void {
	// "5", "-2,5", "%5": a number with a comma or a point, a sign, nothing else.
	const text = (adjustText.value ?? "").replace(/[\s%]/g, "").replace(",", ".")

	if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
		adjustProblem.value = "Bir sayı yazın, örneğin 5 ya da -2,5."

		return
	}

	adjustOpen.value = false
	adjust({ kind: adjustKind.value, by: text.replace(/^\+/, "") })
}

function chooseRound(key: string): void {
	const [step = "1", mode = "half"] = key.split("|")

	if (!grid.value?.selected) {
		message.warning("Önce yuvarlanacak hücreleri seçin.")

		return
	}

	adjust({ kind: "round", step, mode: mode as "half" | "up" | "down" })
}

/** The page's own items in the grid's right-click menu: the bulk changes, each with its window. */
const menuItems = computed<GridMenuItem[]>(() => [
	{ key: "percent", label: "Yüzde uygula…" },
	{ key: "add", label: "Tutar ekle…" },
	{
		key: "round",
		label: "Yuvarla",
		children: roundOptions.map(option => ({ key: `round:${String(option.key)}`, label: String(option.label) }))
	}
])

function onMenu(key: string): void {
	if (key === "percent" || key === "add") {
		openAdjust(key)
	} else if (key.startsWith("round:")) {
		chooseRound(key.slice("round:".length))
	}
}

/** Each column's letter as the columns stand on screen, for the addresses a formula may hold. */
const columnLetters = computed(() => {
	const current = sheet.value

	if (!current) {
		return {}
	}

	const shown = arrangeColumns(current.schema.fields, columns.value).fields

	return Object.fromEntries(shown.map((field, index) => [field.key, columnName(index)]))
})

/** Takes out the rows the selection spans; Ctrl+Z brings them back. */
function removeRows(): void {
	const removed = grid.value?.removeRows() ?? 0

	if (removed > 0) {
		message.success(`${removed} satır silindi. Ctrl+Z geri getirir.`)
	} else {
		message.warning("Önce silinecek satırları seçin.")
	}

	grid.value?.focus()
}

/** What the run would do, by the check before it: shown in a window before anything is sent. */
const preview = shallowRef<ProcessPlan | null>(null)
const previewOpen = ref(false)
/** İşle checks the sheet first when the last check no longer says what a run would send. */
const preparing = ref(false)

/**
 * İşle: checks the sheet when needed, then shows what the run would do. Rows with an error stop it
 * there, as they would stop the run.
 */
async function process(): Promise<void> {
	const session = sheet.value?.session

	if (!session || preparing.value) {
		return
	}

	// A run with no answer goes again as it was sent: there is nothing new to preview.
	if (session.state.phase === "unknown") {
		return run()
	}

	let plan = session.plan()

	if (!plan.current) {
		preparing.value = true

		const checked = await session.check().finally(() => (preparing.value = false))

		if (checked.status === "unavailable") {
			return run()
		}

		if (checked.status === "failed") {
			message.error("Kontrol yapılamadı; değişiklikler uygulanmadı.")

			return
		}

		if (checked.status !== "valid" && checked.status !== "invalid") {
			return
		}

		plan = session.plan()
	}

	const blocked = session.blocked()

	if (blocked > 0) {
		message.warning(`${blocked} satırda düzeltilmesi gereken hata var.`)
		issuesOpen.value = narrow.value

		return
	}

	if (plan.rows.length === 0) {
		message.info("Gönderilecek satır yok.")

		return
	}

	preview.value = plan
	previewOpen.value = true
}

/** A row chosen in the preview: the window steps aside for it. */
function showPlannedRow(rowId: RowId): void {
	previewOpen.value = false
	grid.value?.goTo(rowId)
}

/** Sends the rows, from the preview or again after a run with no answer. */
async function run(): Promise<void> {
	previewOpen.value = false

	const outcome = await sheet.value?.session.process()

	if (!outcome) {
		return
	}

	if (outcome.status === "blocked") {
		message.warning(`${outcome.blocked} satırda düzeltilmesi gereken hata var.`)
		issuesOpen.value = narrow.value
	} else if (outcome.status === "succeeded" || outcome.status === "partial" || outcome.status === "failed") {
		message.info(`${outcome.succeeded} satır uygulandı, ${outcome.failed} satır uygulanamadı.`)
	} else if (outcome.status === "nothing") {
		message.info("Gönderilecek satır yok.")
	} else {
		message.error("Değişiklikler uygulanamadı.")
	}
}
</script>
