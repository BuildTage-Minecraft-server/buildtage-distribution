import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, appendFileSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(process.env.ROOT ?? process.cwd())
const serverId = process.env.SERVER_ID || 'CBO-1.20.1'
const container = process.env.CBO_CONTAINER || 'CBO'
const stopTimeout = Number(process.env.CBO_STOP_TIMEOUT || 120)
const startTimeout = Number(process.env.CBO_START_TIMEOUT || 600)
const keepBackups = Number(process.env.CBO_KEEP_BACKUPS || 5)
const dryRun = process.env.DRY_RUN === 'true'
const serverDir = join(root, 'servers', serverId)
const manifestName = '.deploy-manifest.json'
const backupName = '.deploy-backup'

function fail(message) {
    console.error(`error: ${message}`)
    process.exit(1)
}

function run(args) {
    const result = spawnSync('docker', args, { encoding: 'utf8' })
    if (result.error) {
        fail(`docker is not available: ${result.error.message}`)
    }
    return result
}

function docker(...args) {
    const result = run(args)
    if (result.status !== 0) {
        fail(`docker ${args[0]} failed: ${result.stderr.trim()}`)
    }
    return result.stdout
}

function inspect() {
    return JSON.parse(docker('inspect', container))[0]
}

function jars(dir) {
    const found = new Map()
    if (!existsSync(dir)) {
        return found
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jar')) {
            found.set(entry.name, join(dir, entry.name))
        }
    }
    return found
}

function tree(dir, accept = () => true) {
    const found = new Map()
    const walk = (relative) => {
        for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
            const path = relative ? `${relative}/${entry.name}` : entry.name
            if (entry.isDirectory()) {
                walk(path)
            } else if (entry.isFile() && accept(path)) {
                found.set(path, join(dir, path))
            }
        }
    }
    if (existsSync(dir)) {
        walk('')
    }
    return found
}

function hashed(files) {
    const result = new Map()
    for (const [name, path] of files) {
        result.set(name, { path, hash: createHash('sha256').update(readFileSync(path)).digest('hex') })
    }
    return result
}

