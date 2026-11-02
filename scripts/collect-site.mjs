import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const root = resolve(process.env.ROOT ?? process.cwd())
const baseUrl = process.env.BASE_URL
const outDir = join(root, 'site')
const sizeLimit = 1024 ** 3

function fail(message) {
    console.error(`error: ${message}`)
    process.exit(1)
}

if (!baseUrl) {
    fail('BASE_URL is not set')
}

const distroPath = join(root, 'distribution.json')
if (!existsSync(distroPath)) {
    fail(`${distroPath} was not generated`)
}

const distro = JSON.parse(readFileSync(distroPath, 'utf8'))
const basePath = new URL(baseUrl).pathname
const urls = new Set()

function visit(node) {
    if (Array.isArray(node)) {
        node.forEach(visit)
        return
    }
    if (node === null || typeof node !== 'object') {
        return
    }
    for (const [key, value] of Object.entries(node)) {
        if ((key === 'url' || key === 'icon') && typeof value === 'string') {
            if (value.startsWith(baseUrl)) {
                urls.add(value)
            }
        } else {
            visit(value)
        }
    }
}

visit(distro)

const duplicates = []
for (const server of distro.servers ?? []) {
    const files = new Map()
    const collect = (modules) => {
        for (const entry of modules ?? []) {
            const enabled = entry.required?.value !== false || entry.required?.def !== false
            if (entry.type === 'ForgeMod' && enabled) {
                const [group, artifact] = entry.id.split(':')
                const key = `${group}:${artifact}`
                const file = decodeURIComponent(new URL(entry.artifact.url).pathname).split('/').pop()
                files.set(key, [...(files.get(key) ?? []), file])
            }
            collect(entry.subModules)
        }
    }
    collect(server.modules)
    for (const [key, names] of files) {
        if (names.length > 1) {
            duplicates.push(`${server.id}: ${key}\n    ${names.join('\n    ')}`)
        }
    }
}

if (duplicates.length > 0) {
    fail(`the same mod is present more than once, Forge loads one file per mod:\n${duplicates.map(item => `  ${item}`).join('\n')}`)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const missing = []
let total = 0

for (const url of urls) {
    const relative = decodeURIComponent(new URL(url).pathname.slice(basePath.length))
    const source = resolve(root, relative)
    if (!source.startsWith(root + sep)) {
        fail(`refusing to copy outside of the root: ${relative}`)
    }
    if (!existsSync(source)) {
        missing.push(relative)
        continue
    }
    const target = join(outDir, relative)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target)
    total += statSync(source).size
}

if (missing.length > 0) {
    fail(`files referenced by distribution.json were not found:\n${missing.map(item => `  ${item}`).join('\n')}`)
}

cpSync(distroPath, join(outDir, 'distribution.json'))
writeFileSync(join(outDir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>BuildTage</title><p>BuildTage distribution server.</p>\n')

const megabytes = (total / 1024 / 1024).toFixed(1)
console.log(`site: ${urls.size} files, ${megabytes} MiB`)

if (total > sizeLimit) {
    fail(`the site is ${megabytes} MiB, GitHub Pages accepts at most 1 GiB`)
}
