import { constants as fsConstants } from 'node:fs'
import { copyFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractValues } from '../shared/engine-settings-rules'

// Phase 15 follow-up: "Repair config.json". Rules it follows:
//  - the broken file is NEVER deleted or overwritten: it is copied to config.broken.json first (or config.broken-2.json,
//    config.broken-3.json ... when that name is taken), and config.json is only replaced when the new content is complete;
//  - the new file starts from config.example.json; every top-level setting of the old file that still has a good value is kept;
//  - what could not be kept is counted and named in the message, never silently dropped (the full old file is in the copy).

export const MAX_REPAIR_BYTES = 1024 * 1024
const MAX_BACKUP_NUMBER = 99

export interface RepairOutcome {
    readonly ok: boolean
    readonly message: string
    readonly backupName: string | null
    readonly kept: number
    readonly reset: number
    readonly code?: 'BAD_REQUEST' | 'WRITE_FAILED'
}

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

export function backupName(n: number): string {
    return n <= 1 ? 'config.broken.json' : `config.broken-${String(n)}.json`
}

// Pure: merges the old config into the example. A top-level setting is kept only when the result still passes the same
// check the Health page uses. Settings the old file does not have, or that cannot be used, come from the example.
export function mergeSalvaged(
    example: Record<string, unknown>,
    old: unknown
): { merged: Record<string, unknown>; kept: number; reset: number } {
    const merged: Record<string, unknown> = { ...example }
    if (!isObject(old)) return { merged, kept: 0, reset: Object.keys(example).length }
    let kept = 0
    let reset = 0
    for (const key of Object.keys(example)) {
        if (!(key in old)) {
            reset += 1
            continue
        }
        const candidate = { ...merged, [key]: old[key] }
        if (JSON.stringify(old[key]) === JSON.stringify(example[key])) {
            kept += 1
            continue
        }
        if (extractValues(candidate, null).ok) {
            merged[key] = old[key]
            kept += 1
        } else reset += 1
    }
    return { merged, kept, reset }
}

export async function repairConfigFile(engineRoot: string): Promise<RepairOutcome> {
    const target = join(engineRoot, 'config.json')
    const examplePath = join(engineRoot, 'config.example.json')
    const fail = (code: 'BAD_REQUEST' | 'WRITE_FAILED', message: string): RepairOutcome => ({
        ok: false,
        code,
        message,
        backupName: null,
        kept: 0,
        reset: 0
    })

    let size: number
    try {
        size = (await stat(target)).size
    } catch (e) {
        const c = (e as NodeJS.ErrnoException).code
        return c === 'ENOENT'
            ? fail(
                  'BAD_REQUEST',
                  'config.json does not exist, so there is nothing to repair. Press "Create config" on the Home page.'
              )
            : fail(
                  'WRITE_FAILED',
                  `config.json could not be read (${c ?? 'unknown error'}). Nothing was changed.`
              )
    }

    let example: Record<string, unknown>
    try {
        const parsed = JSON.parse(await readFile(examplePath, 'utf8')) as unknown
        if (!isObject(parsed)) throw new Error('not an object')
        example = parsed
    } catch {
        return fail(
            'WRITE_FAILED',
            'config.example.json (the engine example) is missing or damaged. Nothing was changed.'
        )
    }

    // The old content is only read when it is a normal size. A huge file is not parsed; it is kept as a copy only.
    let old: unknown = null
    if (size <= MAX_REPAIR_BYTES) {
        try {
            const text = await readFile(target, 'utf8')
            old = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
        } catch {
            old = null
        }
    }

    // 1. keep a copy of the old file under a name that is free
    let used: string | null = null
    for (let n = 1; n <= MAX_BACKUP_NUMBER; n += 1) {
        const name = backupName(n)
        try {
            await copyFile(target, join(engineRoot, name), fsConstants.COPYFILE_EXCL)
            used = name
            break
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
            return fail(
                'WRITE_FAILED',
                `Could not keep a copy of config.json (${(e as NodeJS.ErrnoException).code ?? 'unknown error'}). Nothing was changed.`
            )
        }
    }
    if (used === null)
        return fail(
            'WRITE_FAILED',
            'There are already 99 config.broken files. Move some away and try again. Nothing was changed.'
        )

    // 2. write the new content next to the target, then replace config.json in one step
    const { merged, kept, reset } = mergeSalvaged(example, old)
    const tmp = join(engineRoot, `config.json.repair-${String(process.pid)}.tmp`)
    try {
        await writeFile(tmp, `${JSON.stringify(merged, null, 4)}\n`, { encoding: 'utf8', flag: 'wx' })
        await rename(tmp, target)
    } catch (e) {
        await unlink(tmp).catch(() => undefined)
        return fail(
            'WRITE_FAILED',
            `Could not write the new config.json (${(e as NodeJS.ErrnoException).code ?? 'unknown error'}). Your old file is still in place and a copy is in ${used}.`
        )
    }

    const how =
        old === null
            ? 'The old file could not be read as settings, so every setting is back to the engine example.'
            : `${String(kept)} settings were kept, ${String(reset)} were set to the engine example.`
    return {
        ok: true,
        message: `config.json was repaired. ${how} The old file is saved as ${used} in the engine folder.`,
        backupName: used,
        kept,
        reset
    }
}
