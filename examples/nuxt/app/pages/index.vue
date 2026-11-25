<template>
	<div
		class="flex h-full min-h-0 flex-col transition-[padding] duration-250 ease-out motion-reduce:transition-none"
		:style="halfSheet ? { paddingBottom: HALF_SHEET } : undefined"
	>
		<!--
			The app bar: where the page is, its draft and its run, in one row. A phone keeps the title, the
			draft's state under it, and ⋯ for the theme, the language and Kaydet.
		-->
		<header
			class="flex h-14 flex-none items-center gap-2.5 border-b border-divider bg-surface px-3 md:pr-4 md:pl-5"
		>
			<svg width="22" height="22" viewBox="0 0 22 22" class="flex-none" aria-hidden="true">
				<rect x="0" y="0" width="10" height="10" rx="2.5" class="fill-primary" />
				<rect x="12" y="0" width="10" height="10" rx="2.5" class="fill-primary" />
				<rect x="0" y="12" width="10" height="10" rx="2.5" class="fill-primary" />
				<rect x="12" y="12" width="10" height="10" rx="2.5" class="fill-primary opacity-55" />
			</svg>
			<span class="hidden font-display text-[17px] font-semibold lg:inline">Tabula</span>
			<span class="hidden h-[22px] w-px flex-none bg-divider lg:block" aria-hidden="true" />
			<nav aria-label="Konum" class="hidden flex-none items-center gap-0.5 text-sm text-muted xl:flex">
				<span>Ürünler</span>
				<AppIcon name="chevronRight" :size="14" />
			</nav>
			<div class="flex min-w-0 flex-col">
				<h1 class="m-0 truncate font-display text-base leading-tight font-semibold md:text-[17px]">
					{{ input?.title }}
				</h1>
				<span class="flex min-w-0 items-center gap-1 text-xs text-muted md:hidden" role="status">
					Taslak
					<span aria-hidden="true">·</span>
					<Transition name="fade" mode="out-in">
						<span :key="savedShort" class="truncate">{{ savedShort }}</span>
					</Transition>
				</span>
			</div>
			<span class="hidden flex-none md:inline-flex">
				<AppTooltip :content-style="FIT_TOOLTIP_STYLE">
					<template #trigger>
						<span><AppTag size="small" round>Taslak</AppTag></span>
					</template>
					<AppFitText
						text="Bir taslak üzerinde çalışıyorsunuz: Değişiklikleri uygula'ya basana kadar hiçbir kayıt değişmez. Taslak bu tarayıcıda kendini saklar; Ctrl+S hemen kaydeder."
					/>
				</AppTooltip>
			</span>
			<span class="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted lg:flex" role="status">
				<AppIcon name="saved" :size="15" class="flex-none text-primary-text" />
				<Transition name="fade" mode="out-in">
					<span :key="savedText" class="truncate">{{ savedText }}</span>
				</Transition>
			</span>

			<div class="ml-auto hidden flex-none items-center gap-2 md:flex">
				<!-- How the last check stands, by the run: pressed, it opens or closes the issues beside the sheet. -->
				<button
					type="button"
					class="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 disabled:opacity-50"
					:class="issueCount > 0 ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary-text'"
					:disabled="!sheet"
					:aria-expanded="panelShown"
					:aria-label="issueCount > 0 ? `${issueCount} sorun; sorunlar paneli` : 'Sorun yok; sorunlar paneli'"
					@click="togglePanel"
				>
					<AppIcon :name="issueCount > 0 ? 'alert' : 'tick'" :size="14" />
					<Transition name="fade" mode="out-in">
						<span v-if="issueCount > 0" key="issues">
							<AppNumberAnimation :to="issueCount" locale="tr-TR" />
							sorun
						</span>
						<span v-else key="none">Sorun yok</span>
					</Transition>
				</button>
				<AppButton size="medium" :disabled="!sheet" :loading="phase === 'checking'" @click="check">
					<template #icon><AppIcon name="check" :size="16" /></template>
					Kontrol et
				</AppButton>
				<!-- Uygula, and beside it while several sheets wait: this sheet or every sheet. -->
				<span class="inline-flex">
					<AppTooltip :disabled="errors === 0">
						<template #trigger>
							<span class="inline-flex">
								<AppButton
									size="medium"
									type="primary"
									:class="applyAllOffered ? 'rounded-r-none!' : ''"
									:disabled="!sheet || errors > 0"
									:loading="phase === 'processing' || preparing"
									@click="process"
								>
									<template #icon><AppIcon name="play" :size="16" /></template>
									<span class="xl:hidden">Uygula</span>
									<span class="hidden xl:inline">Değişiklikleri uygula</span>
								</AppButton>
							</span>
						</template>
						{{ blockedText }}
					</AppTooltip>
					<Transition name="grow">
						<span v-if="applyAllOffered" class="ml-px inline-flex">
							<AppDropdown
								:options="applyOptions"
								placement="bottom-end"
								:theme-overrides="TWO_LINE_MENU"
								@select="chooseApply"
							>
								<AppButton
									size="medium"
									type="primary"
									class="rounded-l-none! px-2!"
									aria-label="Uygulama seçenekleri"
									:disabled="!sheet || phase === 'processing'"
								>
									<template #icon><AppIcon name="chevronDown" :size="16" /></template>
								</AppButton>
							</AppDropdown>
						</span>
					</Transition>
				</span>
				<span class="mx-1 h-[22px] w-px flex-none bg-divider" aria-hidden="true" />
				<AppTooltip>
					<template #trigger>
						<AppButton
							quaternary
							size="medium"
							icon="keyboard"
							aria-label="Klavye kısayolları (F1)"
							@click="shortcutsOpen = true"
						/>
					</template>
					Klavye kısayolları (F1)
				</AppTooltip>
				<AppTooltip>
					<template #trigger>
						<AppButton
							quaternary
							size="medium"
							:icon="dark ? 'sun' : 'moon'"
							:aria-label="themeLabel"
							@click="dark = !dark"
						/>
					</template>
					{{ themeLabel }}
				</AppTooltip>
				<AppDropdown :options="localeMenu()" @select="pickLocale">
					<AppButton quaternary size="medium" :aria-label="`Dil: ${localeName}`">
						<template #icon><AppIcon name="globe" /></template>
						{{ locale.toUpperCase() }}
					</AppButton>
				</AppDropdown>
			</div>
			<span class="ml-auto md:hidden">
				<AppDropdown :options="phoneMenu" placement="bottom-end" @select="choosePhoneMenu">
					<AppButton
						quaternary
						size="large"
						icon="more"
						aria-label="Diğer: tema, dil, kaydet"
						class="min-h-11 min-w-11"
					/>
				</AppDropdown>
			</span>
		</header>
		<!-- The file chosen by Dosya, the phone's İçe aktar or the empty sheet's button. -->
		<input ref="csvInput" type="file" accept=".csv,text/csv" hidden @change="importChosen" />

		<!--
			One workspace: the tools, the formula bar, the sheet with its issues beside it, and the tabs, in
			one card. A phone has no card: the sheet runs edge to edge.
		-->
		<div class="flex min-h-0 flex-1 flex-col gap-3 md:px-4 md:pt-3 md:pb-4">
			<!-- A run the backend took only part of: what it refused, to fix here or in Excel. -->
			<Transition name="fade-up">
				<div
					v-if="refused"
					class="mx-3 mt-3 flex flex-none flex-wrap items-center gap-3 rounded-app border border-error/30 bg-error/5 px-4 py-2.5 md:mx-0 md:mt-0"
					role="status"
				>
					<AppIcon name="alert" class="text-error" />
					<span class="flex min-w-0 flex-1 flex-col">
						<strong class="text-sm">
							Sunucu {{ refused.succeeded }} satırı işledi, {{ refused.failed }} satırı reddetti.
						</strong>
						<span class="text-sm text-muted">
							Reddedilenler tabloda kaldı. Burada düzeltip yeniden gönderin ya da dosya olarak indirip
							Excel'de düzeltin.
						</span>
					</span>
					<AppButton @click="showIssueRows">Yalnız sorunlu satırlar</AppButton>
					<AppButton type="primary" icon="download" :disabled="issueRows === 0" @click="downloadIssues()">
						Hatalı satırları indir
					</AppButton>
					<AppButton icon="close" aria-label="Kapat" quaternary @click="refused = null" />
				</div>
			</Transition>

			<AppCard
				class="min-h-0 min-w-0 flex-1 overflow-hidden max-md:rounded-none! max-md:border-0!"
				content-class="flex min-h-0 flex-col p-0!"
			>
				<!--
					The tools in one row, without edges: what changes the data on the left, which rows and how
					they are seen on the right. What does not fit a narrower screen goes under ⋯.
				-->
				<div
					role="toolbar"
					aria-label="Tablo araçları"
					class="hidden h-[46px] flex-none items-center gap-0.5 border-b border-divider px-2 md:flex"
				>
					<AppTooltip>
						<template #trigger>
							<AppButton
								quaternary
								icon="undo"
								:disabled="!canUndo"
								aria-label="Geri al"
								@click="grid?.undo()"
							/>
						</template>
						Geri al (Ctrl+Z)
					</AppTooltip>
					<AppTooltip>
						<template #trigger>
							<AppButton
								quaternary
								icon="redo"
								:disabled="!canRedo"
								aria-label="Yinele"
								@click="grid?.redo()"
							/>
						</template>
						Yinele (Ctrl+Y)
					</AppTooltip>
					<span class="mx-1.5 h-5 w-px flex-none bg-divider" aria-hidden="true" />
					<!--
						On plain elements: Naive UI's styles are not in a CSS layer, so they win over Tailwind's
						display utilities set on Naive UI's own components.
					-->
					<span class="hidden xl:inline-flex">
						<AppDropdown :options="fileOptions" @select="chooseFile">
							<AppButton quaternary :disabled="!sheet" :loading="importing">
								<template #icon><AppIcon name="file" /></template>
								Dosya
								<AppIcon name="chevronDown" :size="14" class="ml-1 text-muted" />
							</AppButton>
						</AppDropdown>
					</span>
					<span class="hidden xl:inline-flex">
						<AppDropdown :options="bulkOptions" @select="chooseBulk">
							<AppButton quaternary :disabled="!sheet">
								<template #icon><AppIcon name="edit" /></template>
								Toplu düzenle
								<AppIcon name="chevronDown" :size="14" class="ml-1 text-muted" />
							</AppButton>
						</AppDropdown>
					</span>
					<span class="mx-1.5 hidden h-5 w-px flex-none bg-divider xl:block" aria-hidden="true" />
					<!-- How the cells look: whole from 1400px, under one Biçim menu on a narrower screen. -->
					<div
						class="hidden flex-none items-center gap-0.5 min-[1400px]:flex"
						role="group"
						aria-label="Biçim"
					>
						<AppTooltip>
							<template #trigger>
								<AppButton
									quaternary
									:disabled="!sheet"
									aria-label="Kalın (Ctrl+B)"
									@click="toggleMark('bold')"
								>
									<strong class="w-4 text-center">K</strong>
								</AppButton>
							</template>
							Kalın (Ctrl+B)
						</AppTooltip>
						<AppTooltip>
							<template #trigger>
								<AppButton
									quaternary
									:disabled="!sheet"
									aria-label="İtalik (Ctrl+I)"
									@click="toggleMark('italic')"
								>
									<em class="w-4 text-center font-serif">T</em>
								</AppButton>
							</template>
							İtalik (Ctrl+I)
						</AppTooltip>
						<AppDropdown :options="colorMenu('color')" @select="chooseColorKey">
							<AppButton quaternary :disabled="!sheet" aria-label="Yazı rengi">
								<span class="flex flex-col items-center leading-none">
									<strong>A</strong>
									<span
										class="mt-0.5 h-[3px] w-4 rounded-sm"
										:style="{ background: hexOf(lastColor) }"
									/>
								</span>
								<AppIcon name="chevronDown" :size="12" class="ml-0.5 text-muted" />
							</AppButton>
						</AppDropdown>
						<AppDropdown :options="colorMenu('fill')" @select="chooseColorKey">
							<AppButton quaternary :disabled="!sheet" aria-label="Hücre rengi">
								<span class="flex flex-col items-center leading-none">
									<AppIcon name="bucket" :size="16" />
									<span
										class="mt-0.5 h-[3px] w-4 rounded-sm"
										:style="{ background: hexOf(lastFill) }"
									/>
								</span>
								<AppIcon name="chevronDown" :size="12" class="ml-0.5 text-muted" />
							</AppButton>
						</AppDropdown>
						<AppDropdown :options="alignMenu" @select="chooseAlign">
							<AppButton quaternary :disabled="!sheet" aria-label="Hizalama">
								<template #icon><AppIcon :name="alignIcon" /></template>
								<AppIcon name="chevronDown" :size="12" class="text-muted" />
							</AppButton>
						</AppDropdown>
						<AppTooltip>
							<template #trigger>
								<AppButton
									quaternary
									:disabled="!sheet"
									aria-label="Ondalığı azalt"
									@click="stepDecimals(-1)"
								>
									<span class="text-xs font-semibold">←,0</span>
								</AppButton>
							</template>
							Ondalığı azalt
						</AppTooltip>
						<AppTooltip>
							<template #trigger>
								<AppButton
									quaternary
									:disabled="!sheet"
									aria-label="Ondalığı artır"
									@click="stepDecimals(1)"
								>
									<span class="text-xs font-semibold">,00→</span>
								</AppButton>
							</template>
							Ondalığı artır
						</AppTooltip>
						<AppTooltip>
							<template #trigger>
								<AppButton
									quaternary
									icon="eraser"
									:disabled="!sheet"
									aria-label="Biçimi temizle"
									@click="clearFormat"
								/>
							</template>
							Biçimi temizle
						</AppTooltip>
					</div>
					<span class="hidden md:max-[1399px]:inline-flex">
						<AppDropdown :options="formatOptions" @select="chooseFormat">
							<AppButton quaternary :disabled="!sheet" aria-label="Biçim">
								<template #icon><AppIcon name="format" /></template>
								<span class="hidden lg:inline">Biçim</span>
								<AppIcon name="chevronDown" :size="14" class="ml-1 text-muted" />
							</AppButton>
						</AppDropdown>
					</span>
					<span class="mx-1.5 h-5 w-px flex-none bg-divider" aria-hidden="true" />
					<!-- The template and the rules written on it: Kurallar edits the template chosen. -->
					<span class="inline-flex flex-none">
						<AppDropdown :options="templateOptions" @select="chooseTemplate">
							<AppButton quaternary :disabled="!sheet" :aria-label="`Şablon: ${templateLabel}`">
								<template #icon><AppIcon name="template" /></template>
								<span class="hidden max-w-28 truncate text-muted lg:inline xl:max-w-40">
									{{ templateLabel }}
								</span>
								<AppIcon name="chevronDown" :size="14" class="ml-1 text-muted" />
							</AppButton>
						</AppDropdown>
					</span>
					<span class="hidden xl:inline-flex">
						<AppTooltip :disabled="Boolean(sheet?.template)">
							<template #trigger>
								<span class="inline-flex">
									<AppButton
										quaternary
										:disabled="!drawerTemplate"
										aria-label="Kurallar"
										title="Kurallar"
										@click="rulesOpen = true"
									>
										<template #icon><AppIcon name="rules" /></template>
										<span class="hidden 2xl:inline">Kurallar</span>
									</AppButton>
								</span>
							</template>
							Şablon seçili değil: yazdığınız kurallar ve formüller kaydedilince yeni bir şablon olur.
						</AppTooltip>
					</span>
					<span class="inline-flex xl:hidden">
						<AppDropdown :options="moreOptions" @select="chooseMore">
							<AppButton
								quaternary
								icon="more"
								aria-label="Diğer araçlar"
								:disabled="!sheet"
								:loading="importing"
							/>
						</AppDropdown>
					</span>

					<span class="ml-auto" />
					<RowFilter
						v-if="sheet"
						:all="rowCount"
						:changed="changeSummary.rows"
						:marked="markedRows"
						:only-changed="onlyChanged"
						:only-marked="onlyMarked"
						@all="showAll"
						@changed="showChanged"
						@marked="showMarked"
					/>
					<div class="ml-2 max-w-56 min-w-28 flex-1">
						<AppInput
							v-model:value="searchText"
							:disabled="!sheet"
							clearable
							placeholder="Ürün, SKU, not ara…"
							aria-label="Tabloda ara"
						>
							<template #prefix><AppIcon name="search" :size="16" class="text-muted" /></template>
						</AppInput>
					</div>
					<AppTooltip>
						<template #trigger>
							<AppButton
								quaternary
								icon="columns"
								:disabled="!sheet"
								aria-label="Sütunlar"
								class="ml-1"
								@click="columnsOpen = true"
							/>
						</template>
						Sütunlar
					</AppTooltip>
					<AppDropdown :options="viewOptions" @select="chooseView">
						<AppButton
							quaternary
							:disabled="!sheet"
							:aria-label="`Görünüm: ${viewLabel}`"
							:title="`Görünüm: ${viewLabel}`"
						>
							<template #icon><AppIcon name="views" /></template>
							<span v-if="viewModified" class="size-1.5 rounded-full bg-primary" aria-label="değişti" />
							<AppIcon name="chevronDown" :size="14" class="ml-0.5 text-muted" />
						</AppButton>
					</AppDropdown>
				</div>

				<!-- A phone's tools: one row; the search opens under it, the rest are in a sheet. -->
				<div
					role="toolbar"
					aria-label="Tablo araçları"
					class="flex h-[52px] flex-none items-center gap-1 border-b border-divider px-2 md:hidden"
				>
					<AppButton
						quaternary
						size="large"
						icon="undo"
						:disabled="!canUndo"
						aria-label="Geri al"
						class="min-h-11 min-w-11"
						@click="grid?.undo()"
					/>
					<AppButton
						quaternary
						size="large"
						icon="redo"
						:disabled="!canRedo"
						aria-label="Yinele"
						class="min-h-11 min-w-11"
						@click="grid?.redo()"
					/>
					<RowFilter
						v-if="sheet"
						class="mx-auto"
						compact
						:all="rowCount"
						:changed="changeSummary.rows"
						:marked="markedRows"
						:only-changed="onlyChanged"
						:only-marked="onlyMarked"
						@all="showAll"
						@changed="showChanged"
						@marked="showMarked"
					/>
					<AppButton
						quaternary
						size="large"
						icon="search"
						:aria-expanded="searchOpen || searchText !== ''"
						aria-label="Tabloda ara"
						class="ml-auto min-h-11 min-w-11"
						:class="searchOpen || searchText !== '' ? 'text-primary-text!' : ''"
						:disabled="!sheet"
						@click="searchOpen = !searchOpen"
					/>
					<AppButton
						quaternary
						size="large"
						icon="sliders"
						aria-label="Araçlar"
						aria-haspopup="dialog"
						class="min-h-11 min-w-11"
						:disabled="!sheet"
						@click="toolsOpen = true"
					/>
				</div>
				<Transition name="fade">
					<div
						v-if="narrow && (searchOpen || searchText !== '')"
						class="flex-none border-b border-divider px-3 py-2"
					>
						<AppInput
							v-model:value="searchText"
							size="large"
							clearable
							autofocus
							placeholder="Ürün, SKU veya not ara…"
							aria-label="Tabloda ara"
						>
							<template #prefix><AppIcon name="search" :size="16" class="text-muted" /></template>
						</AppInput>
					</div>
				</Transition>

				<TabulaFormulaBar
					class="flex-none border-b border-divider px-1.5 py-0.5"
					:grid="grid"
					:theme="theme"
					:locale="locale"
				/>
				<TabulaFind
					v-if="sheet"
					v-model:open="findOpen"
					v-model:found="found"
					class="flex-none border-b border-divider px-3 py-2"
					:grid="grid"
					:store="sheet.store"
					:schema="sheet.schema"
					:view="sheet.view"
					:value-settings="valueSettings"
					:theme="theme"
					:locale="locale"
					@replaced="onReplaced"
				/>

				<!-- The sheet, and beside it the issues while there are any; the chip in the bar opens and closes them. -->
				<div class="flex min-h-0 flex-1">
					<div class="relative flex min-h-[150px] min-w-0 flex-1 flex-col md:min-h-[240px]">
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
								:row-height="narrow ? 40 : DENSITY_HEIGHTS[density]"
								:marks="sheet.marks"
								:found="found ?? undefined"
								:sheet-notes="notesOfSheets"
								:sheets="formulaSheetsNow ?? undefined"
								fit
								totals
								new-row
								:zoom="zoom"
								:default-formats="templateFormats"
								@menu="onMenu"
								@find="findOpen = true"
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
						<!-- A sheet with no rows yet says how to fill it; the row under the headers adds one. -->
						<Transition name="fade">
							<div
								v-if="sheetEmpty"
								class="pointer-events-none absolute inset-x-0 top-[70px] bottom-10 flex items-center justify-center p-4"
							>
								<div
									class="pointer-events-auto flex max-w-[520px] flex-col items-center gap-2.5 rounded-xl border border-dashed border-divider bg-surface px-7 py-6 text-center"
									@click="grid?.focus()"
								>
									<AppIcon name="table" :size="34" class="text-primary-text" />
									<strong class="font-display text-[17px] font-semibold">Bu sayfa boş</strong>
									<span class="text-sm leading-relaxed text-muted">
										Sütunlar hazır, satır yok. Excel'den kopyaladığınız satırları buraya yapıştırın,
										bir dosyadan içe aktarın ya da üstteki "Yeni satır"a tıklayıp yazın.
									</span>
									<span
										class="mt-1 flex flex-wrap items-center justify-center gap-2.5 text-sm text-muted"
									>
										<AppButton type="primary" icon="upload" @click.stop="chooseImport">
											Dosyadan içe aktar
										</AppButton>
										<span>ya da</span>
										<kbd
											class="rounded-app border border-divider bg-surface-alt px-1.5 py-0.5 text-xs"
										>
											Ctrl+V
										</kbd>
									</span>
								</div>
							</div>
						</Transition>
					</div>
					<Transition name="panel">
						<aside
							v-if="sheet && !narrow && panelShown"
							class="flex w-[320px] flex-none flex-col border-l border-divider xl:w-[360px]"
							aria-label="Sorunlar"
						>
							<TabulaIssues
								ref="issuesPanel"
								v-model:only-issue-rows="onlyIssueRows"
								class="min-h-0 flex-1 rounded-none! border-0!"
								closable
								:issues="sheet.session.issues"
								:schema="sheet.schema"
								:store="sheet.store"
								:theme="theme"
								:locale="locale"
								:value-settings="valueSettings"
								:address-of="addressOf"
								name-field="productId"
								@close="closePanel"
								@select="issue => grid?.goTo(issue.rowId!, issue.field)"
								@refresh-rows="sheet.view.refresh()"
							>
								<template v-if="errors > 0 || issueRows > 0" #actions>
									<p
										v-if="errors > 0"
										class="m-0 flex w-full items-center gap-2 text-sm text-muted"
										role="status"
									>
										<AppIcon name="alert" :size="16" class="flex-none text-error" />
										{{ blockedText }}
									</p>
									<AppButton v-if="issueRows > 0" icon="download" @click="downloadIssues()">
										Hatalı satırları indir ({{ issueRows }})
									</AppButton>
								</template>
							</TabulaIssues>
						</aside>
					</Transition>
				</div>

				<!-- The sheet's tabs on the left; how many rows, what is selected and how the sheet is drawn, on the right. -->
				<div class="flex h-10 flex-none items-stretch border-t border-divider">
					<TabulaSheetTabs
						v-if="workbook"
						v-model:active="openTab"
						class="min-w-0 flex-1"
						:tabs="sheetTabs"
						:add-options="ADD_OPTIONS"
						:disabled="tabsBusy"
						:theme="theme"
						:locale="locale"
						@add="addTab"
						@rename="renameTab"
						@duplicate="duplicateTab"
						@remove="askRemoveTab"
						@move="moveTab"
					/>
					<span
						v-if="sheet"
						class="flex flex-none items-center px-3 text-[13px] whitespace-nowrap text-muted md:hidden"
					>
						<AppNumberAnimation :to="rowCount" locale="tr-TR" />
						&nbsp;satır
					</span>
					<div class="hidden flex-none items-center md:flex">
						<Transition name="fade">
							<span
								v-if="changeSummary.missing > 0"
								class="pl-3 text-[13px] whitespace-nowrap text-muted"
							>
								<AppNumberAnimation :to="changeSummary.missing" locale="tr-TR" />
								satır silindi ·
							</span>
						</Transition>
						<TabulaStatusBar class="min-h-0! py-0!" :grid="grid" :theme="theme" :locale="locale" />
					</div>
					<!-- How close the rows sit and how large the sheet is drawn, in one menu: the user's own, kept in the browser. -->
					<div class="hidden flex-none items-center border-l border-divider px-1.5 lg:flex">
						<AppDropdown :options="sizeOptions" placement="top-end" @select="chooseSize">
							<AppButton quaternary :aria-label="`Satır sıklığı ve yakınlaştırma: ${sizeLabel}`">
								<span class="text-[13px] text-muted">{{ sizeLabel }}</span>
								<AppIcon name="chevronDown" :size="14" class="ml-1 text-muted" />
							</AppButton>
						</AppDropdown>
					</div>
				</div>
			</AppCard>
		</div>

		<!--
			A phone's run, at the bottom: how the last check stands (a tick, or the issues' count, which
			opens them), Kontrol et and Uygula. It steps aside while the issues are open over it.
		-->
		<div
			v-if="!halfSheet"
			class="flex flex-none items-center gap-2 border-t border-divider bg-surface px-3 py-2.5 md:hidden"
		>
			<button
				type="button"
				class="flex size-12 flex-none items-center justify-center rounded-app font-bold tabular-nums transition-colors duration-150 disabled:opacity-50"
				:class="issueCount > 0 ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary-text'"
				:disabled="!sheet"
				:aria-label="issueCount > 0 ? `${issueCount} sorun; sorunları göster` : 'Sorun yok; sorunları göster'"
				@click="issuesOpen = true"
			>
				<AppNumberAnimation v-if="issueCount > 0" :to="issueCount" locale="tr-TR" />
				<AppIcon v-else name="tick" :size="24" />
			</button>
			<AppButton size="large" class="flex-1" :disabled="!sheet" :loading="phase === 'checking'" @click="check">
				Kontrol et
			</AppButton>
			<AppDropdown
				v-if="applyAllOffered"
				:options="applyOptions"
				placement="top-end"
				:theme-overrides="TWO_LINE_MENU"
				@select="chooseApply"
			>
				<AppButton
					size="large"
					type="primary"
					class="flex-1"
					:disabled="!sheet"
					:loading="phase === 'processing' || preparing"
				>
					Uygula
					<AppIcon name="chevronUp" :size="16" class="ml-1" />
				</AppButton>
			</AppDropdown>
			<AppButton
				v-else
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

		<!-- A phone's issues: the lower half of the screen, the sheet above it, where the chosen cell shows. -->
		<TabulaIssues
			v-if="sheet && narrow"
			ref="issuesPanel"
			v-model:only-issue-rows="onlyIssueRows"
			v-model:open="issuesOpen"
			variant="sheet"
			:bar="false"
			:modal="false"
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
			<template #actions>
				<p v-if="errors > 0" class="m-0 flex w-full items-center gap-2 text-sm text-muted" role="status">
					<AppIcon name="alert" :size="16" class="flex-none text-error" />
					{{ blockedText }}
				</p>
				<span class="flex w-full gap-2">
					<AppButton
						size="large"
						icon="download"
						class="flex-1"
						:disabled="issueRows === 0"
						@click="downloadIssues()"
					>
						Hatalıları indir
					</AppButton>
					<AppButton
						size="large"
						type="primary"
						icon="refresh"
						class="flex-1"
						:loading="phase === 'checking'"
						@click="check"
					>
						Yeniden kontrol
					</AppButton>
				</span>
			</template>
		</TabulaIssues>
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

		<!--
			A phone's tools, short enough to need no scrolling: the format as tiles, the selected cells' and
			the file's work as large buttons, and the sheet's settings as a list with their values.
		-->
		<AppDrawer v-model:show="toolsOpen" placement="bottom" height="min(88vh, 700px)">
			<AppDrawerContent title="Araçlar">
				<div class="flex flex-col gap-4 pb-2">
					<p v-if="selectionText" class="m-0 -mt-1 text-sm text-muted">{{ selectionText }}</p>
					<section class="flex flex-col gap-2" aria-label="Biçim">
						<h3 class="m-0 text-xs font-semibold text-muted">Biçim</h3>
						<div class="grid grid-cols-4 gap-2">
							<template v-for="tile in formatTiles" :key="tile.key">
								<AppDropdown
									v-if="tile.menu"
									:options="tile.menu"
									placement="top"
									@select="(choice: string | number) => chooseTool(tile.key, choice)"
								>
									<button
										type="button"
										class="flex h-16 flex-col items-center justify-center gap-1 rounded-app bg-surface-alt text-xs transition-colors duration-150 hover:bg-divider disabled:opacity-50"
										:disabled="!sheet"
									>
										<span class="flex h-5 items-center text-base">
											<strong v-if="tile.key === 'bold'">K</strong>
											<em v-else-if="tile.key === 'italic'" class="font-serif">T</em>
											<span v-else-if="tile.text" class="text-xs font-semibold">
												{{ tile.text }}
											</span>
											<AppIcon v-else-if="tile.icon" :name="tile.icon" :size="18" />
										</span>
										{{ tile.label }}
									</button>
								</AppDropdown>
								<button
									v-else
									type="button"
									class="flex h-16 flex-col items-center justify-center gap-1 rounded-app bg-surface-alt text-xs transition-colors duration-150 hover:bg-divider disabled:opacity-50"
									:disabled="!sheet"
									@click="chooseTool(tile.key)"
								>
									<span class="flex h-5 items-center text-base">
										<strong v-if="tile.key === 'bold'">K</strong>
										<em v-else-if="tile.key === 'italic'" class="font-serif">T</em>
										<span v-else-if="tile.text" class="text-xs font-semibold">{{ tile.text }}</span>
										<AppIcon v-else-if="tile.icon" :name="tile.icon" :size="18" />
									</span>
									{{ tile.label }}
								</button>
							</template>
						</div>
					</section>
					<section class="flex flex-col gap-2" aria-label="Seçili hücreler">
						<h3 class="m-0 text-xs font-semibold text-muted">Seçili hücreler</h3>
						<div class="grid grid-cols-2 gap-2">
							<AppButton size="large" icon="percent" :disabled="!sheet" @click="chooseTool('percent')">
								Yüzde uygula
							</AppButton>
							<AppButton size="large" icon="plus" :disabled="!sheet" @click="chooseTool('add')">
								Tutar ekle
							</AppButton>
							<AppDropdown
								:options="roundOptions"
								placement="top"
								@select="(choice: string | number) => chooseTool('round', choice)"
							>
								<AppButton size="large" icon="round" :disabled="!sheet">Yuvarla</AppButton>
							</AppDropdown>
							<AppButton
								size="large"
								type="error"
								ghost
								icon="trash"
								:disabled="!sheet"
								@click="chooseTool('remove')"
							>
								Satırları sil
							</AppButton>
						</div>
					</section>
					<section class="flex flex-col gap-2" aria-label="Dosya">
						<h3 class="m-0 text-xs font-semibold text-muted">Dosya</h3>
						<div class="grid grid-cols-2 gap-2">
							<AppButton size="large" icon="upload" :disabled="!sheet" @click="chooseTool('import')">
								İçe aktar
							</AppButton>
							<AppButton size="large" icon="download" :disabled="!sheet" @click="chooseTool('export')">
								Dışa aktar
							</AppButton>
						</div>
					</section>
					<section class="flex flex-col" aria-label="Sayfa">
						<h3 class="m-0 pb-1 text-xs font-semibold text-muted">Sayfa</h3>
						<template v-for="item in pageTools" :key="item.key">
							<AppDropdown
								v-if="item.menu"
								:options="item.menu"
								placement="top"
								@select="(choice: string | number) => chooseTool(item.key, choice)"
							>
								<button
									type="button"
									class="flex min-h-12 w-full items-center gap-3 border-b border-divider text-left text-base transition-colors duration-150 hover:bg-surface-alt disabled:opacity-50"
									:disabled="!sheet || item.disabled"
								>
									<AppIcon v-if="item.icon" :name="item.icon" class="text-muted" />
									<span class="flex-1">{{ item.label }}</span>
									<span v-if="item.value" class="max-w-40 truncate text-sm text-muted">
										{{ item.value }}
									</span>
									<AppIcon name="chevronRight" :size="16" class="text-muted" />
								</button>
							</AppDropdown>
							<button
								v-else
								type="button"
								class="flex min-h-12 w-full items-center gap-3 border-b border-divider text-left text-base transition-colors duration-150 hover:bg-surface-alt disabled:opacity-50"
								:disabled="!sheet || item.disabled"
								@click="chooseTool(item.key)"
							>
								<AppIcon v-if="item.icon" :name="item.icon" class="text-muted" />
								<span class="flex-1">{{ item.label }}</span>
								<span v-if="item.value" class="max-w-40 truncate text-sm text-muted">
									{{ item.value }}
								</span>
								<AppIcon name="chevronRight" :size="16" class="text-muted" />
							</button>
						</template>
					</section>
				</div>
			</AppDrawerContent>
		</AppDrawer>

		<AppModal v-model:show="shortcutsOpen" title="Klavye kısayolları" width="720px">
			<AppModalScrollWrapper>
				<div class="grid gap-x-8 gap-y-4 md:grid-cols-2">
					<section v-for="group in SHORTCUTS" :key="group.title" class="flex flex-col gap-1.5">
						<h3 class="m-0 text-sm font-semibold">{{ group.title }}</h3>
						<dl class="m-0 flex flex-col gap-1">
							<div
								v-for="item in group.items"
								:key="item.keys"
								class="flex items-baseline justify-between gap-4 text-sm"
							>
								<dt class="text-muted">{{ item.what }}</dt>
								<dd class="m-0 flex-none">
									<kbd class="rounded-app border border-divider bg-surface-alt px-1.5 py-0.5 text-xs">
										{{ item.keys }}
									</kbd>
								</dd>
							</div>
						</dl>
					</section>
				</div>
			</AppModalScrollWrapper>
		</AppModal>

		<ImportDialog
			v-if="sheet && importFile"
			v-model:show="importOpen"
			:file-name="importFile.name"
			:table="importFile.table"
			:schema="sheet.schema"
			:store="sheet.store"
			:settings="valueSettings"
			:remembered="importMemory"
			:lookups="sheet.lookups"
			@import="onImport"
		/>

		<RulesDrawer
			v-if="sheet && input && drawerTemplate"
			v-model:show="rulesOpen"
			:sheet="sheet"
			:module-input="input"
			:template="drawerTemplate"
			:own-formats="columns.formats ?? {}"
			:creating="templateId === null"
			:locale="locale"
			:settings="valueSettings"
			:save="saveTemplate"
			:letters="columnLetters"
			:sheets="formulaSheetsNow"
			:sheet-names="sheetChoices"
			@show-rows="showRuleRows"
			@preview="previewTemplate"
		/>

		<!-- A tab renamed that formulas read by name: they follow it, or keep the old name. -->
		<AppModal v-model:show="renameOpen" title="Formüller de güncellensin mi?" width="460px">
			<AppModalScrollWrapper>
				<p v-if="renaming" class="m-0 text-sm">
					<strong class="text-sheet">“{{ renaming.from }}”</strong>
					şablonlardaki {{ renaming.count }} formülde geçiyor. Güncellenirse bu formüller
					<strong class="text-sheet">“{{ renaming.to }}”</strong>
					sayfasını okur; güncellenmezse eski adı aradıkları için #REF! gösterirler.
				</p>
			</AppModalScrollWrapper>
			<template #footer>
				<div class="flex flex-wrap justify-end gap-2">
					<AppButton :disabled="renameBusy" @click="renameOpen = false">Yalnız sekmeyi adlandır</AppButton>
					<AppButton type="primary" :loading="renameBusy" @click="renameInFormulas">
						Formülleri güncelle
					</AppButton>
				</div>
			</template>
		</AppModal>

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

		<ApplyAllDialog
			v-model:show="applyAllOpen"
			:tabs="applyTabs"
			:open="applySheetFor"
			:keep="keepApplied"
			:locale="locale"
			:value-settings="valueSettings"
			:theme="theme"
			:narrow="narrow"
			@go="goToSheet"
		/>

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
	ModuleSchema,
	RowStore,
	moveSheet,
	openSheet,
	formulaSheets,
	parseFormula,
	removeSheet,
	withSheet,
	withSheetRenamed,
	type Workbook,
	type WorkbookSheet,
	arrangeColumns,
	suggestRenames,
	VALUE_SETTINGS,
	TEMPLATE_FORMAT,
	TEMPLATE_VERSION,
	VIEW_NAME_LIMIT,
	viewNameProblem,
	withColumn,
	withColumnFormat,
	withoutColumnFormats,
	mergeColumnFormats,
	digitsFor,
	MAX_SHOWN_DECIMALS,
	type ColumnAlign,
	type ColumnFormats,
	type StyleRuleInput,
	type FoundCell,
	type MarkColor,
	type ColumnFilters,
	type ColumnLayout,
	type CheckInput,
	type FieldInput,
	type ColumnSort,
	type ModuleSchemaInput,
	type Adjustment,
	type Draft,
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
	type TabulaGrid as Grid,
	type TabulaIssues as IssuesPanel
} from "@nouxwell/tabula-vue"
import { useMessage, type DropdownOption } from "naive-ui"
import { refDebounced, useEventListener } from "@vueuse/core"
import { h, type VNode } from "vue"
import AppCard from "~/components/atoms/AppCard.vue"
import AppIcon, { type IconName } from "~/components/atoms/AppIcon.vue"
import { LOCALES, localeMenu, type Locale } from "~/utils/locales"
import type { ImportChoice, Sheet } from "~/utils/sheet"
import type { ImportMemory } from "~/components/ImportDialog.vue"
import {
	loadWorkbook,
	newId,
	sheetNotes,
	sheetRowCount,
	sheetsSignature,
	storeWorkbook,
	workbookSheets
} from "~/utils/workbook"
import { FIT_TOOLTIP_STYLE } from "~/utils/tooltip"
import { MARK_SWATCHES } from "~/utils/styles"

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
		readonly styles?: readonly StyleRuleInput[]
		readonly view?: { readonly columns?: ColumnLayout } | null
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
/** A phone's tools sheet. */
const toolsOpen = ref(false)
const csvInput = ref<HTMLInputElement | null>(null)
const importOpen = ref(false)
/** A file being read: the İçe aktar button spins until its rows are in. */
const importing = ref(false)
/** The file being imported: its name and its table, while the import window is open. */
const importFile = shallowRef<{ readonly name: string; readonly table: string[][] } | null>(null)

