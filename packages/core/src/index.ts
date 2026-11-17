/**
 * The version of this package.
 *
 * It repeats what `package.json` says, and a test holds the two together: a release that bumps
 * one and forgets the other fails before it is tagged.
 */
export const version = "0.0.0"

export { SchemaError, TabulaError } from "./errors"
export type { SchemaProblem, TabulaErrorCode } from "./errors"

export type { CellObject, CellValue } from "./value"

export { CUSTOMIZATIONS, FIELD_TYPES, ModuleSchema } from "./schema"
export type {
	BoolField,
	Customization,
	DateField,
	DecimalField,
	FieldInput,
	FieldOption,
	FieldRule,
	FieldSchema,
	FieldType,
	IntegerField,
	LookupField,
	ModuleSchemaInput,
	MoneyField,
	OptionInput,
	OptionsField,
	RuleInput,
	TextField
} from "./schema"

export { RowStore } from "./rows"
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
} from "./rows"

export { REDO_ORIGIN, UNDO_ORIGIN, UndoHistory } from "./history"
export type { UndoHistoryOptions } from "./history"

export { LOOKUP_ORIGIN, LookupResolver } from "./lookup"
export type {
	LookupAdapters,
	LookupItem,
	LookupResolveRequest,
	LookupResolveResponse,
	LookupResolverOptions,
	LookupSearch,
	LookupSearchRequest,
	LookupSearchResponse
} from "./lookup"

export { applyFormulas, FORMULA_ORIGIN, FormulaEngine } from "./formula/engine"
export type { FormulaEngineOptions } from "./formula/engine"
export {
	boolValue as formulaBool,
	EMPTY as FORMULA_EMPTY,
	errorValue as formulaError,
	FUNCTIONS as FORMULA_FUNCTIONS,
	formulaNumber,
	numberArgument,
	textValue as formulaText
} from "./formula/evaluate"
export type { FormulaFunction, FormulaValue } from "./formula/evaluate"
export { formulaFields, parseFormula } from "./formula/parse"
export type { BinaryOperator, FormulaNode } from "./formula/parse"
export { isFormulaError } from "./formula/error"
export type { FormulaErrorCode, FormulaErrorValue } from "./formula/error"

export { RowView, rowsWithIssues, rowsWithResult } from "./view"
export type { RowFilter } from "./view"

export { Selection } from "./selection"
export type { CellPosition, CellRange, Direction, IsBlank, MoveOptions } from "./selection"

export { parseTsv, toTsv } from "./clipboard"

export { decodeText, detectDelimiter, parseCsv, toCsv } from "./csv"
export type { CsvDelimiter, CsvReadOptions, CsvWriteOptions } from "./csv"
export { csvDelimiterFor, exportTable, importTable } from "./table"
export type { ColumnMatch, ColumnStatus, TableExportOptions, TableImport, TableImportOptions } from "./table"

export { checkValue, SheetValidator } from "./validation"
export type {
	Issue,
	IssueScope,
	IssueSet,
	IssueSeverity,
	IssueSummary,
	IssueTarget,
	LocalIssueCode
} from "./validation"

export { readCheckResponse, readProcessResponse } from "./contract"
export type {
	AdapterContext,
	CheckResponse,
	IssueInput,
	PayloadRow,
	ProcessProgress,
	ProcessRequest,
	ProcessResponse,
	ProcessStatus,
	RowOutcome,
	RowResultInput,
	SheetAdapters,
	SheetRequest,
	StatusQuery
} from "./contract"

export { createDraft, DRAFT_FORMAT, DRAFT_VERSION, openDraft, readDraft } from "./draft"
export type {
	CreateDraftOptions,
	Draft,
	DraftChanges,
	DraftField,
	DraftOpening,
	DraftView,
	OpenDraftOptions
} from "./draft"

export { DraftSaver } from "./saver"
export type { DraftSaverOptions, SaverState, SaverStatus } from "./saver"

export { SheetSession } from "./session"
export type {
	CheckOutcome,
	CheckRecord,
	PendingRun,
	PersistedSession,
	ProcessOutcome,
	RowResult,
	RowResults,
	RunRecord,
	RunStatus,
	SessionFailure,
	SessionPhase,
	SessionState,
	SheetSessionOptions
} from "./session"

export { defineValueSettings, VALUE_SETTINGS } from "./values/settings"
export type { ValueSettings } from "./values/settings"
export { isFieldValue, readInput, valueProblem } from "./values/read"
export type { ReadResult, ValueProblem, ValueProblemCode } from "./values/read"
export { digitsFor, editText, formatCell } from "./values/format"

export {
	arrangeColumns,
	autoColumnWidth,
	clampColumnWidth,
	DEFAULT_COLUMN_SIZING,
	headerDisplayText,
	resolveColumnSizing,
	withColumn
} from "./columns"
export type { ArrangedColumns, ColumnLayout, ColumnSizing } from "./columns"
