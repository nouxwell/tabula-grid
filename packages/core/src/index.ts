/**
 * The version of this package.
 *
 * It repeats what `package.json` says, and a test holds the two together: a release that bumps
 * one and forgets the other fails before it is tagged.
 */
export const version = "0.5.0"

export { SchemaError, TabulaError } from "./errors.js"
export type { SchemaProblem, TabulaErrorCode } from "./errors.js"

export type { CellObject, CellValue } from "./value.js"

export { CUSTOMIZATIONS, FIELD_TYPES, ModuleSchema } from "./schema.js"
export type {
	BoolField,
	Customization,
	DateField,
	DecimalField,
	FieldInput,
	FieldOption,
	FieldRule,
	FieldSchema,
	FieldTone,
	FieldType,
	IntegerField,
	LookupField,
	ModuleSchemaInput,
	MoneyField,
	OptionInput,
	OptionsField,
	RuleInput,
	TextField
} from "./schema.js"

export { RowStore } from "./rows.js"
export type {
	CellWrite,
	RemovedRow,
	RowEntry,
	RowId,
	RowInit,
	RowStoreOptions,
	RowValues,
	StoreChange,
	StoreOperation,
	TransactOptions
} from "./rows.js"

export { REDO_ORIGIN, UNDO_ORIGIN, UndoHistory } from "./history.js"
export type { HistoryStep, UndoHistoryOptions } from "./history.js"

export { LOOKUP_ORIGIN, LookupResolver } from "./lookup.js"
export type {
	LookupAdapters,
	LookupItem,
	LookupResolveRequest,
	LookupResolveResponse,
	LookupResolverOptions,
	LookupSearch,
	LookupSearchRequest,
	LookupSearchResponse
} from "./lookup.js"

export { applyFormulas, FORMULA_ORIGIN, FormulaEngine } from "./formula/engine.js"
export type { FormulaEngineOptions } from "./formula/engine.js"
export {
	boolValue as formulaBool,
	EMPTY as FORMULA_EMPTY,
	errorValue as formulaError,
	FUNCTIONS as FORMULA_FUNCTIONS,
	formulaNumber,
	numberArgument,
	textValue as formulaText
} from "./formula/evaluate.js"
export type { FormulaFunction, FormulaValue } from "./formula/evaluate.js"
export { formulaFields, parseFormula } from "./formula/parse.js"
export {
	formulaCaret,
	formulaFromAddresses,
	formulaParts,
	formulaWithKeys,
	formulaWithLabels
} from "./formula/assist.js"
export type { FormulaCall, FormulaCaret, FormulaPart, FormulaToken, NamedField } from "./formula/assist.js"
export type { BinaryOperator, FormulaNode } from "./formula/parse.js"
export { isFormulaError } from "./formula/error.js"
export type { FormulaErrorCode, FormulaErrorValue } from "./formula/error.js"

export { RowView, rowsWithIssues, rowsWithResult } from "./view.js"
export type { RowFilter, RowOrder } from "./view.js"
export { summarizeCells } from "./summary.js"
export {
	compareValues,
	distinctValues,
	filterKey,
	filterKeys,
	hasRange,
	rowOrder,
	rowsContaining,
	rowsMatching
} from "./filters.js"
export { fillValues } from "./fill.js"
export { adjustValue, isAdjustable } from "./adjust.js"
export type { Adjustment } from "./adjust.js"
export { rowsChanged, SheetChanges } from "./changes.js"
export type { ChangeSummary, SheetChangesOptions } from "./changes.js"
export { breaksCheck, checkFields, COMPARISONS, CONDITION_OPS, conditionHolds, rowsBreaking } from "./checks.js"
export type {
	CheckInput,
	CheckSeverity,
	Comparison,
	ConditionInput,
	ConditionOp,
	RowCheck,
	RowCondition
} from "./checks.js"
export {
	applyTemplate,
	readTemplate,
	TEMPLATE_FORMAT,
	TEMPLATE_VERSION,
	templateProblems,
	withDefaults
} from "./templates.js"
export type { GridTemplate, TemplateFieldChange, TemplateProblem } from "./templates.js"
export {
	addView,
	emptyViews,
	PLAIN_VIEW,
	readViews,
	readViewState,
	removeView,
	renameView,
	sameView,
	setDefaultView,
	updateView,
	VIEW_NAME_LIMIT,
	viewFor,
	viewNameProblem,
	VIEWS_FORMAT,
	VIEWS_VERSION
} from "./views.js"
export type { SavedView, SavedViews, ViewNameOptions, ViewNameProblem, ViewState } from "./views.js"
export type { FillMode, FillOptions } from "./fill.js"
export type { ColumnCondition, ColumnFilters, ColumnSort, DistinctValue, SearchOptions } from "./filters.js"
export type { CellSummary } from "./summary.js"