/** A phone's width: the issues open as a sheet from the bottom, and buttons are a finger wide. */
const narrow = ref(false)
/** A phone's search, opened under its tools by the magnifier. */
const searchOpen = ref(false)
/** How much of a phone's screen its issues take while open: the page makes room for them above. */
const HALF_SHEET = "min(52vh, 460px)"
const halfSheet = computed(() => narrow.value && issuesOpen.value && sheet.value !== null)
/** The issues' list, beside the sheet or a phone's half sheet: F8 walks it. */
const issuesPanel = ref<InstanceType<typeof IssuesPanel> | null>(null)
const localeName = computed(() => LOCALES.find(item => item.value === locale.value)?.label ?? "")
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
	/**
	 * Made again keeping the columns, filters and sort as the user has them: with a template to show in
	 * place of the saved one (`template`), or with the template just saved (`template` left out).
	 */
	again?: { readonly template?: unknown },
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

	// What a run on the sheet being replaced was refused is not this sheet's to say.
	if (!again) {
		refused.value = null
	}
	const preview = again !== undefined && "template" in again
	const template = preview ? again.template : (templates.value?.find(item => item.id === templateId.value) ?? null)
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
			// The colours the user put on carried rows go with them.
			...(carried && sheet.value ? { marks: sheet.value.marks.toJSON() } : {}),
			// The server's rows: what the user's changes are told against, whichever rows the sheet opens with;
			// a blank sheet's rows are all its own.
			baseline: tab.meta.blank === true ? [] : rowList,
			...(draft ? { mapping: draft } : {}),
			// The other tabs, as last saved, for formulas that read them with SHEET.
			sheets: workbookSheets(workbookNow(), rowList)
		}
	)

	// The tab remembers the template it works with, for the next time it is opened.
	if (!preview && tab.template !== templateId.value) {
		keepWorkbook(withSheet(workbookNow(), sheetId, { template: templateId.value }))
	}

	sheetKey.value++
	sheet.value = made

	if (!again) {
		savedViews.open(made.schema, made.restored, made.template?.view ?? undefined)
	} else if (!preview) {
		savedViews.rebase(made.schema, made.template?.view ?? undefined)
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
/** A template just made in the rules drawer: the sheet opens with it as the user has it. */
let madeTemplate: { readonly id: string; readonly template: unknown } | null = null

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

/** When each tab was last saved: a cell worked out from another tab says it in its tooltip. */
const notesOfSheets = computed(() => (workbook.value ? sheetNotes(workbook.value) : {}))

/** The tabs as SHEET reads them, for the rules drawer's preview. */
const formulaSheetsNow = computed(() =>
	workbook.value && rows.value ? workbookSheets(workbook.value, rows.value) : null
)

/** The tabs a formula may name, with how many products each holds, for the formula editor's list. */
const sheetChoices = computed(() => {
	const book = workbook.value
	const server = rows.value

	return book && server
		? book.sheets.map(tab => ({ name: tab.name, rows: sheetRowCount(book, tab.name, server) ?? 0 }))
		: []
})

// Another tab saved, as the window that applies every tab saves them, or a tab renamed: what the open
// sheet's formulas read from the others is worked out again. Its own saves change nothing it reads.
watch(
	() => (workbook.value ? sheetsSignature(workbook.value) : ""),
	(now, before) => {
		if (before !== "" && now !== before && sheet.value && workbook.value && rows.value) {
			sheet.value.refreshSheets(workbookSheets(workbook.value, rows.value))
		}
	}
)

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
			? {
					id: each.sheetId,
					name: each.name,
					errors: errors.value,
					done: runDone.value,
					changed: pendingNow.value > 0
				}
			: {
					id: each.sheetId,
					name: each.name,
					errors: Number(each.meta.errors ?? 0),
					done: each.meta.done === true,
					changed: Number(each.meta.pending ?? 0) > 0
				}
	)
)

