import { compareDecimal, normalizeDecimal } from "./decimal"
import { SchemaError, TabulaError, type SchemaProblem } from "./errors"
import { compilePattern } from "./values/date"

/**
 * The module schema: the developer's definition of a sheet, as the backend sends it.
 *
 * It is the same vocabulary as `Field` in nouxwell/tabula, written as JSON: one key per column that
 * never changes, a type, and the rules nobody further down may loosen. A user's template and view
 * are layered on top of it later; nothing here can be overridden by them.
 *
 * A schema this package does not fully understand is refused, not half applied. An unknown property
 * or rule is an error rather than something skipped, because a skipped rule is a rule that quietly
 * stops being checked.
 */

export const FIELD_TYPES = Object.freeze([
	"string",
	"integer",
	"decimal",
	"money",
	"quantity",
	"percent",
	"bool",
	"date",
	"datetime",
	"options",
	"lookup"
] as const)

export type FieldType = (typeof FIELD_TYPES)[number]

/** How far a user's template may change the sheet: not at all, within the schema's limits, or freely. */
export const CUSTOMIZATIONS = Object.freeze(["fixed", "controlled", "free"] as const)

export type Customization = (typeof CUSTOMIZATIONS)[number]

/** A limit on a field's value. `min` and `max` are decimal text, so they mean exactly what they say. */
export type FieldRule =
	| { readonly rule: "min" | "max"; readonly value: string }
	| { readonly rule: "minLength" | "maxLength"; readonly value: number }
	| { readonly rule: "unique" }

export interface FieldOption {
	/** What is stored and sent. */
	readonly value: string | number
	/** What the user reads. */
	readonly label: string
}

interface FieldBase {
	/** The field's identity: what the backend receives and what every rule, issue and formula refers to. */
	readonly key: string
	/** The column's header. Changing it changes nothing else. */
	readonly label: string
	readonly required: boolean
	readonly editable: boolean
	/** Whether the field is part of what is sent for processing. False for a column shown for reference. */
	readonly submit: boolean
	readonly rules: readonly FieldRule[]
	/** A sample value, as text, for the column's help. */
	readonly example: string | null
}

export interface TextField extends FieldBase {
	readonly type: "string"
}

export interface IntegerField extends FieldBase {
	readonly type: "integer"
}

export interface DecimalField extends FieldBase {
	readonly type: "decimal" | "quantity" | "percent"
	/** Digits after the point; null leaves it to the sheet's settings for the type. */
	readonly decimals: number | null
}

export interface MoneyField extends FieldBase {
	readonly type: "money"
	readonly decimals: number | null
	/** A fixed currency code, or null when the currency comes from elsewhere. */
	readonly currency: string | null
}

export interface BoolField extends FieldBase {
	readonly type: "bool"
}

export interface DateField extends FieldBase {
	readonly type: "date" | "datetime"
	/** The field's own pattern in PHP's notation, such as `d.m.Y`; null leaves it to the sheet's settings. */
	readonly pattern: string | null
}

export interface OptionsField extends FieldBase {
	readonly type: "options"
	readonly options: readonly FieldOption[]
	/** Whether a cell holds a list of options rather than one. */
	readonly multiple: boolean
}

export interface LookupField extends FieldBase {
	readonly type: "lookup"
	/**
	 * Which lookup the application's adapter is asked, such as `"product"`. The cell shows a label and
	 * sends an id; the adapter is what turns one into the other.
	 */
	readonly lookup: string
}

export type FieldSchema =
	TextField | IntegerField | DecimalField | MoneyField | BoolField | DateField | OptionsField | LookupField

/** A rule as it is written in the JSON. */
export type RuleInput =
	| { rule: "min" | "max"; value: string | number }
	| { rule: "minLength" | "maxLength"; value: number }
	| { rule: "unique" }

export interface OptionInput {
	value: string | number
	label?: string
}

/** A field as it is written in the JSON. Which properties a field takes depends on its type. */
export interface FieldInput {
	key: string
	type: FieldType
	label?: string
	required?: boolean
	editable?: boolean
	submit?: boolean
	rules?: RuleInput[]
	example?: string
	/** decimal, quantity, percent and money */
	decimals?: number
	/** money */
	currency?: string
	/** options */
	options?: OptionInput[]
	/** options */
	multiple?: boolean
	/** lookup */
	lookup?: string
	/** date and datetime */
	pattern?: string
}

/** The module schema as it is written in the JSON. */
export interface ModuleSchemaInput {
	module: string
	schemaVersion: number
	title?: string
	customization?: Customization
	fields: FieldInput[]
}

