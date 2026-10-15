#!/usr/bin/env node
// Baut das Paket release/svws-tools.zip (und release/RELEASE_NOTES.md) aus den in tools.json eingetragenen Tools.
//
// Aufruf:
//   npm run build
//
// Pro Tool wird das Web-App-ZIP aus dem latest Release (oder dem Release zur festen
// Version) geladen und nach tools/<name>/ entpackt. Lokale Tools (Feld "path") werden
// aus diesem Repository kopiert. Jeder Fehler bricht den Build ab.
//
// Für die GitHub-API wird, falls vorhanden, GITHUB_TOKEN oder das Token der GitHub CLI
// verwendet. Ohne Token gilt das Limit von 60 Anfragen pro Stunde.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const BUILD_DIR = join(ROOT, 'build')
const PACKAGE_DIR = join(BUILD_DIR, 'svws-tools')
const DOWNLOAD_DIR = join(BUILD_DIR, 'downloads')
const RELEASE_DIR = join(ROOT, 'release')
const ZIP_FILE = join(RELEASE_DIR, 'svws-tools.zip')
const NOTES_FILE = join(RELEASE_DIR, 'RELEASE_NOTES.md')
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function readJson(file) {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

// ── Konfiguration prüfen ─────────────────────────────────────────────────────

function validate(tools) {
  if (!Array.isArray(tools) || tools.length === 0) fail('tools.json muss eine nicht leere Liste enthalten.')
  const names = new Set()
  for (const tool of tools) {
    const label = tool.name ?? JSON.stringify(tool)
    if (!NAME_PATTERN.test(tool.name ?? '')) fail(`Ungültiger Name "${label}": erlaubt sind a-z, 0-9 und "-".`)
    if (names.has(tool.name)) fail(`Der Name "${tool.name}" ist doppelt vergeben.`)
    names.add(tool.name)
    if (tool.path) {
      if (tool.repo || tool.asset) fail(`"${label}": "path" schließt "repo" und "asset" aus.`)
    } else if (!tool.repo || !tool.asset) {
      fail(`"${label}": Es fehlt "repo" oder "asset" (oder "path" für lokale Inhalte).`)
    }
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

const token = githubToken()

async function github(url, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': 'svws-tools-build' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} bei ${url}`)
  }
  return response
}

async function fetchRelease(tool) {
  const ref = tool.version ? `tags/v${tool.version}` : 'latest'
  const response = await github(`https://api.github.com/repos/${tool.repo}/releases/${ref}`)
  return response.json()
}

async function download(url, file) {
  const response = await github(url, 'application/octet-stream')
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
}

// ── Tools einsammeln ─────────────────────────────────────────────────────────

async function addRemoteTool(tool, target) {
  const release = await fetchRelease(tool)
  const version = release.tag_name.replace(/^v/, '')
  const assetName = tool.asset.replaceAll('{version}', version)
  const asset = release.assets.find(a => a.name === assetName)
  if (!asset) {
    const available = release.assets.map(a => a.name).join(', ') || '(keine)'
    throw new Error(`Asset "${assetName}" fehlt im Release ${release.tag_name} von ${tool.repo}. Vorhanden: ${available}`)
  }

  const zipFile = join(DOWNLOAD_DIR, assetName)
  await download(asset.url, zipFile)
  mkdirSync(target, { recursive: true })
  execFileSync('unzip', ['-q', zipFile, '-d', target], { stdio: 'inherit' })

  return { version, tag: release.tag_name, repo: tool.repo, source: `${tool.repo}@${release.tag_name}/${assetName}` }
}

function addLocalTool(tool, target) {
  const source = join(ROOT, tool.path)
  if (!existsSync(source)) throw new Error(`Ordner ${tool.path} existiert nicht.`)
  cpSync(source, target, { recursive: true })
  return { version: null, tag: null, repo: null, source: tool.path }
}

// ── Ablauf ───────────────────────────────────────────────────────────────────

const tools = readJson('tools.json')
validate(tools)
const packageVersion = readJson('package.json').version

rmSync(BUILD_DIR, { recursive: true, force: true })
rmSync(ZIP_FILE, { force: true })
rmSync(NOTES_FILE, { force: true })
mkdirSync(DOWNLOAD_DIR, { recursive: true })
mkdirSync(join(PACKAGE_DIR, 'tools'), { recursive: true })
mkdirSync(RELEASE_DIR, { recursive: true })

console.log(`▶ Baue SVWS-Tools ${packageVersion}${token ? '' : ' (ohne GitHub-Token)'}\n`)

const results = []
for (const tool of tools) {
  const target = join(PACKAGE_DIR, 'tools', tool.name)
  let info
  try {
    info = tool.path ? addLocalTool(tool, target) : await addRemoteTool(tool, target)
  } catch (error) {
    fail(`${tool.name}: ${error.message}`)
  }
  if (!existsSync(join(target, 'index.html'))) {
    fail(`${tool.name}: Nach dem Entpacken liegt keine index.html in tools/${tool.name}/.`)
  }
  const pinned = tool.version ? ' (fest)' : ''
  console.log(`  ✔ ${tool.name.padEnd(12)} ${info.version ?? 'lokal'}${pinned}`)
  results.push({ name: tool.name, title: tool.title ?? tool.name, ...info, pinned: Boolean(tool.version) })
}

const versions = {
  version: packageVersion,
  built: new Date().toISOString(),
  tools: results.map(({ name, title, version, source }) => ({ name, title, version, source })),
}
writeFileSync(join(PACKAGE_DIR, 'tools', 'versions.json'), JSON.stringify(versions, null, 2) + '\n')

execFileSync('zip', ['-q', '-r', '-X', ZIP_FILE, 'tools'], { cwd: PACKAGE_DIR, stdio: 'inherit' })

const notes = [
  '## Enthaltene Tools',
  '',
  '| Tool | Ordner | Version | Quelle |',
  '|---|---|---|---|',
  ...results.map(r => {
    const source = r.repo ? `[${r.repo}@${r.tag}](https://github.com/${r.repo}/releases/tag/${r.tag})` : `\`${r.source}\``
    return `| ${r.title} | \`tools/${r.name}/\` | ${r.version ?? '–'}${r.pinned ? ' (fest)' : ''} | ${source} |`
  }),
  '',
]
writeFileSync(NOTES_FILE, notes.join('\n'))

console.log('\n✔ release/svws-tools.zip und release/RELEASE_NOTES.md erstellt.')