// ---------------------------------------------------------------- every sheet at once

/** The open sheet's changes not yet applied: rows a run would send that the user changed. */
const pendingNow = computed(() => (version.value >= 0 && sheet.value ? sheet.value.pendingRows() : 0))

/** The sheets with changes not yet applied, in tab order: the open one as it stands, the others as left. */
const waitingSheets = computed(() =>
	(workbook.value?.sheets ?? [])
		.map(each => ({
			id: each.sheetId,
			name: each.name,
			pending: each.sheetId === workbook.value?.active ? pendingNow.value : Number(each.meta.pending ?? 0)
		}))
		.filter(each => each.pending > 0)
)

/** "Tüm sayfaları uygula" is offered while more than one sheet waits. */
const applyAllOffered = computed(() => waitingSheets.value.length > 1)
const applyAllOpen = ref(false)
const applyTabs = computed(() => (workbook.value?.sheets ?? []).map(each => ({ id: each.sheetId, name: each.name })))

/** A menu whose items have a second line under their names: each item is as tall as two lines. */
const TWO_LINE_MENU = { optionHeightMedium: "50px" } as const

/** Uygula's menu: this sheet or every sheet, each with what it would send. */
const applyOptions = computed<DropdownOption[]>(() => {
	const total = waitingSheets.value.reduce((sum, each) => sum + each.pending, 0)
	const lines = (title: string, detail: string) => () =>
		h("span", { class: "flex flex-col gap-0.5 leading-tight" }, [
			h("span", { class: "font-semibold" }, title),
			h("span", { class: "text-xs text-muted" }, detail)
		])

	return [
		{
			key: "this",
			icon: menuIcon("table"),
			disabled: !sheet.value || errors.value > 0 || pendingNow.value === 0,
			label: lines(
				"Bu sayfayı uygula",
				errors.value > 0
					? `${currentTab.value?.name ?? ""} · önce ${errors.value} hata düzeltilmeli`
					: `${currentTab.value?.name ?? ""} · ${pendingNow.value.toLocaleString("tr-TR")} değişen satır`
			)
		},
		{
			key: "all",
			icon: menuIcon("views"),
			label: lines(
				"Tüm sayfaları uygula…",
				`${waitingSheets.value.length} sayfada ${total.toLocaleString("tr-TR")} değişen satır`
			)
		},
		{
			type: "render",
			key: "note",
			render: () =>
				h(
					"div",
					{ class: "mt-1 flex max-w-80 gap-2 border-t border-divider px-3 pt-2.5 pb-1.5 text-xs text-muted" },
					"Önce bütün sayfalar denetlenir ve ne olacağı gösterilir; siz onaylamadan hiçbir şey gönderilmez."
				)
		}
	]
})

