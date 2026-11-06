import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(process.env.ROOT ?? process.cwd())
const serversDir = join(root, 'servers')
const dryRun = process.env.DRY_RUN === 'true'
const groups = ['required', 'optionalon', 'optionaloff']
const services = [
    'META-INF/services/cpw.mods.modlauncher.api.ITransformationService',
    'META-INF/services/net.minecraftforge.forgespi.locating.IModLocator',
    'META-INF/services/net.minecraftforge.forgespi.locating.IDependencyLocator'
]
const endSignature = 0x06054b50
const entrySignature = 0x02014b50

function fail(message) {
    console.error(`error: ${message}`)
    process.exit(1)
}

function entryNames(path) {
    const file = openSync(path, 'r')
    try {
        const total = fstatSync(file).size
        const length = Math.min(total, 22 + 0xffff)
        const tail = Buffer.alloc(length)
        readSync(file, tail, 0, length, total - length)
        let end = length - 22
        while (end >= 0 && tail.readUInt32LE(end) !== endSignature) {
            end--
        }
        if (end < 0) {
            fail(`${relative(root, path)} is not a valid zip archive`)
        }
        const directorySize = tail.readUInt32LE(end + 12)
        const directoryOffset = tail.readUInt32LE(end + 16)
        if (directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
            fail(`${relative(root, path)} uses zip64, which this script cannot read`)
        }
        const directory = Buffer.alloc(directorySize)
        readSync(file, directory, 0, directorySize, directoryOffset)
        const names = new Set()
        let offset = 0
        while (offset + 46 <= directorySize && directory.readUInt32LE(offset) === entrySignature) {
            const nameLength = directory.readUInt16LE(offset + 28)
            const extraLength = directory.readUInt16LE(offset + 30)
            const commentLength = directory.readUInt16LE(offset + 32)
            names.add(directory.toString('utf8', offset + 46, offset + 46 + nameLength))
            offset += 46 + nameLength + extraLength + commentLength
        }
        return names
    } finally {
        closeSync(file)
    }
}

function loadsEarly(path) {
    const names = entryNames(path)
    return services.some(service => names.has(service))
}

function jars(dir) {
    if (!existsSync(dir)) {
        return []
    }
    return readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.jar'))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
}

const moves = []
const skipped = []

if (existsSync(serversDir)) {
    for (const server of readdirSync(serversDir, { withFileTypes: true })) {
        if (!server.isDirectory()) {
            continue
        }
        for (const group of groups) {
            const source = join(serversDir, server.name, 'forgemods', group)
            for (const name of jars(source)) {
                const path = join(source, name)
                if (!loadsEarly(path)) {
                    continue
                }
                if (group === 'required') {
                    moves.push({ path, target: join(serversDir, server.name, 'files', 'mods', name) })
                } else {
                    skipped.push(path)
                }
            }
        }
    }
}

for (const path of skipped) {
    console.warn(`warning: ${relative(root, path)} must be in the mods folder but is optional, so it stays in the mod list`)
}

for (const move of moves) {
    if (existsSync(move.target)) {
        fail(`cannot move ${relative(root, move.path)}, ${relative(root, move.target)} already exists`)
    }
}

for (const move of moves) {
    console.log(`stage: ${relative(root, move.path)} -> ${relative(root, move.target)}`)
    if (!dryRun) {
        mkdirSync(dirname(move.target), { recursive: true })
        renameSync(move.path, move.target)
    }
}
console.log(`stage: ${moves.length} ${dryRun ? 'would be moved' : 'moved'}`)
