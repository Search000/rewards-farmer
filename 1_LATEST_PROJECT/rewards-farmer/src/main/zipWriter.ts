import { crc32, deflateRawSync } from 'node:zlib'

// Phase 14: writes one ordinary ZIP file in memory (no extra package). Windows Explorer, 7-Zip and every unzip tool open it.
// Only what the diagnostics bundle needs: plain files with deflate compression, UTF-8 names, no folders, no encryption, no
// ZIP64 (a bundle is a few MB at most; anything near 4 GB is refused).

export interface ZipEntry {
    // Forward slashes for sub-folders ("logs/app.log.txt"). Checked below: no "..", no absolute path, no backslash.
    readonly name: string
    readonly data: Buffer
    readonly modified: Date
}

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const END_SIG = 0x06054b50
const MAX_ENTRIES = 65534
const MAX_SIZE = 0xfffffffe

function dosDateTime(d: Date): { time: number; date: number } {
    const year = Math.max(1980, d.getFullYear())
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    }
}

export function isSafeEntryName(name: string): boolean {
    if (name === '' || name.length > 200) return false
    if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name))
        return false
    return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function buildZip(entries: readonly ZipEntry[]): Buffer {
    if (entries.length > MAX_ENTRIES) throw new Error('Too many files for one ZIP.')
    const seen = new Set<string>()
    const locals: Buffer[] = []
    const centrals: Buffer[] = []
    let offset = 0

    for (const entry of entries) {
        if (!isSafeEntryName(entry.name)) throw new Error('Unsafe file name in ZIP.')
        const lower = entry.name.toLowerCase()
        if (seen.has(lower)) throw new Error('Two files with the same name in ZIP.')
        seen.add(lower)
        if (entry.data.length > MAX_SIZE) throw new Error('A file is too large for this ZIP writer.')

        const name = Buffer.from(entry.name, 'utf8')
        const packed = deflateRawSync(entry.data, { level: 6 })
        const crc = crc32(entry.data)
        const { time, date } = dosDateTime(entry.modified)

        const local = Buffer.alloc(30)
        local.writeUInt32LE(LOCAL_SIG, 0)
        local.writeUInt16LE(20, 4) // version needed
        local.writeUInt16LE(0x0800, 6) // flags: names are UTF-8
        local.writeUInt16LE(8, 8) // method: deflate
        local.writeUInt16LE(time, 10)
        local.writeUInt16LE(date, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(packed.length, 18)
        local.writeUInt32LE(entry.data.length, 22)
        local.writeUInt16LE(name.length, 26)
        local.writeUInt16LE(0, 28) // extra field length
        locals.push(local, name, packed)

        const central = Buffer.alloc(46)
        central.writeUInt32LE(CENTRAL_SIG, 0)
        central.writeUInt16LE(20, 4) // version made by
        central.writeUInt16LE(20, 6) // version needed
        central.writeUInt16LE(0x0800, 8)
        central.writeUInt16LE(8, 10)
        central.writeUInt16LE(time, 12)
        central.writeUInt16LE(date, 14)
        central.writeUInt32LE(crc, 16)
        central.writeUInt32LE(packed.length, 20)
        central.writeUInt32LE(entry.data.length, 24)
        central.writeUInt16LE(name.length, 28)
        // extra length, comment length, disk number, internal attributes, external attributes stay 0
        central.writeUInt32LE(offset, 42)
        centrals.push(central, name)

        offset += local.length + name.length + packed.length
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0)
    if (offset + centralSize > MAX_SIZE) throw new Error('The ZIP would be too large.')
    const end = Buffer.alloc(22)
    end.writeUInt32LE(END_SIG, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...locals, ...centrals, end])
}
