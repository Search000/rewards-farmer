import { crc32, inflateRawSync } from 'node:zlib'

// Test helper: a small independent ZIP reader. It reads the central directory the way any unzip tool does and CHECKS the
// CRC-32 and the sizes, so a test fails when the writer produces a broken file.

export interface ReadEntry {
    readonly name: string
    readonly data: Buffer
}

export function readZip(zip: Buffer): ReadEntry[] {
    const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (endAt < 0) throw new Error('no end-of-central-directory record')
    const count = zip.readUInt16LE(endAt + 10)
    const centralSize = zip.readUInt32LE(endAt + 12)
    const centralOffset = zip.readUInt32LE(endAt + 16)
    if (centralOffset + centralSize !== endAt)
        throw new Error('central directory does not end where the end record starts')
    const out: ReadEntry[] = []
    let p = centralOffset
    for (let i = 0; i < count; i++) {
        if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header')
        const method = zip.readUInt16LE(p + 10)
        const crc = zip.readUInt32LE(p + 16)
        const csize = zip.readUInt32LE(p + 20)
        const usize = zip.readUInt32LE(p + 24)
        const nameLen = zip.readUInt16LE(p + 28)
        const extraLen = zip.readUInt16LE(p + 30)
        const commentLen = zip.readUInt16LE(p + 32)
        const localAt = zip.readUInt32LE(p + 42)
        const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
        if (zip.readUInt32LE(localAt) !== 0x04034b50) throw new Error('bad local header')
        const localNameLen = zip.readUInt16LE(localAt + 26)
        const localExtraLen = zip.readUInt16LE(localAt + 28)
        const dataAt = localAt + 30 + localNameLen + localExtraLen
        const packed = zip.subarray(dataAt, dataAt + csize)
        if (method !== 8 && method !== 0) throw new Error(`unsupported method ${String(method)}`)
        const data = method === 8 ? inflateRawSync(packed) : packed
        if (data.length !== usize) throw new Error(`size mismatch for ${name}`)
        if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`)
        out.push({ name, data: Buffer.from(data) })
        p += 46 + nameLen + extraLen + commentLen
    }
    return out
}
