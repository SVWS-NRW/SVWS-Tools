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
// Die GitHub-API wird nicht benötigt: Das aktuelle Release ergibt sich aus der Weiterleitung von
// https://github.com/<repo>/releases/latest, die ZIPs kommen über die öffentlichen Download-Links.
// Beides unterliegt nicht dem API-Limit. Nur wenn ein Asset fehlt, fragt der Build die API nach
// den vorhandenen Dateien (mit GITHUB_TOKEN oder dem Token der GitHub CLI, falls vorhanden).
//
// Heruntergeladene ZIPs bleiben in .cache/downloads/ und werden wiederverwendet, solange sich
// Version und Dateiname nicht ändern (Cache leeren mit `rm -rf .cache`).

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const BUILD_DIR = join(ROOT, 'build')
const PACKAGE_DIR = join(BUILD_DIR, 'svws-tools')
const DOWNLOAD_CACHE_DIR = join(ROOT, '.cache', 'downloads')
const RELEASE_DIR = join(ROOT, 'release')
const ZIP_FILE = join(RELEASE_DIR, 'svws-tools.zip')
const NOTES_FILE = join(RELEASE_DIR, 'RELEASE_NOTES.md')
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

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
    if (tool.version != null && !VERSION_PATTERN.test(tool.version)) {
      fail(`"${label}": "version" muss null oder eine Version wie "1.2.3" sein (ohne führendes "v").`)
    }
    for (const patch of tool.patches ?? []) {
      if (typeof patch.file !== 'string' || typeof patch.search !== 'string' || typeof patch.replace !== 'string'
        || patch.file.split(/[\\/]/).includes('..')) {
        fail(`"${label}": Jeder Eintrag in "patches" braucht "file" (ohne ".."), "search" und "replace".`)
      }
    }
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

const USER_AGENT = { 'User-Agent': 'svws-tools-build' }

function cacheName(...parts) {
  return parts.join('__').replace(/[^A-Za-z0-9._-]/g, '_')
}

