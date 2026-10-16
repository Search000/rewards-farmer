// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildZip, isSafeEntryName } from '../../src/main/zipWriter'
import { readZip } from '../helpers/readZip'

const when = new Date(2026, 9, 14, 10, 30, 42)

describe('zip writer', () => {
    it('writes files that read back byte for byte (text, empty, non-ASCII, binary)', () => {
        const binary = Buffer.from(Array.from({ length: 5000 }, (_v, i) => (i * 7) % 256))
        const zip = buildZip([
            { name: 'README.txt', data: Buffer.from('hello\n'), modified: when },
            { name: 'logs/empty.txt', data: Buffer.alloc(0), modified: when },
            { name: 'logs/unicode.txt', data: Buffer.from('বাংলা ✓ ü', 'utf8'), modified: when },
            { name: 'bin.dat', data: binary, modified: when }
        ])
        const back = readZip(zip)
        expect(back.map((e) => e.name)).toEqual([
            'README.txt',
            'logs/empty.txt',
            'logs/unicode.txt',
            'bin.dat'
        ])
        expect(back[0]?.data.toString()).toBe('hello\n')
        expect(back[1]?.data.length).toBe(0)
        expect(back[2]?.data.toString('utf8')).toBe('বাংলা ✓ ü')
        expect(back[3]?.data.equals(binary)).toBe(true)
    })

    it('compresses repeated text', () => {
        const text = Buffer.from('log line of the engine\n'.repeat(20000))
        const zip = buildZip([{ name: 'a.txt', data: text, modified: when }])
        expect(zip.length).toBeLessThan(text.length / 20)
        expect(readZip(zip)[0]?.data.equals(text)).toBe(true)
    })

    it('refuses names that could escape the folder or collide', () => {
        for (const bad of [
            '',
            '/abs.txt',
            '../x.txt',
            'a/../x.txt',
            'a\\b.txt',
            'C:/x.txt',
            'a//b.txt',
            './x.txt'
        ])
            expect(isSafeEntryName(bad), bad).toBe(false)
        expect(isSafeEntryName('logs/app.log.txt')).toBe(true)
        expect(() => buildZip([{ name: '../evil.txt', data: Buffer.from('x'), modified: when }])).toThrow(
            'Unsafe file name'
        )
        expect(() =>
            buildZip([
                { name: 'A.txt', data: Buffer.from('1'), modified: when },
                { name: 'a.txt', data: Buffer.from('2'), modified: when }
            ])
        ).toThrow('same name')
    })

    it('a zip with no files is still a valid empty zip', () => {
        expect(readZip(buildZip([]))).toEqual([])
    })
})