const MODULE_PROPERTIES = ["module", "schemaVersion", "title", "customization", "fields"]
const COMMON_PROPERTIES = ["key", "type", "label", "required", "editable", "submit", "rules", "example"]

const TYPE_PROPERTIES: Readonly<Record<FieldType, readonly string[]>> = {
	string: [],
	integer: [],
	decimal: ["decimals"],
	money: ["decimals", "currency"],
	quantity: ["decimals"],
	percent: ["decimals"],
	bool: [],
	date: ["pattern"],
	datetime: ["pattern"],
	options: ["options", "multiple"],
	lookup: ["lookup"]
}

const TYPED_PROPERTIES: ReadonlySet<string> = new Set(Object.values(TYPE_PROPERTIES).flat())
const NUMERIC_TYPES: ReadonlySet<FieldType> = new Set(["integer", "decimal", "money", "quantity", "percent"])
const RULE_KINDS = ["min", "max", "minLength", "maxLength", "unique"] as const

type RuleKind = (typeof RULE_KINDS)[number]
type Json = Record<string, unknown>

interface ModuleData {
	readonly module: string
	readonly schemaVersion: number
	readonly title: string | null
	readonly customization: Customization
	readonly fields: readonly FieldSchema[]
}

export class ModuleSchema {
	/** The module's name, such as `product.price_update`. */
	readonly module: string
	/** The schema's own version. A draft records it, so a draft made against another version is noticed. */
	readonly schemaVersion: number
	readonly title: string | null
	readonly customization: Customization
	/** In the order the backend declared them. */
	readonly fields: readonly FieldSchema[]
	readonly #byKey: ReadonlyMap<string, FieldSchema>

	private constructor(data: ModuleData) {
		this.module = data.module
		this.schemaVersion = data.schemaVersion
		this.title = data.title
		this.customization = data.customization
		this.fields = Object.freeze([...data.fields])
		this.#byKey = new Map(data.fields.map(field => [field.key, field]))
		Object.freeze(this)
	}

	/**
	 * Reads a module schema, typically the JSON the backend sent, and checks all of it.
	 *
	 * @throws SchemaError listing every problem found, each with where it is
	 */
	static from(input: unknown): ModuleSchema {
		const problems = new Problems()
		const data = readModule(input, problems)

		if (data === null || problems.items.length > 0) {
			const name =
				isObject(input) && typeof input.module === "string" && input.module.trim() !== ""
					? `Module schema "${input.module}"`
					: "The module schema"

			throw new SchemaError(name, problems.items)
		}

		return new ModuleSchema(data)
	}

	has(key: string): boolean {
		return this.#byKey.has(key)
	}

	/** The field with this key. An unknown key is an error rather than undefined: a typo shows up at once. */
	field(key: string): FieldSchema {
		const field = this.#byKey.get(key)

		if (!field) {
			throw new TabulaError(
				"unknown_field",
				`Module "${this.module}" has no field "${key}". Its fields are: ${this.keys().join(", ")}.`
			)
		}

		return field
	}

	keys(): string[] {
		return this.fields.map(field => field.key)
	}

	/** The schema written out again as JSON, every default spelled out. `from()` reads it back unchanged. */
	toJSON(): ModuleSchemaInput {
		const json: ModuleSchemaInput = {
			module: this.module,
			schemaVersion: this.schemaVersion,
			customization: this.customization,
			fields: this.fields.map(fieldToJson)
		}

		if (this.title !== null) {
			json.title = this.title
		}

		return json
	}
}

function fieldToJson(field: FieldSchema): FieldInput {
	const json: FieldInput = {
		key: field.key,
		type: field.type,
		label: field.label,
		required: field.required,
		editable: field.editable,
		submit: field.submit
	}

	if (field.rules.length > 0) {
		json.rules = field.rules.map(rule => ({ ...rule }))
	}

	if (field.example !== null) {
		json.example = field.example
	}

	switch (field.type) {
		case "decimal":
		case "quantity":
		case "percent":
			if (field.decimals !== null) {
				json.decimals = field.decimals
			}
			break
		case "money":
			if (field.decimals !== null) {
				json.decimals = field.decimals
			}
			if (field.currency !== null) {
				json.currency = field.currency
			}
			break
		case "options":
			json.options = field.options.map(option => ({ ...option }))
			json.multiple = field.multiple
			break
		case "date":
		case "datetime":
			if (field.pattern !== null) {
				json.pattern = field.pattern
			}
			break
		case "lookup":
			json.lookup = field.lookup
			break
	}

	return json
}

// ---------------------------------------------------------------- reading

class Problems {
	readonly items: SchemaProblem[] = []

