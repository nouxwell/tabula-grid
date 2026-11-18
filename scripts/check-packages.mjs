// Packs the three packages as they would be published, installs the tarballs into an empty project
// and uses them from there, the way someone who installs them from npm would.
//
//     corepack pnpm -r build
//     corepack pnpm check:packages            # --keep leaves the project behind, to look at
//
// Run it through pnpm: packing must turn "workspace:^" into a version, which only pnpm does, and
// the script finds pnpm through the variable pnpm sets for it. The empty project is installed with
// npm, from the registry: the dependencies of the packages are not the workspace's.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const names = ["core", "vue", "nuxt"]
const keep = process.argv.includes("--keep")
const pnpm = process.env.npm_execpath

if (!pnpm) {
	stop("run this through pnpm: corepack pnpm check:packages")
}

for (const name of names) {
	if (!fs.existsSync(path.join(root, "packages", name, "dist"))) {
		stop(`packages/${name} is not built: run corepack pnpm -r build first`)
	}
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "tabula-grid-packages-"))
const tarballs = path.join(work, "tarballs")
const consumer = path.join(work, "consumer")
const manifests = Object.fromEntries(
	names.map(name => [name, readJson(path.join(root, "packages", name, "package.json"))])
)
const version = manifests.core.version

try {
	check()
} catch (error) {
	console.error(`\ncheck-packages: ${error.message}`)
	process.exitCode = 1
} finally {
	if (keep) {
		console.log(`Left in ${work}`)
	} else {
		fs.rmSync(work, { recursive: true, force: true })
	}
}

function check() {
	step("pack")
	fs.mkdirSync(tarballs)

	for (const name of names) {
		run(pnpm, ["pack", "--pack-destination", tarballs], path.join(root, "packages", name))
	}

	step("look inside the tarballs")

	for (const name of names) {
		checkTarball(name)
	}

	step("install them into an empty project")
	writeConsumer()
	run(npmCli(), ["install", "--no-audit", "--no-fund", ...installSpecs()], consumer)

	step("import them in Node")
	run(process.execPath, ["run.mjs"], consumer)

	const tsc = path.join(consumer, "node_modules", "typescript", "bin", "tsc")

	step("type-check against them, as Vite and Nuxt resolve modules")
	run(process.execPath, [tsc, "-p", "tsconfig.json"], consumer)

	step("type-check against them, as Node resolves modules")
	run(process.execPath, [tsc, "-p", "tsconfig.node.json"], consumer)

	console.log(`\nThe ${names.length} packages, version ${version}, install and work as published.`)
}