function chooseApply(key: string | number): void {
	if (key === "this") {
		void process()
	} else if (key === "all") {
		applyAllOpen.value = true
	}
}

/**
 * A sheet of the workbook other than the open one, made to check and send it without opening it:
 * its draft, its template, its own columns. Let go with `dispose()` when done.
 */
function backgroundSheet(tab: WorkbookSheet): Sheet | null {
	if (!input.value || !rows.value) {
		return null
	}

	return createSheet(
		input.value,
		rows.value,
		locale,
		{ columns: ref<ColumnLayout>({}), widths: ref<Readonly<Record<string, number>>>({}) },
		{
			sheetId: tab.sheetId,
			kept: tab.draft,
			save: async kept => keepWorkbook(withSheet(workbookNow(), tab.sheetId, { draft: kept })),
			template: templates.value?.find(item => item.id === tab.template) ?? null,
			baseline: tab.meta.blank === true ? [] : rows.value,
			sheets: workbookSheets(workbookNow(), rows.value)
		}
	)
}

/** For the window: the open sheet as it is, or another made in the background. */
function applySheetFor(id: string): { readonly sheet: Sheet; readonly own: boolean } | null {
	if (id === workbook.value?.active) {
		return sheet.value ? { sheet: sheet.value, own: false } : null
	}

	const tab = workbook.value?.sheets.find(each => each.sheetId === id)
	const made = tab ? backgroundSheet(tab) : null

	return made ? { sheet: made, own: true } : null
}

