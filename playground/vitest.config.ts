import { defineConfig } from "vitest/config"

// The browser tests. They build the playground, serve it, and drive it in a real browser: Edge on a
// developer's machine, Chromium on CI, or whatever TABULA_BROWSER names (msedge, chrome, chromium).
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 120_000,
		fileParallelism: false
	}
})