/** What a tarball holds: the build, the readme, the licence and the manifest, and nothing else. */
function checkTarball(name) {
	const manifest = manifests[name]
	const file = path.join(tarballs, `nouxwell-tabula-${name}-${version}.tgz`)
	const unpacked = path.join(work, "unpacked", name)

	assert.equal(manifest.version, version, `packages/${name} is at ${manifest.version}, the core at ${version}`)
	assert.ok(fs.existsSync(file), `no tarball ${path.basename(file)}`)

	fs.mkdirSync(unpacked, { recursive: true })
	// Relative, with forward slashes: GNU tar, which Git for Windows puts on the PATH, takes "C:" for a
	// remote host and "\v" in "unpacked\vue" for an escape.
	const slashed = target => path.relative(work, target).split(path.sep).join("/")
	run("tar", ["-xzf", slashed(file), "-C", slashed(unpacked)], work)

	const packed = path.join(unpacked, "package")
	const files = listFiles(packed)
	const published = readJson(path.join(packed, "package.json"))

	for (const required of ["package.json", "README.md", "LICENSE"]) {
		assert.ok(files.includes(required), `${name}: ${required} is missing`)
	}

	for (const entry of files) {
		assert.ok(
			["package.json", "README.md", "LICENSE"].includes(entry) || entry.startsWith("dist/"),
			`${name}: ${entry} should not be published`
		)
		assert.ok(!entry.endsWith(".d.ts.map"), `${name}: ${entry} points at sources that are not published`)
	}

	for (const target of exportTargets(published.exports)) {
		assert.ok(files.includes(target.replace(/^\.\//, "")), `${name}: exports names ${target}, which is not there`)
	}

	assert.equal(published.private, undefined, `${name} is still private`)
	assert.equal(published.publishConfig?.access, "public", `${name} would be published as restricted`)
	assert.ok(!JSON.stringify(published).includes("workspace:"), `${name} still has a workspace: range`)

	for (const [dependency, range] of Object.entries(published.dependencies ?? {})) {
		if (dependency.startsWith("@nouxwell/")) {
			assert.equal(range, `^${version}`, `${name} depends on ${dependency}@${range}`)
		}
	}

	console.log(`  ${name}: ${files.length} files`)
}

function writeConsumer() {
	fs.mkdirSync(consumer)
	fs.writeFileSync(
		path.join(consumer, "package.json"),
		JSON.stringify({ name: "consumer", private: true, type: "module" }, null, "\t")
	)

	// As Vite and Nuxt set TypeScript up, and as a Node project does: Node's resolution takes a
	// relative import only with its extension, and one without leaves its types as `any`.
	// skipLibCheck hides errors inside the packages' types, so the checks below include lines that
	// must fail: a type that fell back to `any` lets them pass.
	fs.writeFileSync(
		path.join(consumer, "tsconfig.node.json"),
		JSON.stringify(
			{ extends: "./tsconfig.json", compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" } },
			null,
			"\t"
		)
	)
	fs.writeFileSync(
		path.join(consumer, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					target: "ES2022",
					module: "ESNext",
					moduleResolution: "Bundler",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					types: []
				},
				files: ["check.ts"]
			},
			null,
			"\t"
		)
	)

	fs.writeFileSync(
		path.join(consumer, "check.ts"),
		`import { ModuleSchema, RowStore, SheetValidator, VALUE_SETTINGS, type Issue } from "@nouxwell/tabula-core"
import { columnName, TabulaFormulaBar, TabulaGrid, TabulaIssues, TabulaStatusBar, type GridTheme, type SelectedCells } from "@nouxwell/tabula-vue"
import tabula, { type ModuleOptions } from "@nouxwell/tabula-nuxt"

const schema: ModuleSchema = ModuleSchema.from({
	module: "consumer",
	schemaVersion: 1,
	fields: [{ key: "price", type: "money", required: true }]
})
const issues: Issue[] = new SheetValidator(schema, new RowStore(), VALUE_SETTINGS.tr).issues()
const theme: GridTheme = "dark"
const options: ModuleOptions = { prefix: "App" }
const goTo: InstanceType<typeof TabulaGrid>["goTo"] = () => true
const selected: SelectedCells | null = null as InstanceType<typeof TabulaGrid>["selected"]
const letters: string = columnName(27)

// @ts-expect-error rows are a list of rows, not a count
new RowStore({ rows: 4 })
// @ts-expect-error a theme the grid does not have
const wrongTheme: GridTheme = "blue"
// @ts-expect-error a method the grid does not have
const nothing: InstanceType<typeof TabulaGrid>["noSuchMethod"] = null
// @ts-expect-error an option the module does not have
const wrongOptions: ModuleOptions = { prefix: "App", suffix: "" }

export { goTo, issues, letters, nothing, options, selected, tabula, TabulaFormulaBar, TabulaIssues, TabulaStatusBar, theme, wrongOptions, wrongTheme }
`
	)

	fs.writeFileSync(
		path.join(consumer, "run.mjs"),
		`import assert from "node:assert/strict"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { ModuleSchema, RowStore, SheetValidator, VALUE_SETTINGS, readInput, version } from "@nouxwell/tabula-core"
import { columnName, TabulaFormulaBar, TabulaGrid, TabulaIssues, TabulaStatusBar } from "@nouxwell/tabula-vue"
import tabula from "@nouxwell/tabula-nuxt"

assert.equal(version, ${JSON.stringify(version)})

const schema = ModuleSchema.from({
	module: "consumer",
	schemaVersion: 1,
	fields: [{ key: "price", type: "money", required: true, rules: [{ rule: "max", value: "1000" }] }]
})
const store = new RowStore({ rows: [{ values: { price: "1234.5" } }, { values: {} }] })
const codes = new SheetValidator(schema, store, VALUE_SETTINGS.tr).issues().map(issue => issue.code)

assert.deepEqual(codes, ["max_value", "required"])
assert.equal(readInput(schema.field("price"), "1.234,5 ₺", VALUE_SETTINGS.tr).value, "1234.5")

assert.equal(typeof TabulaGrid, "object")
assert.equal(typeof TabulaIssues, "object")
assert.equal(typeof TabulaFormulaBar, "object")
assert.equal(typeof TabulaStatusBar, "object")
assert.equal(columnName(27), "AB")
assert.ok(fs.existsSync(fileURLToPath(import.meta.resolve("@nouxwell/tabula-vue/style.css"))))

const meta = await tabula.getMeta()
assert.equal(meta.name, "@nouxwell/tabula-nuxt")
assert.equal(meta.configKey, "tabula")
`
	)
}

function installSpecs() {
	const own = names.map(name => path.join(tarballs, `nouxwell-tabula-${name}-${version}.tgz`))
	const workspace = readJson(path.join(root, "package.json"))

	// The versions the workspace builds and checks with, so a failure here is about the packages.
	return [
		...own,
		`vue@${manifests.vue.devDependencies.vue}`,
		`@nuxt/schema@${manifests.nuxt.devDependencies["@nuxt/schema"]}`,
		`typescript@${workspace.devDependencies.typescript}`
	]
}

function exportTargets(exports) {
	if (typeof exports === "string") {
		return [exports]
	}

	return Object.values(exports ?? {}).flatMap(exportTargets)
}

function listFiles(dir, prefix = "") {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.flatMap(entry =>
			entry.isDirectory()
				? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
				: [`${prefix}${entry.name}`]
		)
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"))
}

/**
 * npm's own script, which Node runs. The `npm` command is npm.cmd on Windows, which only a shell
 * runs, and a shell takes its arguments as one unescaped line.
 */
function npmCli() {
	const bin = path.dirname(process.execPath)
	const candidates = [
		path.join(bin, "node_modules", "npm", "bin", "npm-cli.js"), // Windows
		path.join(bin, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js") // everywhere else
	]
	const found = candidates.find(candidate => fs.existsSync(candidate))

	if (!found) {
		throw new Error(`npm is not next to this Node: looked for ${candidates.join(" and ")}`)
	}

	return found
}

/** Runs a command and stops everything when it fails. Node runs a script, such as pnpm's or npm's. */
function run(command, args, cwd) {
	const script = /\.[cm]?js$/.test(command)
	const [file, list] = script ? [process.execPath, [command, ...args]] : [command, args]
	const result = spawnSync(file, list, { cwd, stdio: "inherit" })

	if (result.status !== 0) {
		throw new Error(`${path.basename(command)} ${args.join(" ")} failed in ${cwd}`)
	}
}

function step(text) {
	console.log(`\n== ${text}`)
}

/** Before anything was made: nothing to clean up. */
function stop(message) {
	console.error(`check-packages: ${message}`)
	process.exit(1)
}