/** A sheet sent in the background: its draft kept, and what its tab shows now. */
async function keepApplied(id: string, made: Sheet): Promise<void> {
	if (id === workbook.value?.active) {
		return
	}

	await made.saver.save()

	const tab = workbook.value?.sheets.find(each => each.sheetId === id)

	if (tab) {
		keepWorkbook(
			withSheet(workbookNow(), id, {
				meta: {
					...tab.meta,
					errors: made.session.issues.summary().errors,
					done: made.session.state.run?.status === "succeeded" && made.session.unfinishedRows().length === 0,
					pending: made.pendingRows()
				}
			})
		)
	}
}

/** From the window to a sheet: its rows with issues only, or one of its rows. */
async function goToSheet(id: string, onlyIssues: boolean, rowId?: RowId): Promise<void> {
	if (id !== workbook.value?.active) {
		await switchTab(id)
	}

	if (onlyIssues) {
		showIssueRows()
	} else if (rowId !== undefined) {
		await nextTick()
		grid.value?.goTo(rowId)
	} else {
		showIssues()
	}
}

// A tab never left in this browser has not said what waits in it: counted once, in the background.
watch(
	() => Boolean(workbook.value && rows.value && input.value && sheet.value),
	ready => {
		if (!ready) {
			return
		}

		for (const tab of workbook.value?.sheets ?? []) {
			if (tab.sheetId === workbook.value?.active || typeof tab.meta.pending === "number" || tab.draft === null) {
				continue
			}

			const made = backgroundSheet(tab)

			if (made) {
				const pending = made.review ? 0 : made.pendingRows()

				made.dispose()
				keepWorkbook(withSheet(workbookNow(), tab.sheetId, { meta: { ...tab.meta, pending } }))
			}
		}
	}
)

