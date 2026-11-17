/**
 * The few web-platform globals the core uses, which every browser, Node 18+, Deno and Bun have.
 *
 * The core compiles without the DOM's types, so that nothing else of the DOM creeps in; these are
 * declared for its own compilation alone. A .d.ts source is not emitted, and nothing imports this
 * one: an application resolves the names from its own lib, the DOM's or Node's.
 */

interface AbortSignal {
	readonly aborted: boolean
	addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void
	removeEventListener(type: "abort", listener: () => void): void
}

interface AbortController {
	readonly signal: AbortSignal
	abort(reason?: unknown): void
}

declare const AbortController: {
	prototype: AbortController
	new (): AbortController
}

declare function setTimeout(handler: () => void, timeout?: number): unknown
