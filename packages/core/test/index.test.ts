import { describe, expect, it } from "vitest"
import manifest from "../package.json" with { type: "json" }
import { version } from "../src/index"

describe("version", () => {
	it("is the version in package.json", () => {
		expect(version).toBe(manifest.version)
	})
})