/** Tabs wait while the sheet is with the backend, or while a window asks about it. */
const tabsBusy = computed(
	() =>
		!sheet.value ||
		phase.value === "checking" ||
		phase.value === "processing" ||
		phase.value === "unknown" ||
		preparing.value ||
		reviewOpen.value ||
		applyAllOpen.value
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
	keepWorkbook(
		withSheet(workbookNow(), tab.sheetId, {
			meta: { ...tab.meta, errors: errors.value, done: runDone.value, pending: pendingNow.value }
		})
	)
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

/** The ways + adds a sheet: as now, from the server's rows, or empty, for rows to paste or import. */
const ADD_OPTIONS = [
	{ key: "server", label: "Sunucudaki satırlarla", description: "Var olanları güncellemek için, şimdiki gibi" },
	{
		key: "blank",
		label: "Boş sayfa",
		description: "Aynı sütunlar, satır yok: yapıştırmak, içe aktarmak, yazmak için"
	}
] as const

/**
 * A new sheet after the open one, with no template: from the server's rows, or empty, its draft
 * made with no rows so it opens so.
 */
async function addTab(key?: string): Promise<void> {
	if (tabsBusy.value || !input.value) {
		return
	}

	const blank = key === "blank"
	const draft = blank
		? createDraft({ id: newId(), schema: ModuleSchema.from(input.value), store: new RowStore({ rows: [] }) })
		: null

	await leaveTab()
	keepWorkbook(
		addSheet(
			workbookNow(),
			// A blank sheet keeps saying so: what it changed is told against no rows, not the server's.
			{ name: freeName(blank ? "Boş sayfa" : "Sayfa"), ...(draft ? { draft, meta: { blank: true } } : {}) },
			workbookNow().active
		).workbook
	)
	await enterTab()

	if (blank) {
		void nextTick(() => grid.value?.focus())
	}
}

/** A tab renamed whose old name the templates' formulas read with SHEET: the question waiting for the user. */
const renaming = ref<{ readonly from: string; readonly to: string; readonly count: number } | null>(null)
const renameOpen = ref(false)
const renameBusy = ref(false)

/** How many of the templates' formulas name the sheet with SHEET. */
function formulasNaming(name: string): number {
	return (templates.value ?? [])
		.flatMap(template => template.columns ?? [])
		.filter(column => {
			try {
				return column.formula ? formulaSheets(parseFormula(column.formula)).includes(name) : false
			} catch {
				return false
			}
		}).length
}

function renameTab(id: string, name: string): void {
	const from = workbookNow().sheets.find(each => each.sheetId === id)?.name
	const count = from === undefined || from === name ? 0 : formulasNaming(from)

	keepWorkbook(withSheet(workbookNow(), id, { name }))

	if (from !== undefined && count > 0) {
		renaming.value = { from, to: name, count }
		renameOpen.value = true
	}
}

/**
 * The templates whose formulas name the tab's old name, saved with its new one; the open sheet is
 * made again with its template, as saving it in the rules drawer does.
 */
async function renameInFormulas(): Promise<void> {
	const change = renaming.value

	if (!change || renameBusy.value) {
		return
	}

	renameBusy.value = true

	try {
		let openChanged = false

		for (const template of templates.value ?? []) {
			const columns = (template.columns ?? []).map(column =>
				column.formula
					? { ...column, formula: withSheetRenamed(column.formula, change.from, change.to) }
					: column
			)

			if (columns.every((column, index) => column.formula === template.columns?.[index]?.formula)) {
				continue
			}

			await $fetch(`/api/modules/price-update/templates/${template.id}`, {
				method: "PUT",
				body: { ...toRaw(template), columns }
			})
			openChanged ||= template.id === templateId.value
		}

		await refreshTemplates()

		if (openChanged && sheet.value && input.value && rows.value) {
			const carried = sheet.value.store.snapshot()
			const unsaved = sheet.value.saver.dirty

			sheet.value.dispose()
			makeSheet(input.value, rows.value, carried, {})
			saveCarried(unsaved)
		}

		message.success(`Formüller “${change.to}” sayfasını okuyor.`)
		renameOpen.value = false
	} catch {
		message.error("Formüller güncellenemedi; sekmenin adı değişti, formüller eski adı arıyor.")
	} finally {
		renameBusy.value = false
	}
}

watch(renameOpen, open => {
	if (!open) {
		renaming.value = null
	}
})

/** A tab to another place; the open sheet stays open, as it is. */
function moveTab(id: string, to: number): void {
	keepWorkbook(moveSheet(workbookNow(), id, to))
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
		addSheet(
			workbookNow(),
			{
				name: `${source.name} (kopya)`,
				template: source.template,
				draft: copied,
				...(source.meta.blank === true ? { meta: { blank: true } } : {})
			},
			id
		).workbook
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
	const unsaved = current.saver.dirty
	// A template the user just made of what they wrote: the sheet stays as they have it, and says so itself.
	const made = madeTemplate?.id === templateId.value ? madeTemplate : null

	madeTemplate = null
	current.dispose()

	if (made) {
		makeSheet(input.value, rows.value, carried, {})
		dropTemplateFormats(made.template)
		saveCarried(unsaved)

		return
	}

	makeSheet(input.value, rows.value, carried)
	saveCarried(unsaved)

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

/**
 * A sheet made again over the rows it had stops saving with it. A change it had not saved yet is
 * saved by the new one at once, under its schema, rather than when the user next changes something.
 */
function saveCarried(unsaved: boolean): void {
	if (unsaved) {
		void sheet.value?.saver.save()
	}
}

// What waits to be saved is written as the page goes away or out of sight, not two seconds later:
// a reload or a closed tab right after a change keeps it.
const saveWaiting = (): void => void sheet.value?.saver.flush()

useEventListener("pagehide", saveWaiting)
useEventListener(
	() => (import.meta.client ? document : null),
	"visibilitychange",
	() => document.visibilityState === "hidden" && saveWaiting()
)

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

const savedShort = computed(() => {
	const state = version.value >= 0 ? sheet.value?.saver.state : undefined

	if (state?.status === "saving") {
		return "Kaydediliyor…"
	}

	if (state?.status === "failed") {
		return "Kaydedilemedi"
	}

	return state?.savedAt ? `Kaydedildi ${clock(state.savedAt)}` : "Kaydedilmedi"
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

/** A phone's ⋯: the theme, the language and Kaydet, which the app bar has no room for. */
const phoneMenu = computed<DropdownOption[]>(() => [
	{ label: themeLabel.value, key: "theme", icon: menuIcon(dark.value ? "sun" : "moon") },
	{ type: "divider", key: "theme-line" },
	{
		type: "group",
		label: "Dil",
		key: "language",
		children: LOCALES.map(item => ({
			label: item.label,
			key: `locale:${item.value}`,
			icon: item.value === locale.value ? menuIcon("tick") : undefined
		}))
	},
	{ type: "divider", key: "language-line" },
	{ label: "Taslağı şimdi kaydet", key: "save", icon: menuIcon("save"), disabled: !sheet.value }
])

function choosePhoneMenu(key: string | number): void {
	const chosen = String(key)

	if (chosen === "theme") {
		dark.value = !dark.value
	} else if (chosen.startsWith("locale:")) {
		pickLocale(chosen.slice("locale:".length))
	} else if (chosen === "save") {
		void saveDraft()
	}
}

/** A menu item's icon, as Naive UI's menus take it. */
function menuIcon(name: IconName): () => VNode {
	return () => h(AppIcon, { name, size: 16 })
}

/** Reading a file in and writing one out, under one button. */
const fileOptions = computed<DropdownOption[]>(() => [
	{ label: "Taslağı şimdi kaydet (Ctrl+S)", key: "save", icon: menuIcon("save"), disabled: !sheet.value },
	{ type: "divider", key: "save-line" },
	{
		type: "group",
		label: "İçe aktar",
		key: "import",
		children: [
			{ label: "CSV dosyası", key: "import:csv", icon: menuIcon("upload") },
			{ label: "Excel dosyası (sunucuda okunur)", key: "import:xlsx", disabled: true }
		]
	},
	{ type: "divider", key: "file-line" },
	{
		type: "group",
		label: "Dışa aktar",
		key: "export",
		children: [
			{ label: "CSV dosyası", key: "export:csv", icon: menuIcon("download") },
			{
				label: `Hatalı satırlar (${issueRows.value})`,
				key: "export:issues",
				icon: menuIcon("alert"),
				disabled: issueRows.value === 0
			},
			{
				label: "Yalnız sunucunun bulduğu sorunlar",
				key: "export:server-issues",
				disabled: issueRows.value === 0
			},
			{ label: "Excel dosyası (sunucuda yazılır)", key: "export:xlsx", disabled: true }
		]
	}
])

function chooseFile(key: string | number): void {
	if (key === "save") {
		void saveDraft()
	} else if (key === "import:csv") {
		chooseImport()
	} else if (key === "export:csv") {
		chooseExport()
	} else if (key === "export:issues") {
		downloadIssues()
	} else if (key === "export:server-issues") {
		downloadIssues("server")
	}
}

/** Below a wide screen, what the toolbar has no room for: the file, the bulk edits and the rules. */
const moreOptions = computed<DropdownOption[]>(() => [
	...fileOptions.value,
	{ type: "divider", key: "more-line" },
	...bulkOptions,
	{ type: "divider", key: "rules-line" },
	{ label: "Kurallar", key: "rules", icon: menuIcon("rules"), disabled: !drawerTemplate.value }
])

function chooseMore(key: string | number): void {
	const chosen = String(key)

	if (chosen === "rules") {
		rulesOpen.value = true
	} else if (chosen === "save" || chosen.startsWith("import:") || chosen.startsWith("export:")) {
		chooseFile(chosen)
	} else {
		chooseBulk(chosen)
	}
}

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

	const table = await sheet.value.readCsv(file).finally(() => (importing.value = false))

	if (table.length < 2) {
		message.warning("Dosyada başlık satırından sonra satır yok.")

		return
	}

	importMemory.value = readImportMemory(sheet.value.schema.module)
	importFile.value = { name: file.name, table }
	importOpen.value = true
}

/** Where a module's headers went in the last imports: what the import window suggests first. */
const IMPORT_KEY = "tabula-grid.example-nuxt.import"
const importMemory = shallowRef<ImportMemory | null>(null)

function readImportMemory(module: string): ImportMemory | null {
	try {
		const kept = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? "{}") as Record<string, ImportMemory>

		return kept[module] ?? null
	} catch {
		return null
	}
}

function keepImportMemory(module: string, memory: ImportMemory): void {
	try {
		const kept = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? "{}") as Record<string, ImportMemory>
		// A header this file had goes where it went now; the others where they went before.
		const headers = { ...kept[module]?.headers, ...memory.headers }

		localStorage.setItem(IMPORT_KEY, JSON.stringify({ ...kept, [module]: { ...memory, headers } }))
	} catch {
		// Full or switched off: the next import suggests from the headers alone.
	}
}

/** The import window's choice put into the sheet as one change, and said in a line. */
function onImport(choice: ImportChoice, memory: ImportMemory): void {
	const current = sheet.value
	const chosen = importFile.value

	if (!current || !chosen) {
		return
	}

	keepImportMemory(current.schema.module, memory)

	const result = current.importRows(chosen.table, choice)
	const done = [
		result.updated > 0 ? `${result.updated} satır güncellendi` : "",
		result.added > 0 ? `${result.added} satır eklendi` : "",
		result.skipped > 0 ? `${result.skipped} satır alınmadı` : ""
	].filter(Boolean)

	if (result.firstRowId) {
		grid.value?.goTo(result.firstRowId)
	}

	if (done.length === 0) {
		message.info("Dosya tabloda bir şey değiştirmedi.")

		return
	}

	message.success(
		`${done.join(", ")}.${result.unreadable > 0 ? ` ${result.unreadable} hücre okunamadı ve işaretlendi.` : ""} Ctrl+Z geri alır.`
	)
}

/** How many rows have issues: what an issues file would hold. */
const issueRows = computed(() => (version.value >= 0 ? (sheet.value?.session.issues.summary().rows ?? 0) : 0))

/**
 * The rows with issues as a file for Excel, every one or only those the backend found: to fix there
 * and import again, where the rows are found by their product and written into.
 */
function downloadIssues(only?: "server"): void {
	const written = sheet.value?.exportIssueRows(locale.value, only) ?? 0

	if (written === 0) {
		message.info(only ? "Sunucunun bulduğu sorun yok." : "Sorunlu satır yok.")
	} else {
		message.success(`${written} sorunlu satır indirildi. Düzeltip Dosya → İçe aktar ile geri yükleyin.`)
	}
}

/** The last run, when the backend refused some of its rows: said over the sheet until closed. */
const refused = ref<{ readonly succeeded: number; readonly failed: number } | null>(null)

/** Only the rows with issues, and the issues beside them. */
function showIssueRows(): void {
	onlyIssueRows.value = true
	showIssues()
}

/** The sheet has no rows at all, such as an empty one just added: it says how to fill it. */
const sheetEmpty = computed(() => version.value >= 0 && sheet.value !== null && sheet.value.store.size === 0)

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
	const unsaved = sheet.value.saver.dirty

	sheet.value.dispose()
	makeSheet(input.value, rows.value, carried, {})
	dropTemplateFormats(template)
	saveCarried(unsaved)
	message.success("Şablon kaydedildi; kurallar tabloda.")

	return true
}

/** The column formats a template as the rules drawer gives it writes for everyone. */
function formatsOf(template: unknown): ColumnFormats | undefined {
	return (template as { readonly view?: { readonly columns?: ColumnLayout } | null }).view?.columns?.formats
}

/**
 * Takes off the user's own formats that the template just saved now gives, so that a later change to
 * the template reaches them too; what they drew another way stays theirs.
 */
function dropTemplateFormats(template: unknown): void {
	columns.value = withoutColumnFormats(columns.value, formatsOf(template))
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
	// Left for the change of template in the address to find, whenever it comes.
	madeTemplate = { id: made.id, template }
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
	const unsaved = current.saver.dirty

	current.dispose()
	makeSheet(input.value, rows.value, carried, { template: template ?? templateInput.value })
	saveCarried(unsaved)
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

	if (outcome?.status === "valid" || outcome?.status === "invalid") {
		showIssues()
	}

	if (outcome?.status === "valid") {
		message.success("Sunucu sorun bulmadı.")
	} else if (outcome?.status === "invalid") {
		message.warning(`Sunucu ${outcome.issues} sorun buldu.`)
	} else if (outcome) {
		message.error("Kontrol yapılamadı.")
	}
}

