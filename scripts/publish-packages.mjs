// Publishes the three packages to npm, core first, as the Publish workflow does for a release tag.
//
//     corepack pnpm publish-packages --tag v0.4.1 --dry-run    # what would go out, sending nothing
//
// Each package is packed by pnpm, which turns "workspace:^" into the version, and the tarball is
// published by npm. In GitHub Actions npm signs in through trusted publishing: npm trusts the
// Publish workflow of this repository, GitHub gives the job a short-lived identity (OIDC), and no
// token is kept anywhere. npm then adds provenance to what it publishes.
//
// The tag must name the version that the three package.json files and the core's `version` say.
// A version already on npm is passed over, so a publish that stopped half way can be run again.
// Outside GitHub Actions it only ever runs as a dry run: the packages go out from the workflow.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const names = ["core", "vue", "nuxt"]
const pnpm = process.env.npm_execpath
const dryRun = process.argv.includes("--dry-run")
const tag = argument("--tag")

if (!pnpm) {
	stop("run this through pnpm: corepack pnpm publish-packages --tag vX.Y.Z")
}

if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
	stop(`give the release tag, such as --tag v0.4.1; got ${tag ?? "none"}`)
}

if (!dryRun && process.env.GITHUB_ACTIONS !== "true") {
	stop("the packages are published from the Publish workflow; here, add --dry-run")
}

console.log(dryRun ? `${tag}, as a dry run: nothing is sent.` : `${tag}, published.`)

const manifests = names.map(name => readJson(path.join(root, "packages", name, "package.json")))
const version = tag.slice(1)
const said = [
	...manifests.map(manifest => [`${manifest.name} package.json`, manifest.version]),
	["the core's version constant", coreConstant()]
]
const wrong = said.filter(([, value]) => value !== version)

if (wrong.length > 0) {
	stop(`${tag} is not what the packages say: ${wrong.map(([where, value]) => `${where} is ${value}`).join(", ")}`)
}

for (const name of names) {
	if (!fs.existsSync(path.join(root, "packages", name, "dist"))) {
		stop(`packages/${name} is not built: run corepack pnpm --filter "./packages/**" build first`)
	}
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "tabula-grid-publish-"))

try {
	for (const [index, name] of names.entries()) {
		const manifest = manifests[index]
		const id = `${manifest.name}@${version}`

		step(id)

		if (published(id)) {
			console.log(`${id} is on npm already; passed over.`)
			continue
		}

		const before = new Set(fs.readdirSync(work))

		run(pnpm, ["pack", "--pack-destination", work], path.join(root, "packages", name))

		const tarball = fs.readdirSync(work).find(file => !before.has(file) && file.endsWith(".tgz"))

		if (!tarball) {
			throw new Error(`pnpm pack left no tarball for ${manifest.name}`)
		}

		run(
			npmCli(),
			["publish", path.join(work, tarball), "--access", "public", ...(dryRun ? ["--dry-run"] : [])],
			root
		)
	}

	console.log(dryRun ? `\nNothing was sent: ${tag} as a dry run.` : `\n${tag} is on npm.`)
} catch (error) {
	console.error(`\npublish-packages: ${error.message}`)
	process.exitCode = 1
} finally {
	fs.rmSync(work, { recursive: true, force: true })
}

// ---------------------------------------------------------------- helpers

/** Whether npm has this version of the package. A package or version it does not know is not. */
function published(id) {
	const result = spawnSync(process.execPath, [npmCli(), "view", id, "version", "--json"], {
		cwd: root,
		encoding: "utf8"
	})

	if (result.status === 0) {
		return result.stdout.trim() !== ""
	}

	if (/E404|404 Not Found/.test(`${result.stdout}${result.stderr}`)) {
		return false
	}

	throw new Error(`npm view ${id} failed:\n${result.stderr}`)
}

function coreConstant() {
	const source = fs.readFileSync(path.join(root, "packages", "core", "src", "index.ts"), "utf8")

	return /export const version = "([^"]+)"/.exec(source)?.[1] ?? "missing"
}

function argument(name) {
	const at = process.argv.indexOf(name)

	return at === -1 ? undefined : process.argv[at + 1]
}

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

function run(command, args, cwd) {
	const script = /\.[cm]?js$/.test(command)
	const [file, list] = script ? [process.execPath, [command, ...args]] : [command, args]
	const result = spawnSync(file, list, { cwd, stdio: "inherit" })

	if (result.status !== 0) {
		throw new Error(`${path.basename(command)} ${args.join(" ")} failed in ${cwd}`)
	}
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"))
}

function step(text) {
	console.log(`\n== ${text}`)
}

function stop(message) {
	console.error(`publish-packages: ${message}`)
	process.exit(1)
}