	add(path: string, message: string): void {
		this.items.push(Object.freeze({ path, message }))
	}
}

function readModule(input: unknown, problems: Problems): ModuleData | null {
	if (!isObject(input)) {
		problems.add("(root)", `must be an object; got ${describe(input)}`)

		return null
	}

	for (const name of Object.keys(input)) {
		if (!MODULE_PROPERTIES.includes(name)) {
			problems.add(name, `is not a module schema property; expected one of ${MODULE_PROPERTIES.join(", ")}`)
		}
	}

	const module = readText(input, "module", "", problems, true)
	const schemaVersion = readSchemaVersion(input, problems)
	const title = readText(input, "title", "", problems, false)
	const customization = readCustomization(input, problems)
	const fields = readFields(input.fields, problems)

	if (module === null || schemaVersion === null || fields === null) {
		return null
	}

	return { module, schemaVersion, title, customization, fields }
}

function readSchemaVersion(input: Json, problems: Problems): number | null {
	const value = input.schemaVersion

	if (value === undefined || value === null) {
		problems.add("schemaVersion", "is required")

		return null
	}

	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		problems.add("schemaVersion", `must be a whole number, 1 or more; got ${describe(value)}`)

		return null
	}

	return value
}

function readCustomization(input: Json, problems: Problems): Customization {
	const value = input.customization

	if (value === undefined || value === null) {
		return "fixed"
	}

	if (typeof value !== "string" || !(CUSTOMIZATIONS as readonly string[]).includes(value)) {
		problems.add(
			"customization",
			`${describe(value)} is not a customization; expected one of ${CUSTOMIZATIONS.join(", ")}`
		)

		return "fixed"
	}

	return value as Customization
}

function readFields(value: unknown, problems: Problems): FieldSchema[] | null {
	if (value === undefined || value === null) {
		problems.add("fields", "is required")

		return null
	}

	if (!Array.isArray(value) || value.length === 0) {
		problems.add("fields", `must be a non-empty array of fields; got ${describe(value)}`)

		return null
	}

	const items = value as unknown[]
	const firstIndex = new Map<string, number>()

	items.forEach((raw, index) => {
		if (!isObject(raw) || typeof raw.key !== "string") {
			return
		}

		const first = firstIndex.get(raw.key)

		if (first === undefined) {
			firstIndex.set(raw.key, index)
		} else {
			problems.add(
				`fields[${index}].key`,
				`"${raw.key}" is already the key of fields[${first}]; a key names one field only`
			)
		}
	})

	const fields: FieldSchema[] = []

	items.forEach((raw, index) => {
		const field = readField(raw, `fields[${index}]`, problems)

		if (field) {
			fields.push(field)
		}
	})

	return fields
}

function readField(raw: unknown, path: string, problems: Problems): FieldSchema | null {
	if (!isObject(raw)) {
		problems.add(path, `must be an object; got ${describe(raw)}`)

		return null
	}

	const before = problems.items.length
	const type = readType(raw, path, problems)

	checkFieldProperties(raw, type, path, problems)

	const key = readKey(raw, path, problems)
	const label = readText(raw, "label", path, problems, false)
	const required = readBoolean(raw, "required", false, path, problems)
	const editable = readBoolean(raw, "editable", true, path, problems)
	const submit = readBoolean(raw, "submit", true, path, problems)
	const example = readText(raw, "example", path, problems, false)
	const rules = readRules(raw.rules, at(path, "rules"), type, problems)

	if (type === null || key === null) {
		return null
	}

	const base = { key, label: label ?? key, required, editable, submit, rules: Object.freeze(rules), example }
	let field: FieldSchema

	switch (type) {
		case "string":
		case "integer":
		case "bool":
			field = { ...base, type }
			break
		case "date":
		case "datetime":
			field = { ...base, type, pattern: readPattern(raw, path, problems) }
			break
		case "decimal":
		case "quantity":
		case "percent":
			field = { ...base, type, decimals: readDecimals(raw, path, problems) }
			break
		case "money":
			field = {
				...base,
				type,
				decimals: readDecimals(raw, path, problems),
				currency: readText(raw, "currency", path, problems, false)
			}
			break
		case "options":
			field = {
				...base,
				type,
				options: Object.freeze(readOptions(raw.options, at(path, "options"), problems)),
				multiple: readBoolean(raw, "multiple", false, path, problems)
			}
			break
		case "lookup":
			field = { ...base, type, lookup: readText(raw, "lookup", path, problems, true) ?? "" }
			break
	}

	return problems.items.length > before ? null : Object.freeze(field)
}