// ---------------------------------------------------------------- the issues panel

/** Everything the panel lists: errors, warnings, and those waiting to be checked again. */
const issueCount = computed(() => {
	const summary = version.value >= 0 ? grid.value?.issueSummary : undefined

	return summary ? summary.errors + summary.warnings + summary.stale : 0
})
/** The panel beside the sheet. Without issues the sheet takes the whole width. */
const panelOpen = ref(false)
/** The user closed it: it stays closed until the next check, however many issues come. */
let panelClosed = false
const panelShown = computed(() => panelOpen.value && sheet.value !== null)

// Issues coming open the panel, and its going away closes it; the last one fixed closes it too.
watch(issueCount, (count, before) => {
	if (count === 0) {
		panelOpen.value = false
	} else if (!before && !panelClosed) {
		panelOpen.value = true
	}
})

// The issue-rows filter goes with the panel, so a closed panel leaves no rows hidden.
watch(panelShown, shown => {
	if (!shown && !narrow.value) {
		onlyIssueRows.value = false
	}
})

function togglePanel(): void {
	panelOpen.value = !panelOpen.value
	panelClosed = !panelOpen.value
}

/** The panel's own close button: closed by the user, it stays closed until the next check. */
function closePanel(): void {
	if (!narrow.value) {
		panelOpen.value = false
		panelClosed = true
	}
}

/** After a check or a stopped run: what it found is shown, even where the user closed the panel. */
function showIssues(): void {
	panelClosed = false
	panelOpen.value = issueCount.value > 0
	issuesOpen.value = narrow.value && issueCount.value > 0
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
/** Only the rows with a cell the user coloured by hand. */
const onlyMarked = ref(false)
/** How many rows have a cell the user coloured. */
const markedRows = computed(() => (version.value >= 0 && sheet.value ? sheet.value.marks.rows().length : 0))

watch(onlyChanged, only => {
	sheet.value?.onlyChanged(only)

	if (only) {
		onlyMarked.value = false
	}
})
watch(onlyMarked, only => {
	sheet.value?.onlyMarked(only)

	if (only) {
		onlyChanged.value = false
	}
})

function showAll(): void {
	onlyChanged.value = false
	onlyMarked.value = false
}

/** "Renkli" again: the filter taken anew, to the sheet as it is now. */
function showMarked(): void {
	if (onlyMarked.value) {
		sheet.value?.onlyMarked(true)
	} else {
		onlyMarked.value = true
	}
}

// ---------------------------------------------------------------- how cells look

const ALIGNS: readonly { readonly value: ColumnAlign; readonly label: string; readonly icon: IconName }[] = [
	{ value: "left", label: "Sola yasla", icon: "alignLeft" },
	{ value: "center", label: "Ortala", icon: "alignCenter" },
	{ value: "right", label: "Sağa yasla", icon: "alignRight" }
]

/** The colours last chosen, drawn under the A and the bucket, as a spreadsheet's buttons do. */
const lastColor = ref<MarkColor>("red")
const lastFill = ref<MarkColor>("yellow")

function hexOf(color: MarkColor | null): string {
	return MARK_SWATCHES.find(swatch => swatch.value === color)?.hex ?? "transparent"
}

/** The colours to pick, as a menu: `fill:yellow`, `color:none`. */
function colorMenu(kind: "fill" | "color"): DropdownOption[] {
	return [
		...MARK_SWATCHES.map(swatch => ({
			label: swatch.label,
			key: `${kind}:${swatch.value}`,
			icon: () =>
				h("span", {
					class: "inline-block size-3.5 rounded-sm border border-divider",
					style: {
						background: kind === "fill" ? `color-mix(in srgb, ${swatch.hex} 24%, white)` : swatch.hex
					}
				})
		})),
		{ type: "divider", key: `${kind}-line` },
		{ label: "Rengi kaldır", key: `${kind}:none`, icon: menuIcon("close") }
	]
}

/** The format menu of a narrower screen: everything the format group has. */
const formatOptions: DropdownOption[] = [
	{ label: "Kalın (Ctrl+B)", key: "bold" },
	{ label: "İtalik (Ctrl+I)", key: "italic" },
	{ label: "Yazı rengi", key: "color", children: colorMenu("color") },
	{ label: "Hücre rengi", key: "fill", icon: menuIcon("bucket"), children: colorMenu("fill") },
	{ type: "divider", key: "format-line" },
	{ label: "Sola yasla", key: "align:left", icon: menuIcon("alignLeft") },
	{ label: "Ortala", key: "align:center", icon: menuIcon("alignCenter") },
	{ label: "Sağa yasla", key: "align:right", icon: menuIcon("alignRight") },
	{ type: "divider", key: "decimals-line" },
	{ label: "Ondalığı azalt", key: "decimals:-1" },
	{ label: "Ondalığı artır", key: "decimals:1" },
	{ type: "divider", key: "clear-line" },
	{ label: "Biçimi temizle", key: "clear", icon: menuIcon("eraser") }
]

/** The alignment, one menu in the toolbar: its icon is the one the selected columns have. */
const alignMenu = computed<DropdownOption[]>(() =>
	ALIGNS.map(item => ({ label: item.label, key: item.value, icon: menuIcon(item.icon) }))
)
const alignIcon = computed<IconName>(() => ALIGNS.find(item => item.value === activeAlign.value)?.icon ?? "alignLeft")

function chooseAlign(key: string | number): void {
	alignColumns(String(key) as ColumnAlign)
}

function chooseFormat(key: string | number): void {
	const chosen = String(key)

	if (chosen === "bold" || chosen === "italic") {
		toggleMark(chosen)
	} else if (chosen.startsWith("align:")) {
		alignColumns(chosen.slice("align:".length) as ColumnAlign)
	} else if (chosen.startsWith("decimals:")) {
		stepDecimals(chosen.endsWith("-1") ? -1 : 1)
	} else if (chosen === "clear") {
		clearFormat()
	} else {
		chooseColorKey(chosen)
	}
}

function nothingSelected(): void {
	message.warning("Önce hücreleri seçin.")
}

function toggleMark(style: "bold" | "italic"): void {
	if (!grid.value?.toggleSelection(style)) {
		nothingSelected()
	}

	grid.value?.focus()
}

/** `fill:yellow` or `color:none`, from a colour menu. */
function chooseColorKey(key: string | number): void {
	const [kind, value] = String(key).split(":") as ["fill" | "color", string]
	const color = value === "none" ? null : (value as MarkColor)

	if (!grid.value?.markSelection({ [kind]: color })) {
		nothingSelected()
	} else if (color) {
		if (kind === "fill") {
			lastFill.value = color
		} else {
			lastColor.value = color
		}
	}

	grid.value?.focus()
}

/** The column formats the template writes for everyone: drawn under the user's own. */
const templateFormats = computed(() => sheet.value?.template?.view?.columns.formats)

/** Where the active cell's column puts its values, when the user or the template chose. */
const activeAlign = computed(() => {
	const key = grid.value?.cell?.field.key

	return key ? (mergeColumnFormats(templateFormats.value, columns.value.formats)[key]?.align ?? null) : null
})

/** The columns the selection spans, aligned; the alignment they had taken off when it is pressed again. */
function alignColumns(align: ColumnAlign): void {
	const keys = grid.value?.selectedFields() ?? []

	if (keys.length === 0) {
		nothingSelected()

		return
	}

	const again = keys.every(key => columns.value.formats?.[key]?.align === align)

	columns.value = keys.reduce(
		(layout, key) => withColumnFormat(layout, key, { align: again ? undefined : align }),
		columns.value
	)
	grid.value?.focus()
}

/** One digit more or fewer after the point, in the number columns the selection spans. */
function stepDecimals(by: 1 | -1): void {
	const current = sheet.value

	if (!current) {
		return
	}

	const keys = (grid.value?.selectedFields() ?? []).filter(key =>
		["integer", "decimal", "money", "quantity", "percent"].includes(current.schema.field(key).type)
	)

	if (keys.length === 0) {
		message.warning("Ondalık yalnız sayı sütunlarında değişir; bir sayı sütununda hücre seçin.")

		return
	}

	columns.value = keys.reduce((layout, key) => {
		const shown =
			layout.formats?.[key]?.decimals ??
			templateFormats.value?.[key]?.decimals ??
			digitsFor(current.schema.field(key), valueSettings.value)
		const next = Math.min(MAX_SHOWN_DECIMALS, Math.max(0, shown + by))

		return withColumnFormat(layout, key, { decimals: next })
	}, columns.value)
	grid.value?.focus()
}

function clearFormat(): void {
	if (!grid.value?.clearSelectionMarks()) {
		nothingSelected()
	}

	grid.value?.focus()
}

// ---------------------------------------------------------------- find, density, zoom, shortcuts

const findOpen = ref(false)
const found = ref<{ readonly cells: readonly FoundCell[]; readonly current: FoundCell | null } | null>(null)

function onReplaced(count: number, skipped: number): void {
	if (count > 0) {
		message.success(`${count} hücre değişti. Ctrl+Z geri alır.`)
	}

	if (skipped > 0) {
		message.warning(`${skipped} hücre değiştirilemedi: sütunu ya da satırı yazılamıyor.`)
	}
}

const DENSITIES = [
	{ value: "compact", label: "Sık" },
	{ value: "normal", label: "Normal" },
	{ value: "comfortable", label: "Rahat" }
] as const
const DENSITY_HEIGHTS = { compact: 26, normal: 30, comfortable: 36 } as const
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const
const VIEW_KEY = "tabula-grid.example-nuxt.view"

const density = ref<(typeof DENSITIES)[number]["value"]>("normal")
const zoom = ref(1)

const sizeLabel = computed(
	() => `${DENSITIES.find(item => item.value === density.value)?.label ?? ""} · %${Math.round(zoom.value * 100)}`
)
const sizeOptions = computed<DropdownOption[]>(() => [
	{
		type: "group",
		label: "Satır sıklığı",
		key: "density",
		children: DENSITIES.map(item => ({
			label: item.label,
			key: `density:${item.value}`,
			icon: item.value === density.value ? menuIcon("tick") : undefined
		}))
	},
	{ type: "divider", key: "size-line" },
	{
		type: "group",
		label: "Yakınlaştırma",
		key: "zoom",
		children: ZOOMS.map(step => ({
			label: `%${Math.round(step * 100)}`,
			key: `zoom:${step}`,
			icon: Math.abs(step - zoom.value) < 0.001 ? menuIcon("tick") : undefined
		}))
	}
])

function chooseSize(key: string | number): void {
	const [kind, value] = String(key).split(":")
	const picked = DENSITIES.find(item => item.value === value)

	if (kind === "density" && picked) {
		density.value = picked.value
	} else if (kind === "zoom") {
		zoom.value = Number(value) || 1
	}
}

// Read once the page is in the browser, so the server's page and the first one drawn agree.
onMounted(() => {
	try {
		const kept = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as { density?: string; zoom?: number } | null

		if (kept && DENSITIES.some(item => item.value === kept.density)) {
			density.value = kept.density as typeof density.value
		}

		if (kept && ZOOMS.includes(kept.zoom as (typeof ZOOMS)[number])) {
			zoom.value = kept.zoom as number
		}
	} catch {
		// A browser that keeps nothing draws the sheet as it comes.
	}
})

watch([density, zoom], () => {
	try {
		localStorage.setItem(VIEW_KEY, JSON.stringify({ density: density.value, zoom: zoom.value }))
	} catch {
		// Kept for this visit only.
	}
})

const shortcutsOpen = ref(false)

useEventListener("keydown", (event: KeyboardEvent) => {
	if (event.key === "F1") {
		event.preventDefault()
		shortcutsOpen.value = true
	} else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
		event.preventDefault()
		void saveDraft()
	} else if (event.key === "F8" && sheet.value && issueCount.value > 0) {
		event.preventDefault()
		stepIssues(event.shiftKey ? -1 : 1)
	}
})