function exclusions() {
    const path = join(serverDir, 'server', 'exclude.txt')
    const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []
    const matchers = lines
        .map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('#'))
        .map(line => new RegExp(`^${line.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i'))
    return key => matchers.some(matcher => matcher.test(key))
}

function wantedState() {
    const skip = exclusions()
    const excluded = []
    const keep = (kind, files) => new Map([...files].filter(([name]) => {
        if (skip(`${kind}/${name}`)) {
            excluded.push(`${kind}/${name}`)
            return false
        }
        return true
    }))

    const mods = new Map([
        ...jars(join(serverDir, 'forgemods', 'required')),
        ...jars(join(serverDir, 'server', 'mods'))
    ])
    const config = new Map([
        ...tree(join(serverDir, 'files', 'config'), path => !path.endsWith('-client.toml')),
        ...tree(join(serverDir, 'server', 'config'))
    ])
    return { mods: hashed(keep('mods', mods)), config: hashed(keep('config', config)), excluded }
}

function readManifest(dataDir) {
    try {
        return new Map(Object.entries(JSON.parse(readFileSync(join(dataDir, manifestName), 'utf8')).config))
    } catch {
        return new Map()
    }
}

function plan(wanted, dirs) {
    const live = hashed(jars(dirs.mods))
    const previous = readManifest(dirs.data)
    const mods = []
    const config = []

    for (const [name, item] of wanted.mods) {
        if (!live.has(name)) {
            mods.push({ kind: 'mods', action: 'added', name, source: item.path })
        } else if (live.get(name).hash !== item.hash) {
            mods.push({ kind: 'mods', action: 'updated', name, source: item.path })
        }
    }
    for (const name of live.keys()) {
        if (!wanted.mods.has(name)) {
            mods.push({ kind: 'mods', action: 'removed', name })
        }
    }
    for (const [name, item] of wanted.config) {
        if (!previous.has(name)) {
            config.push({ kind: 'config', action: 'added', name, source: item.path })
        } else if (previous.get(name) !== item.hash) {
            config.push({ kind: 'config', action: 'updated', name, source: item.path })
        }
    }

    const byName = (a, b) => a.name.localeCompare(b.name)
    return [...mods.sort(byName), ...config.sort(byName)]
}

function report(changes) {
    const lines = changes.map(change => `${change.action.padEnd(8)} ${change.kind}/${change.name}`)
    console.log(`server: ${changes.length} changes`)
    console.log(lines.join('\n'))
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${container}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
    }
}

function preflight(changes, dirs) {
    const denied = new Set()
    const check = (path, mode) => {
        try {
            accessSync(path, mode)
        } catch {
            denied.add(path)
        }
    }

    check(dirs.data, constants.W_OK)
    for (const path of [join(dirs.data, backupName), join(dirs.data, manifestName)]) {
        if (existsSync(path)) {
            check(path, constants.R_OK | constants.W_OK)
        }
    }
    for (const change of changes) {
        const target = join(dirs[change.kind], change.name)
        let parent = dirname(target)
        while (!existsSync(parent)) {
            parent = dirname(parent)
        }
        check(parent, constants.W_OK)
        if (change.kind === 'config' && existsSync(target)) {
            check(target, constants.R_OK | constants.W_OK)
        }
        if (change.kind === 'mods' && existsSync(join(dirs.runtimeMods, change.name))) {
            check(dirs.runtimeMods, constants.W_OK)
        }
    }

    if (denied.size > 0) {
        fail(`this user has no write access to:\n${[...denied].map(path => `  ${path}`).join('\n')}`)
    }
}

function move(from, to) {
    try {
        renameSync(from, to)
    } catch (error) {
        if (error.code !== 'EXDEV') {
            throw error
        }
        copyFileSync(from, to)
        rmSync(from)
    }
}

function apply(changes, wanted, dirs) {
    const backupRoot = join(dirs.data, backupName)
    const backup = join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'))

    const save = (kind, name) => {
        const target = join(dirs[kind], name)
        if (!existsSync(target)) {
            return
        }
        const saved = join(backup, kind, name)
        mkdirSync(dirname(saved), { recursive: true })
        if (kind === 'mods') {
            move(target, saved)
        } else {
            copyFileSync(target, saved)
        }
    }
    const put = (kind, name, source) => {
        const target = join(dirs[kind], name)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(source, target)
    }

    for (const change of changes) {
        save(change.kind, change.name)
        if (change.action !== 'removed') {
            put(change.kind, change.name, change.source)
        }
        if (change.kind === 'mods' && dirs.mods !== dirs.runtimeMods) {
            rmSync(join(dirs.runtimeMods, change.name), { force: true })
        }
    }

    const config = Object.fromEntries([...wanted.config].map(([name, item]) => [name, item.hash]))
    writeFileSync(join(dirs.data, manifestName), `${JSON.stringify({ config }, null, 2)}\n`)

    if (existsSync(backupRoot)) {
        for (const name of readdirSync(backupRoot).sort().reverse().slice(keepBackups)) {
            rmSync(join(backupRoot, name), { recursive: true, force: true })
        }
    }
}

function stopServer() {
    console.log(`server: stopping ${container}`)
    docker('stop', '--time', String(stopTimeout), container)
}

function startServer() {
    console.log(`server: starting ${container}`)
    docker('start', container)
}

async function waitUntilHealthy() {
    const deadline = Date.now() + startTimeout * 1000
    while (Date.now() < deadline) {
        const { State } = inspect()
        if (State.Status === 'running' && (!State.Health || State.Health.Status === 'healthy')) {
            return
        }
        if (!['running', 'restarting', 'created'].includes(State.Status)) {
            break
        }
        await new Promise(resolve => setTimeout(resolve, 5000))
    }
    const logs = run(['logs', '--tail', '50', container])
    console.error(`${logs.stdout}${logs.stderr}`)
    fail(`${container} did not become healthy`)
}

if (!existsSync(serverDir)) {
    fail(`${serverDir} does not exist`)
}

const mounts = inspect().Mounts
const mountSource = destination => mounts.find(mount => mount.Destination === destination)?.Source
const dataDir = process.env.CBO_DATA_DIR || mountSource('/data')
if (!dataDir || !existsSync(dataDir)) {
    fail(`the data directory of ${container} was not found or is not accessible, set CBO_DATA_DIR`)
}

const dirs = {
    data: dataDir,
    mods: process.env.CBO_MODS_DIR || mountSource('/mods') || join(dataDir, 'mods'),
    config: join(dataDir, 'config'),
    runtimeMods: join(dataDir, 'mods')
}

const wanted = wantedState()
if (wanted.excluded.length > 0) {
    console.log(`server: ${wanted.excluded.length} excluded by exclude.txt`)
    console.log(wanted.excluded.sort().map(key => `excluded ${key}`).join('\n'))
}
if (wanted.mods.size === 0) {
    fail(`no mods found for ${serverId}, refusing to empty the server`)
}

const changes = plan(wanted, dirs)
if (changes.length === 0) {
    console.log(`server: ${container} is up to date`)
    process.exit(0)
}

report(changes)
preflight(changes, dirs)

if (dryRun) {
    console.log('server: dry run, nothing was changed')
    process.exit(0)
}

stopServer()
try {
    apply(changes, wanted, dirs)
} catch (error) {
    fail(`the sync failed and ${container} was left stopped: ${error.message}`)
}
startServer()
await waitUntilHealthy()
console.log(`server: ${container} is healthy`)