// Tag des Releases: feste Version aus tools.json oder Ziel der Weiterleitung von /releases/latest
async function resolveTag(tool) {
  if (tool.version) return `v${tool.version}`
  const url = `https://github.com/${tool.repo}/releases/latest`
  const response = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: USER_AGENT })
  const match = /\/releases\/tag\/([^/?#]+)$/.exec(response.headers.get('location') ?? '')
  if (!match) throw new Error(`Kein latest Release gefunden (${response.status} bei ${url}).`)
  return decodeURIComponent(match[1])
}

// Nur für Fehlermeldungen: welche Dateien hat das Release? Nutzt die API, scheitert still.
async function listAssets(tool, tag) {
  const token = githubToken()
  const headers = { ...USER_AGENT, Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const response = await fetch(`https://api.github.com/repos/${tool.repo}/releases/tags/${tag}`, { headers })
    if (!response.ok) return null
    return (await response.json()).assets.map(a => a.name)
  } catch {
    return null
  }
}

// Lädt das ZIP über den öffentlichen Download-Link oder nimmt es aus dem Cache.
// Der Dateiname enthält die Version, ein neues Release führt also zu einem neuen Download.
async function download(tool, tag, assetName) {
  const file = join(DOWNLOAD_CACHE_DIR, cacheName(tool.repo, tag, assetName))
  if (existsSync(file)) return { file, cached: true }

  const url = `https://github.com/${tool.repo}/releases/download/${tag}/${assetName}`
  const response = await fetch(url, { headers: USER_AGENT })
  if (response.status === 404) {
    const available = await listAssets(tool, tag)
    const hint = available ? ` Vorhanden: ${available.join(', ') || '(keine)'}` : ''
    throw new Error(`Asset "${assetName}" fehlt im Release ${tag} von ${tool.repo}.${hint}`)
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} bei ${url}`)

  // Erst vollständig schreiben, dann umbenennen: ein abgebrochener Download bleibt nicht im Cache liegen
  const partial = file + '.part'
  writeFileSync(partial, Buffer.from(await response.arrayBuffer()))
  renameSync(partial, file)
  return { file, cached: false }
}

// ── Tools einsammeln ─────────────────────────────────────────────────────────

async function addRemoteTool(tool, target) {
  const tag = await resolveTag(tool)
  const version = tag.replace(/^v/, '')
  const assetName = tool.asset.replaceAll('{version}', version)

  const { file: zipFile, cached } = await download(tool, tag, assetName)
  mkdirSync(target, { recursive: true })
  execFileSync('unzip', ['-q', zipFile, '-d', target], { stdio: 'inherit' })

  return { version, tag, repo: tool.repo, source: `${tool.repo}@${tag}/${assetName}`, cacheInfo: cached ? 'aus Cache' : '' }
}

function addLocalTool(tool, target) {
  const source = join(ROOT, tool.path)
  if (!existsSync(source)) throw new Error(`Ordner ${tool.path} existiert nicht.`)
  cpSync(source, target, { recursive: true })
  return { version: null, tag: null, repo: null, source: tool.path }
}

// Ersetzt in ausgelieferten Dateien einzelne Textstellen (Feld "patches" in tools.json).
// Fehlt die gesuchte Stelle, z. B. weil eine neue Tool-Version die Datei geändert hat, bricht der Build ab.
function applyPatches(tool, target) {
  for (const patch of tool.patches ?? []) {
    const file = join(target, patch.file)
    if (!existsSync(file)) throw new Error(`Patch: Datei ${patch.file} fehlt.`)
    const content = readFileSync(file, 'utf8')
    if (!content.includes(patch.search)) {
      throw new Error(`Patch: In ${patch.file} wurde ${JSON.stringify(patch.search)} nicht gefunden.`)
    }
    writeFileSync(file, content.replace(patch.search, patch.replace))
  }
  return (tool.patches ?? []).length
}

// ── Ablauf ───────────────────────────────────────────────────────────────────

const tools = readJson('tools.json')
validate(tools)
const packageVersion = readJson('package.json').version

rmSync(BUILD_DIR, { recursive: true, force: true })
rmSync(ZIP_FILE, { force: true })
rmSync(NOTES_FILE, { force: true })
mkdirSync(DOWNLOAD_CACHE_DIR, { recursive: true })
mkdirSync(join(PACKAGE_DIR, 'tools'), { recursive: true })
mkdirSync(RELEASE_DIR, { recursive: true })

console.log(`▶ Baue SVWS-Tools ${packageVersion}\n`)

const results = []
for (const tool of tools) {
  const target = join(PACKAGE_DIR, 'tools', tool.name)
  let info
  let patches
  try {
    info = tool.path ? addLocalTool(tool, target) : await addRemoteTool(tool, target)
    patches = applyPatches(tool, target)
  } catch (error) {
    fail(`${tool.name}: ${error.message}`)
  }
  if (!existsSync(join(target, 'index.html'))) {
    fail(`${tool.name}: Nach dem Entpacken liegt keine index.html in tools/${tool.name}/.`)
  }
  const pinned = tool.version ? ' (fest)' : ''
  const notes = [info.cacheInfo, patches && `${patches} Patch${patches > 1 ? 'es' : ''}`].filter(Boolean).join(', ')
  console.log(`  ✔ ${tool.name.padEnd(12)} ${(info.version ?? 'lokal') + pinned}${notes ? `  (${notes})` : ''}`)
  results.push({ name: tool.name, title: tool.title ?? tool.name, ...info, local: Boolean(tool.path), pinned: Boolean(tool.version) })
}

const versions = {
  version: packageVersion,
  built: new Date().toISOString(),
  tools: results.map(({ name, title, version, source }) => ({ name, title, version, source })),
}
writeFileSync(join(PACKAGE_DIR, 'tools', 'versions.json'), JSON.stringify(versions, null, 2) + '\n')

// Vorlage für start/sichtbarkeit.js: alle Kacheln der Startseite (data-tool), eingeschaltet.
// Die echte sichtbarkeit.js legt der IT-Dienstleister an; sie wird nicht mitgeliefert.
// JavaScript statt JSON, weil der SVWS-Server unter /app/ keine .json-Dateien ausliefert.
const startPage = join(PACKAGE_DIR, 'tools', 'start', 'index.html')
if (existsSync(startPage)) {
  const cards = [...readFileSync(startPage, 'utf8').matchAll(/data-tool="([^"]+)"/g)].map(m => m[1])
  for (const r of results) {
    if (!r.local && !cards.includes(r.name)) {
      console.warn(`  ⚠ ${r.name}: Auf der Startseite gibt es keine Kachel mit data-tool="${r.name}".`)
    }
  }
  const example = Object.fromEntries(cards.map(name => [name, true]))
  const exampleJs = [
    '// Sichtbarkeit der Kacheln auf der Startseite.',
    '// Als sichtbarkeit.js in diesen Ordner kopieren und Kacheln mit false ausblenden.',
    `window.SVWS_TOOLS_SICHTBARKEIT = ${JSON.stringify(example, null, 2)};`,
    '',
  ].join('\n')
  writeFileSync(join(PACKAGE_DIR, 'tools', 'start', 'sichtbarkeit.example.js'), exampleJs)
}

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