/** The next or the previous issue, the panel or a phone's half sheet opened for it first. */
async function stepIssues(by: 1 | -1): Promise<void> {
	if (narrow.value) {
		issuesOpen.value = true
	} else if (!panelShown.value) {
		togglePanel()
	}

	await nextTick()

	if (by > 0) {
		issuesPanel.value?.next()
	} else {
		issuesPanel.value?.previous()
	}
}

const SHORTCUTS: readonly { readonly title: string; readonly items: readonly { keys: string; what: string }[] }[] = [
	{
		title: "Gezinme",
		items: [
			{ keys: "Oklar", what: "Hücreden hücreye" },
			{ keys: "Ctrl+Ok", what: "Dolu bloğun sonuna" },
			{ keys: "Tab · Shift+Tab", what: "Sağa · sola" },
			{ keys: "Home · End", what: "Satırın başına · sonuna" },
			{ keys: "Ctrl+Home · Ctrl+End", what: "Tablonun başına · sonuna" },
			{ keys: "PageUp · PageDown", what: "Bir sayfa yukarı · aşağı" }
		]
	},
	{
		title: "Düzenleme",
		items: [
			{ keys: "F2 ya da yazmak", what: "Hücreyi düzenle" },
			{ keys: "Enter", what: "Yaz ve aşağı geç" },
			{ keys: "Esc", what: "Vazgeç" },
			{ keys: "Delete", what: "Seçimi temizle" },
			{ keys: "Ctrl+D · Ctrl+R", what: "Aşağı · sağa doldur" },
			{ keys: "Alt+↓", what: "Seçenek listesini aç" },
			{ keys: "Ctrl+Z · Ctrl+Y", what: "Geri al · yinele" }
		]
	},
	{
		title: "Seçim ve pano",
		items: [
			{ keys: "Shift+Ok", what: "Seçimi genişlet" },
			{ keys: "Ctrl+A", what: "Hepsini seç" },
			{ keys: "Shift+Space · Ctrl+Space", what: "Satırı · sütunu seç" },
			{ keys: "Ctrl+C · Ctrl+X · Ctrl+V", what: "Kopyala · kes · yapıştır" },
			{ keys: "Shift+F10", what: "Hücre menüsü" }
		]
	},
	{
		title: "Satırlar, biçim ve bulma",
		items: [
			{ keys: "Ctrl++ · Ctrl+−", what: "Satır ekle · satırları sil" },
			{ keys: "Ctrl+B · Ctrl+I", what: "Kalın · italik" },
			{ keys: "Ctrl+H", what: "Bul ve değiştir" },
			{ keys: "Ctrl+Shift+Ok", what: "Sayfa sekmesini sola · sağa taşı" },
			{ keys: "F8 · Shift+F8", what: "Sonraki · önceki sorun" },
			{ keys: "Ctrl+S", what: "Taslağı şimdi kaydet" },
			{ keys: "F1", what: "Bu pencere" }
		]
	}
]

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

/** The bulk changes under one button, each on the cells selected; the grid's menu has them too. */
const bulkOptions: DropdownOption[] = [
	{
		type: "group",
		label: "Seçili hücrelere uygulanır",
		key: "bulk",
		children: [
			{ label: "Yüzde uygula…", key: "percent", icon: menuIcon("percent") },
			{ label: "Tutar ekle…", key: "add", icon: menuIcon("plus") },
			{ label: "Yuvarla", key: "round", icon: menuIcon("round"), children: roundOptions }
		]
	},
	{
		label: () =>
			h("span", { class: "flex w-full items-center justify-between gap-6" }, [
				"Bul ve değiştir…",
				h("span", { class: "text-xs text-muted" }, "Ctrl+H")
			]),
		key: "find",
		icon: menuIcon("search")
	},
	{ type: "divider", key: "bulk-line" },
	{
		label: () =>
			h("span", { class: "flex w-full items-center justify-between gap-6" }, [
				"Satırları sil",
				h("span", { class: "text-xs text-muted" }, "Ctrl+−")
			]),
		key: "remove",
		icon: menuIcon("trash")
	}
]

function chooseBulk(key: string | number): void {
	const chosen = String(key)

	if (chosen === "percent" || chosen === "add") {
		openAdjust(chosen)
	} else if (chosen === "find") {
		findOpen.value = true
	} else if (chosen === "remove") {
		removeRows()
	} else {
		chooseRound(chosen)
	}
}

/** One of a phone's tools. One with a `menu` opens it; one with a `value` shows it beside its name. */
interface Tool {
	readonly key: string
	readonly label: string
	readonly icon?: IconName
	/** Drawn in place of an icon, such as a decimals button's ",00→". */
	readonly text?: string
	readonly menu?: DropdownOption[]
	readonly value?: string
	readonly disabled?: boolean
}

/** A phone's format, as eight tiles. */
const formatTiles = computed<readonly Tool[]>(() => [
	{ key: "bold", label: "Kalın" },
	{ key: "italic", label: "İtalik" },
	{ key: "color", label: "Yazı rengi", icon: "format", menu: colorMenu("color") },
	{ key: "fill", label: "Hücre rengi", icon: "bucket", menu: colorMenu("fill") },
	{ key: "align", label: "Hizala", icon: alignIcon.value, menu: alignMenu.value },
	{ key: "decimals:-1", label: "Azalt", text: "←,0" },
	{ key: "decimals:1", label: "Artır", text: ",00→" },
	{ key: "clear", label: "Temizle", icon: "eraser" }
])

/** A phone's sheet settings, each with its value. */
const pageTools = computed<readonly Tool[]>(() => {
	const all = input.value?.fields.length ?? 0

	return [
		{
			key: "columns",
			label: "Sütunlar",
			icon: "columns",
			value: `${all - (columns.value.hidden?.length ?? 0)} / ${all}`
		},
		{ key: "view", label: "Görünüm", icon: "views", value: viewLabel.value, menu: viewOptions.value },
		{ key: "template", label: "Şablon", icon: "template", value: templateLabel.value, menu: templateOptions.value },
		{ key: "rules", label: "Kurallar", icon: "rules", disabled: !drawerTemplate.value },
		{ key: "find", label: "Bul ve değiştir", icon: "search" }
	]
})

/** What the tools act on: the selection's address and how many cells it spans. */
const selectionText = computed(() => {
	const area = version.value >= 0 ? grid.value?.selected : null

	return area ? `${area.address} · ${(area.rows * area.columns).toLocaleString("tr-TR")} hücre` : ""
})

/** A tool chosen in the phone's sheet, which steps aside for what it opens. */
function chooseTool(key: string, choice?: string | number): void {
	toolsOpen.value = false

	if (key === "import") {
		chooseImport()
	} else if (key === "export") {
		chooseExport()
	} else if (key === "percent" || key === "add") {
		openAdjust(key)
	} else if (key === "round" && choice !== undefined) {
		chooseRound(String(choice))
	} else if (key === "remove") {
		removeRows()
	} else if (key === "columns") {
		columnsOpen.value = true
	} else if (key === "view" && choice !== undefined) {
		chooseView(choice)
	} else if (key === "template" && choice !== undefined) {
		chooseTemplate(choice)
	} else if (key === "rules") {
		rulesOpen.value = true
	} else if (key === "bold" || key === "italic") {
		toggleMark(key)
	} else if ((key === "fill" || key === "color") && choice !== undefined) {
		chooseColorKey(choice)
	} else if (key === "align" && choice !== undefined) {
		chooseAlign(choice)
	} else if (key.startsWith("decimals:")) {
		stepDecimals(key.endsWith("-1") ? -1 : 1)
	} else if (key === "clear") {
		clearFormat()
	} else if (key === "find") {
		findOpen.value = true
	}
}

/** The page's own items in the grid's right-click menu: the bulk changes, each with its window. */
const menuItems = computed<GridMenuItem[]>(() => [
	{
		key: "bulk",
		label: "Toplu düzenle",
		children: [
			{ key: "percent", label: "Yüzde uygula…" },
			{ key: "add", label: "Tutar ekle…" },
			{ key: "bulk-line", label: "", kind: "line" },
			// The ways to round, under a title of their own: the menu goes no deeper than two.
			{ key: "round-heading", label: "Yuvarla", kind: "heading" },
			...roundOptions.map(option => ({ key: `round:${String(option.key)}`, label: String(option.label) }))
		]
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
		showIssues()

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
		showIssues()
	} else if (outcome.status === "succeeded" || outcome.status === "partial" || outcome.status === "failed") {
		message.info(`${outcome.succeeded} satır uygulandı, ${outcome.failed} satır uygulanamadı.`)
		refused.value = outcome.failed > 0 ? { succeeded: outcome.succeeded, failed: outcome.failed } : null
	} else if (outcome.status === "nothing") {
		message.info("Gönderilecek satır yok.")
	} else {
		message.error("Değişiklikler uygulanamadı.")
	}
}
</script>
