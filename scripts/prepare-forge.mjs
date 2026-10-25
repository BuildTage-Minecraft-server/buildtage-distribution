import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = resolve(process.env.ROOT ?? process.cwd())
const java = process.env.JAVA_EXECUTABLE ?? 'java'
const maven = (process.env.FORGE_MAVEN_URL ?? 'https://maven.minecraftforge.net').replace(/\/+$/, '')
const serversDir = join(root, 'servers')

function fail(message) {
    console.error(`error: ${message}`)
    process.exit(1)
}

async function download(url, target) {
    const response = await fetch(url)
    if (!response.ok || !response.body) {
        fail(`download of ${url} failed with status ${response.status}`)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
}

if (!existsSync(serversDir)) {
    fail(`${serversDir} does not exist`)
}

for (const entry of readdirSync(serversDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
        continue
    }
    const metaPath = join(serversDir, entry.name, 'servermeta.json')
    if (!existsSync(metaPath)) {
        continue
    }
    const forge = JSON.parse(readFileSync(metaPath, 'utf8')).forge?.version
    const minecraft = /-(\d+\.\d+(?:\.\d+)?)$/.exec(entry.name)?.[1]
    if (!forge || !minecraft) {
        continue
    }

    const fullVersion = `${minecraft}-${forge}`
    const target = join(root, 'cache', 'forge', fullVersion)
    const profile = join(target, 'versions', `${minecraft}-forge-${forge}`)

    if (existsSync(profile)) {
        console.log(`forge ${fullVersion}: already installed`)
        continue
    }

    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'launcher_profiles.json'), JSON.stringify({ profiles: {}, version: 3 }))

    const installer = join(tmpdir(), `forge-${fullVersion}-installer.jar`)
    const url = `${maven}/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`
    console.log(`forge ${fullVersion}: downloading ${url}`)
    await download(url, installer)

    console.log(`forge ${fullVersion}: installing into ${target}`)
    const result = spawnSync(java, ['-jar', installer, '--installClient', target], { stdio: 'inherit' })
    if (result.status !== 0) {
        fail(`the Forge installer exited with code ${result.status}`)
    }
    if (!existsSync(profile)) {
        fail(`the installer finished but ${profile} was not created`)
    }
    console.log(`forge ${fullVersion}: installed`)
}