export { Selection } from "./selection.js"
export type { CellPosition, CellRange, Direction, IsBlank, MoveOptions } from "./selection.js"

export { parseTsv, toTsv } from "./clipboard.js"

export { decodeText, detectDelimiter, parseCsv, toCsv } from "./csv.js"
export type { CsvDelimiter, CsvReadOptions, CsvWriteOptions } from "./csv.js"
export {
	applyImport,
	csvDelimiterFor,
	exportTable,
	headerKey,
	IMPORT_ORIGIN,
	importTable,
	matchRows,
	suggestColumns,
	suggestMatch
} from "./table.js"
export type {
	ColumnMatch,
	ColumnStatus,
	ColumnSuggestion,
	ExtraColumn,
	ImportApplied,
	ImportApplyOptions,
	MatchSuggestion,
	SuggestionReason,
	SuggestOptions,
	TableExportOptions,
	TableImport,
	TableImportOptions
} from "./table.js"

export { checkValue, isBlankRow, SheetValidator } from "./validation.js"
export type {
	Issue,
	IssueScope,
	IssueSet,
	IssueSeverity,
	IssueSummary,
	IssueTarget,
	LocalIssueCode
} from "./validation.js"

export { readCheckResponse, readProcessResponse } from "./contract.js"
export type {
	AdapterContext,
	CheckResponse,
	IssueInput,
	PayloadRow,
	ProcessProgress,
	ProcessRequest,
	ProcessResponse,
	ProcessStatus,
	RowAction,
	RowOutcome,
	RowPlanInput,
	RowResultInput,
	SheetAdapters,
	SheetRequest,
	StatusQuery
} from "./contract.js"

export { createDraft, DRAFT_FORMAT, DRAFT_VERSION, mapDraft, openDraft, readDraft, suggestRenames } from "./draft.js"
export type {
	CreateDraftOptions,
	Draft,
	DraftChanges,
	DraftField,
	DraftFieldMapping,
	DraftMapping,
	DraftOpening,
	DraftView,
	MapDraftOptions,
	OpenDraftOptions
} from "./draft.js"

export {
	addSheet,
	createWorkbook,
	freeSheetId,
	moveSheet,
	openSheet,
	readWorkbook,
	removeSheet,
	withSheet,
	WORKBOOK_FORMAT,
	WORKBOOK_VERSION
} from "./workbook.js"
export type { NewSheet, SheetMeta, Workbook, WorkbookSheet } from "./workbook.js"

export { DraftSaver } from "./saver.js"
export type { DraftSaverOptions, SaverState, SaverStatus } from "./saver.js"

export { SheetSession } from "./session.js"
export type {
	CheckOutcome,
	CheckRecord,
	PendingRun,
	PersistedSession,
	PlannedAction,
	PlannedChange,
	ProcessOutcome,
	ProcessPlan,
	RowPlan,
	RowResult,
	RowResults,
	RunRecord,
	RunStatus,
	SessionFailure,
	SessionPhase,
	SessionState,
	SheetSessionOptions
} from "./session.js"

export { defineValueSettings, VALUE_SETTINGS } from "./values/settings.js"
export type { ValueSettings } from "./values/settings.js"
export { isFieldValue, readInput, valueProblem } from "./values/read.js"
export type { ReadResult, ValueProblem, ValueProblemCode } from "./values/read.js"
export { digitsFor, editText, formatCell } from "./values/format.js"
export type { CellFormatOptions } from "./values/format.js"
export { CellMarks, MARK_COLORS, readMarks, rowsMarked } from "./marks.js"
export type { CellMark, CellMarkChange, CellMarksOptions, MarkColor, MarkedCell, MarksData } from "./marks.js"
export { readStyleRules, rowStyles, rowsStyled, styleApplies, styleRuleToJson } from "./styles.js"
export type { CellStyle, StyleRule, StyleRuleInput } from "./styles.js"
export { findCells, REPLACE_ORIGIN, replaceCells } from "./find.js"
export type { FindOptions, FoundCell, ReplaceOptions, ReplaceResult } from "./find.js"

export {
	arrangeColumns,
	autoColumnWidth,
	clampColumnWidth,
	DEFAULT_COLUMN_SIZING,
	COLUMN_ALIGNS,
	freezeColumnLayout,
	headerDisplayText,
	mapColumnLayout,
	MAX_SHOWN_DECIMALS,
	mergeColumnFormats,
	readColumnLayout,
	resolveColumnSizing,
	sameColumnFormats,
	withColumn,
	withColumnFormat,
	withoutColumnFormats
} from "./columns.js"
export type {
	ArrangedColumns,
	ColumnAlign,
	ColumnFormat,
	ColumnFormats,
	ColumnLayout,
	ColumnSizing
} from "./columns.js"