function readType(raw: Json, path: string, problems: Problems): FieldType | null {
	const value = raw.type

	if (value === undefined || value === null) {
		problems.add(at(path, "type"), "is required")

		return null
	}

	if (typeof value !== "string" || !(FIELD_TYPES as readonly string[]).includes(value)) {
		problems.add(
			at(path, "type"),
			`${describe(value)} is not a field type; expected one of ${FIELD_TYPES.join(", ")}`
		)

		return null
	}

	return value as FieldType
}

function checkFieldProperties(raw: Json, type: FieldType | null, path: string, problems: Problems): void {
	const allowed = new Set([...COMMON_PROPERTIES, ...(type === null ? TYPED_PROPERTIES : TYPE_PROPERTIES[type])])

	for (const name of Object.keys(raw)) {
		if (allowed.has(name)) {
			continue
		}

		if (type !== null && TYPED_PROPERTIES.has(name)) {
			problems.add(at(path, name), `does not apply to ${aFieldOf(type)}`)
		} else if (type !== null) {
			problems.add(at(path, name), `is not a field property; ${aFieldOf(type)} takes ${[...allowed].join(", ")}`)
		} else {
			problems.add(at(path, name), "is not a field property")
		}
	}
}

function readKey(raw: Json, path: string, problems: Problems): string | null {
	const key = readText(raw, "key", path, problems, true)

	if (key !== null && key.trim() !== key) {
		problems.add(at(path, "key"), `"${key}" starts or ends with a space; a key is an identifier, not a label`)

		return null
	}

	return key
}

function readPattern(raw: Json, path: string, problems: Problems): string | null {
	const pattern = readText(raw, "pattern", path, problems, false)

	if (pattern !== null && compilePattern(pattern) === null) {
		problems.add(
			at(path, "pattern"),
			`"${pattern}" uses a letter that is not one of d, j, m, n, Y, y, H, G, i, s; write other letters with a backslash before them`
		)

		return null
	}

	return pattern
}

function readDecimals(raw: Json, path: string, problems: Problems): number | null {
	const value = raw.decimals

	if (value === undefined || value === null) {
		return null
	}

	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		problems.add(at(path, "decimals"), `must be a whole number, 0 or more; got ${describe(value)}`)

		return null
	}

	return value
}

function readOptions(value: unknown, path: string, problems: Problems): FieldOption[] {
	if (value === undefined || value === null) {
		problems.add(path, "is required for an options field")

		return []
	}

	if (!Array.isArray(value)) {
		problems.add(path, `must be an array of options; got ${describe(value)}`)

		return []
	}

	const options: FieldOption[] = []
	// By their text: an option 1 and an option "1" cannot be told apart once pasted into a cell.
	const firstIndex = new Map<string, number>()

	;(value as unknown[]).forEach((raw, index) => {
		const optionPath = `${path}[${index}]`

		if (!isObject(raw)) {
			problems.add(optionPath, `must be an object such as { "value": "in", "label": "In" }; got ${describe(raw)}`)

			return
		}

		for (const name of Object.keys(raw)) {
			if (name !== "value" && name !== "label") {
				problems.add(at(optionPath, name), "is not an option property; an option takes value, label")
			}
		}

		const optionValue = raw.value

		if (
			!(typeof optionValue === "string" && optionValue !== "") &&
			!(typeof optionValue === "number" && Number.isFinite(optionValue))
		) {
			problems.add(
				at(optionPath, "value"),
				`must be a non-empty string or a finite number; got ${describe(optionValue)}`
			)

			return
		}

		const text = String(optionValue)
		const first = firstIndex.get(text)

		if (first !== undefined) {
			problems.add(at(optionPath, "value"), `${describe(optionValue)} is already the value of ${path}[${first}]`)

			return
		}

		firstIndex.set(text, index)

		const label = readText(raw, "label", optionPath, problems, false)

		options.push(Object.freeze({ value: optionValue, label: label ?? text }))
	})

	return options
}

function readRules(value: unknown, path: string, type: FieldType | null, problems: Problems): FieldRule[] {
	if (value === undefined || value === null) {
		return []
	}

	if (!Array.isArray(value)) {
		problems.add(path, `must be an array of rules; got ${describe(value)}`)

		return []
	}

	const rules: FieldRule[] = []
	const firstIndex = new Map<RuleKind, number>()

	;(value as unknown[]).forEach((raw, index) => {
		const rulePath = `${path}[${index}]`
		const rule = readRule(raw, rulePath, type, problems)

		if (!rule) {
			return
		}

		const first = firstIndex.get(rule.rule)

		if (first !== undefined) {
			problems.add(rulePath, `${rule.rule} is already given at ${path}[${first}]; give each rule once`)

			return
		}

		firstIndex.set(rule.rule, index)
		rules.push(rule)
	})

	const min = limitOf(rules, "min")
	const max = limitOf(rules, "max")

	if (min !== undefined && max !== undefined && compareDecimal(min, max) > 0) {
		problems.add(path, `min ${min} is above max ${max}; no value can satisfy both`)
	}

	const minLength = lengthOf(rules, "minLength")
	const maxLength = lengthOf(rules, "maxLength")

	if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
		problems.add(path, `minLength ${minLength} is above maxLength ${maxLength}; no text can satisfy both`)
	}

	return rules
}

