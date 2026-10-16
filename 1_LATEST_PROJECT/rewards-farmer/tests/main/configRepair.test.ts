// @vitest-environment node
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    cpSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupName, mergeSalvaged, repairConfigFile } from '../../src/main/configRepair'
import { extractValues } from '../../src/shared/engine-settings-rules'
import { REPO_ROOT } from './helpers'

// Phase 15 follow-up: "Repair config.json". Real files in a temp dir, the real engine example.

const EXAMPLE = join(REPO_ROOT, 'engine', 'config.example.json')
const dirs: string[] = []
afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function engine(config: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'rf-repair-'))
    dirs.push(dir)
    cpSync(EXAMPLE, join(dir, 'config.example.json'))
    if (config !== null) writeFileSync(join(dir, 'config.json'), config)
    return dir
}
const example = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Record<string, unknown>
const read = (dir: string, name = 'config.json'): string => readFileSync(join(dir, name), 'utf8')
const names = (dir: string): string[] => readdirSync(dir).sort()

describe('repairConfigFile (real files)', () => {
    it('not valid JSON: copy kept byte for byte, new config.json is valid, everything from the example', async () => {
        const broken = '{ this is not json "headless": tru'
        const dir = engine(broken)
        const r = await repairConfigFile(dir)
        expect(r).toMatchObject({ ok: true, backupName: 'config.broken.json', kept: 0 })
        expect(r.message).toContain('every setting is back to the engine example')
        expect(read(dir, 'config.broken.json')).toBe(broken)
        const fixed = JSON.parse(read(dir)) as unknown
        expect(fixed).toEqual(example)
        const check = extractValues(fixed, null)
        expect(check.ok && check.value.missing.length).toBe(0)
        expect(names(dir).filter((n) => n.includes('.tmp'))).toEqual([])
    })

    it('a wrong value: only that setting goes back to the example, every other setting is kept', async () => {
        const custom = JSON.parse(JSON.stringify(example)) as Record<string, unknown>
        const boolKeys = Object.keys(example).filter((k) => typeof example[k] === 'boolean')
        expect(boolKeys.length).toBeGreaterThan(1)
        const [bad, good] = boolKeys as [string, string]
        custom[bad] = 'yes' // wrong type
        custom[good] = !(example[good] as boolean) // a real change the user made
        const dir = engine(JSON.stringify(custom, null, 2))
        const r = await repairConfigFile(dir)
        expect(r.ok).toBe(true)
        const fixed = JSON.parse(read(dir)) as Record<string, unknown>
        expect(fixed[bad]).toBe(example[bad])
        expect(fixed[good]).toBe(!(example[good] as boolean))
        expect(r.reset).toBeGreaterThanOrEqual(1)
        expect(read(dir, 'config.broken.json')).toBe(JSON.stringify(custom, null, 2))
        const check = extractValues(fixed, null)
        expect(check.ok).toBe(true)
    })

    it('never overwrites an older copy: the next name is config.broken-2.json, then -3', async () => {
        const dir = engine('{ broken 1')
        await repairConfigFile(dir)
        writeFileSync(join(dir, 'config.json'), '{ broken 2')
        const r2 = await repairConfigFile(dir)
        expect(r2.backupName).toBe('config.broken-2.json')
        writeFileSync(join(dir, 'config.json'), '{ broken 3')
        const r3 = await repairConfigFile(dir)
        expect(r3.backupName).toBe('config.broken-3.json')
        expect(read(dir, 'config.broken.json')).toBe('{ broken 1')
        expect(read(dir, 'config.broken-2.json')).toBe('{ broken 2')
        expect(read(dir, 'config.broken-3.json')).toBe('{ broken 3')
        expect(backupName(1)).toBe('config.broken.json')
    })

    it('a huge file (over 1 MB) is not parsed: kept as a copy, everything from the example', async () => {
        const huge = `{"x":"${'a'.repeat(1024 * 1024 + 10)}"}`
        const dir = engine(huge)
        const r = await repairConfigFile(dir)
        expect(r.ok).toBe(true)
        expect(read(dir, 'config.broken.json').length).toBe(huge.length)
        expect(JSON.parse(read(dir))).toEqual(example)
    })

    it('config.json missing: refused with the Create config advice, nothing written', async () => {
        const dir = engine(null)
        const before = names(dir)
        const r = await repairConfigFile(dir)
        expect(r).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        expect(r.message).toContain('Create config')
        expect(names(dir)).toEqual(before)
    })

    it('the engine example is missing: refused, config.json is byte for byte the same, no copy, no temp file', async () => {
        const dir = engine('{ broken')
        rmSync(join(dir, 'config.example.json'))
        const r = await repairConfigFile(dir)
        expect(r).toMatchObject({ ok: false, code: 'WRITE_FAILED' })
        expect(read(dir)).toBe('{ broken')
        expect(names(dir)).toEqual(['config.json'])
    })

    it('a config.json that is a folder: refused with a plain message, nothing changed', async () => {
        const dir = engine(null)
        mkdirSync(join(dir, 'config.json'))
        const r = await repairConfigFile(dir)
        expect(r.ok).toBe(false)
        expect(existsSync(join(dir, 'config.broken.json'))).toBe(false)
    })
})

describe('mergeSalvaged (pure)', () => {
    it('keeps a good value, resets a bad one, counts both, keeps the example for absent keys', () => {
        const ex = { a: true, b: 5, c: 'x' }
        const merged = mergeSalvaged(ex, { a: false })
        expect(merged.merged).toEqual(ex === merged.merged ? ex : { a: false, b: 5, c: 'x' })
        expect(merged.kept).toBe(1)
        expect(merged.reset).toBe(2)
        expect(mergeSalvaged(ex, [1, 2])).toMatchObject({ kept: 0, reset: 3 })
    })
})
