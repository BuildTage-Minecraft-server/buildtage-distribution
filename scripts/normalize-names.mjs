import { existsSync, readdirSync, renameSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(process.env.ROOT ?? process.cwd())
const serversDir = join(root, 'servers')
let renamed = 0

function fail(message) {
    console.error(`error: ${message}`)
    process.exit(1)
}

function decode(name) {
    try {
        return decodeURIComponent(name)
    } catch {
        return name
    }
}

function normalize(name) {
    return decode(name).replace(/[\u0000-\u001f\\/%#?]/g, '_')
}

function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
            walk(path)
        }
        const name = normalize(entry.name)
        if (name === entry.name) {
            continue
        }
        const target = join(dir, name)
        if (existsSync(target)) {
            fail(`cannot rename ${relative(root, path)} to ${name}, such a file already exists`)
        }
        renameSync(path, target)
        renamed++
        console.log(`rename: ${relative(root, path)} -> ${name}`)
    }
}

if (existsSync(serversDir)) {
    walk(serversDir)
}
console.log(`names: ${renamed} renamed`)