function limitOf(rules: readonly FieldRule[], kind: "min" | "max"): string | undefined {
	for (const rule of rules) {
		if ((rule.rule === "min" || rule.rule === "max") && rule.rule === kind) {
			return rule.value
		}
	}

	return undefined
}

function lengthOf(rules: readonly FieldRule[], kind: "minLength" | "maxLength"): number | undefined {
	for (const rule of rules) {
		if ((rule.rule === "minLength" || rule.rule === "maxLength") && rule.rule === kind) {
			return rule.value
		}
	}

	return undefined
}

function readRule(raw: unknown, path: string, type: FieldType | null, problems: Problems): FieldRule | null {
	if (!isObject(raw)) {
		problems.add(path, `must be an object such as { "rule": "min", "value": "0" }; got ${describe(raw)}`)

		return null
	}

	const kind = raw.rule

	if (typeof kind !== "string" || !(RULE_KINDS as readonly string[]).includes(kind)) {
		problems.add(at(path, "rule"), `${describe(kind)} is not a rule; expected one of ${RULE_KINDS.join(", ")}`)

		return null
	}

	const rule = kind as RuleKind

	for (const name of Object.keys(raw)) {
		if (name === "rule" || (name === "value" && rule !== "unique")) {
			continue
		}

		problems.add(
			at(path, name),
			rule === "unique" && name === "value" ? "unique takes no value" : `is not a property of a ${rule} rule`
		)
	}

	if (type !== null && !ruleApplies(rule, type)) {
		problems.add(path, `${rule} does not apply to ${aFieldOf(type)}`)

		return null
	}

	const value = raw.value

	switch (rule) {
		case "min":
		case "max": {
			const limit = typeof value === "string" || typeof value === "number" ? normalizeDecimal(value) : null

			if (limit === null) {
				problems.add(
					at(path, "value"),
					value === undefined
						? "is required"
						: `must be a decimal number such as "0" or "12.5", with a point and no exponent; got ${describe(value)}`
				)

				return null
			}

			return Object.freeze({ rule, value: limit })
		}
		case "minLength":
		case "maxLength":
			if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
				problems.add(
					at(path, "value"),
					value === undefined
						? "is required"
						: `must be a whole number of characters, 0 or more; got ${describe(value)}`
				)

				return null
			}

			return Object.freeze({ rule, value })
		case "unique":
			return Object.freeze({ rule })
	}
}

function ruleApplies(rule: RuleKind, type: FieldType): boolean {
	switch (rule) {
		case "min":
		case "max":
			return NUMERIC_TYPES.has(type)
		case "minLength":
		case "maxLength":
			return type === "string"
		case "unique":
			return true
	}
}

function readText(source: Json, name: string, path: string, problems: Problems, required: boolean): string | null {
	const value = source[name]

	if (value === undefined || value === null) {
		if (required) {
			problems.add(at(path, name), "is required")
		}

		return null
	}

	if (typeof value !== "string" || value.trim() === "") {
		problems.add(at(path, name), `must be a non-empty string; got ${describe(value)}`)

		return null
	}

	return value
}

function readBoolean(source: Json, name: string, fallback: boolean, path: string, problems: Problems): boolean {
	const value = source[name]

	if (value === undefined || value === null) {
		return fallback
	}

	if (typeof value !== "boolean") {
		problems.add(at(path, name), `must be true or false; got ${describe(value)}`)

		return fallback
	}

	return value
}

/** "a money field", "an integer field". */
function aFieldOf(type: FieldType): string {
	return `${/^[aeiou]/.test(type) ? "an" : "a"} ${type} field`
}

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function at(path: string, name: string): string {
	return path === "" ? name : `${path}.${name}`
}

function describe(value: unknown): string {
	if (value === undefined) {
		return "nothing"
	}

	if (Array.isArray(value)) {
		return "an array"
	}

	if (typeof value === "object" && value !== null) {
		return "an object"
	}

	return JSON.stringify(value) ?? String(value)
}
