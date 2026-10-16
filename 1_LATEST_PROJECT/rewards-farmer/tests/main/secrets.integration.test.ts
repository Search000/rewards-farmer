// @vitest-environment node
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/engine/apiClient'
import type { EngineApi } from '../../src/main/engine/apiClient'
import { Redactor } from '../../src/main/engine/redact'
import type { JsonlLog } from '../../src/main/jsonlLog'
import { SecretsService } from '../../src/main/secrets'
import { SECRET_FIELDS } from '../../src/shared/secrets-rules'
import type { SecretId } from '../../src/shared/secrets-types'
import { FAKE } from '../fixtures/fake-secrets'
import { makeHarness, readLog, waitFor } from './helpers'
import type { Harness } from './helpers'

// Secrets against the REAL engine control API (engine/scripts/api/server.js, unmodified). Values are FAKE and live in a
// temp dir only (rule 18).

const harnesses: Harness[] = []
afterEach(async () => {
    while (harnesses.length > 0) await harnesses.pop()?.cleanup()
})

interface Rig {
    readonly h: Harness
    readonly secrets: SecretsService
    readonly backupDir: string
    readonly configPath: string
}

async function rig(): Promise<Rig> {
    const h = makeHarness()
    harnesses.push(h)
    const configPath = join(h.fx.engineRoot, 'config.json')
    const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, Record<string, unknown>>
    cfg.searchSettings = { ...cfg.searchSettings, queryEngines: ['local'] }
    writeFileSync(configPath, JSON.stringify(cfg, null, 2))
    const backupDir = join(h.fx.userData, 'backups', 'config')
    const secrets = new SecretsService({
        host: {
            api: () => h.farmer.engineApi(),
            editBlock: () => h.farmer.settingsEditBlock(),
            run: (work) => h.farmer.editEngineConfig(work)
        },
        engineRoot: h.fx.engineRoot,
        redactor: h.redactor,
        audit: h.audit,
        appLog: h.appLog,
        backupDir
    })
    await h.farmer.init()
    return { h, secrets, backupDir, configPath }
}

async function ready(): Promise<Rig> {
    const r = await rig()
    expect((await r.h.farmer.pickAccounts()).result.ok).toBe(true)
    await waitFor(
        () => r.h.farmer.getState().engine.link,
        (v) => v === 'ready',
        'engine ready'
    )
    return r
}

const allFakeValues = Object.values(FAKE)
const onlyDisk = (r: Rig): string => readFileSync(r.configPath, 'utf8')
const logs = (r: Rig): string => readLog(r.h, 'app.log') + readLog(r.h, 'audit.log')

describe('secrets service against the real engine (Phase 10)', () => {
    it('before an accounts file is chosen: unavailable, no fields, edit disabled with a reason', async () => {
        const r = await rig()
        const s = await r.secrets.getState()
        expect(s.status).toBe('unavailable')
        expect(s.fields).toEqual([])
        expect(s.editDisabledReason).not.toBeNull()
        expect((await r.secrets.set('ntfyToken', FAKE.ntfyToken)).ok).toBe(false)
    })

    it('lists every field as not set on a fresh config', async () => {
        const r = await ready()
        const s = await r.secrets.getState()
        expect(s.status).toBe('ok')
        expect(s.fields.map((f) => f.id)).toEqual(SECRET_FIELDS.map((f) => f.id))
        expect(s.fields.every((f) => !f.isSet)).toBe(true)
        expect(s.editDisabledReason).toBeNull()
    })

    it('saves every field at its real path; state shows set / not set and never a value', async () => {
        const r = await ready()
        for (const id of Object.keys(FAKE) as SecretId[]) {
            const res = await r.secrets.set(id, FAKE[id])
            expect(res, id).toMatchObject({ ok: true })
            expect(res.message).not.toContain(FAKE[id])
        }
        const disk = JSON.parse(onlyDisk(r)) as {
            webhook: {
                discord: { url: string }
                telegram: { botToken: string; chatId: string }
                pushplus: { token: string }
                serverchan: { sendKey: string }
                ntfy: { url: string; token: string }
            }
            searchSettings: { chinaApi: { appkey: string } }
        }
        expect(disk.webhook.discord.url).toBe(FAKE.discordUrl)
        expect(disk.webhook.telegram.botToken).toBe(FAKE.telegramBotToken)
        expect(disk.webhook.telegram.chatId).toBe(FAKE.telegramChatId)
        expect(disk.webhook.pushplus.token).toBe(FAKE.pushplusToken)
        expect(disk.webhook.serverchan.sendKey).toBe(FAKE.serverchanSendKey)
        expect(disk.webhook.ntfy.url).toBe(FAKE.ntfyUrl)
        expect(disk.webhook.ntfy.token).toBe(FAKE.ntfyToken)
        expect(disk.searchSettings.chinaApi.appkey).toBe(FAKE.chinaApiAppkey)

        const state = await r.secrets.getState()
        expect(state.fields.every((f) => f.isSet)).toBe(true)
        const wire = JSON.stringify(state)
        for (const v of allFakeValues) expect(wire).not.toContain(v)
    })

    it('documents the engine gap: its own GET /config leaves some secrets unmasked, so only main may read it', async () => {
        const r = await ready()
        await r.secrets.set('pushplusToken', FAKE.pushplusToken)
        await r.secrets.set('chinaApiAppkey', FAKE.chinaApiAppkey)
        const raw = JSON.stringify((await (r.h.farmer.engineApi() as EngineApi).config()).config)
        // The engine redacts discord / ntfy / telegram but NOT these two. The service must keep them off the wire.
        expect(raw).toContain(FAKE.pushplusToken)
        expect(raw).toContain(FAKE.chinaApiAppkey)
        const wire = JSON.stringify(await r.secrets.getState())
        expect(wire).not.toContain(FAKE.pushplusToken)
        expect(wire).not.toContain(FAKE.chinaApiAppkey)
    })

    it('changes only the one field: neighbouring settings and other secrets stay as they were', async () => {
        const r = await ready()
        await r.secrets.set('telegramBotToken', FAKE.telegramBotToken)
        const before = JSON.parse(onlyDisk(r)) as Record<string, unknown>
        await r.secrets.set('telegramChatId', FAKE.telegramChatId)
        const after = JSON.parse(onlyDisk(r)) as { webhook: { telegram: Record<string, unknown> } }
        expect(after.webhook.telegram.botToken).toBe(FAKE.telegramBotToken)
        expect(after.webhook.telegram.chatId).toBe(FAKE.telegramChatId)
        const strip = (o: Record<string, unknown>) => JSON.stringify({ ...o, webhook: undefined })
        expect(strip(after as unknown as Record<string, unknown>)).toBe(strip(before))
    })

    it('a rotated key replaces the old one; the old value is still masked in logs afterwards', async () => {
        const r = await ready()
        await r.secrets.set('pushplusToken', FAKE.pushplusToken)
        const rotated = 'ROTATEDpushplusTOKEN9876543210'
        expect((await r.secrets.set('pushplusToken', rotated)).ok).toBe(true)
        expect(onlyDisk(r)).toContain(rotated)
        expect(onlyDisk(r)).not.toContain(FAKE.pushplusToken)
        expect(r.h.redactor.redact(`x ${FAKE.pushplusToken} y ${rotated}`)).toBe('x *** y ***')
    })

    it('clear removes the value; clearing an empty field changes nothing and makes no backup', async () => {
        const r = await ready()
        const nothing = await r.secrets.clear('ntfyToken')
        expect(nothing).toMatchObject({ ok: true })
        expect(existsSync(r.backupDir)).toBe(false)
        await r.secrets.set('ntfyToken', FAKE.ntfyToken)
        expect((await r.secrets.clear('ntfyToken')).ok).toBe(true)
        expect(onlyDisk(r)).not.toContain(FAKE.ntfyToken)
        const f = (await r.secrets.getState()).fields.find((x) => x.id === 'ntfyToken')
        expect(f?.isSet).toBe(false)
    })

    it('a backup copy is made before each change, and it is private to the user (POSIX mode)', async () => {
        const r = await ready()
        await r.secrets.set('discordUrl', FAKE.discordUrl)
        const files = readdirSync(r.backupDir).filter((n) => n.endsWith('.json'))
        expect(files.length).toBe(1)
        // The first backup is the config as it was BEFORE the change: no secret in it yet.
        const copy = readFileSync(join(r.backupDir, files[0] as string), 'utf8')
        expect(copy).not.toContain(FAKE.discordUrl)
        if (process.platform !== 'win32') {
            expect(statSync(join(r.backupDir, files[0] as string)).mode & 0o777).toBe(0o600)
            expect(statSync(r.backupDir).mode & 0o777).toBe(0o700)
            expect(statSync(r.configPath).mode & 0o777).toBe(0o600)
        }
    })

    it('invalid values are refused before they reach the engine: file and backups unchanged', async () => {
        const r = await ready()
        const bytes = readFileSync(r.configPath)
        for (const [id, bad] of [
            ['discordUrl', 'https://example.com/x'],
            ['telegramBotToken', 'nope'],
            ['ntfyUrl', 'https://u:p@ntfy.example.com'],
            ['ntfyToken', ''],
            ['ntfyToken', 'with\nbreak12345']
        ] as const) {
            const res = await r.secrets.set(id, bad)
            expect(res, id).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
        }
        expect((await r.secrets.set('nope', 'x')).ok).toBe(false)
        expect((await r.secrets.clear({} as unknown as string)).ok).toBe(false)
        expect(readFileSync(r.configPath)).toEqual(bytes)
        expect(existsSync(r.backupDir)).toBe(false)
    })

    it('is refused while a run is active, and the file stays as it was', async () => {
        const r = await ready()
        expect((await r.h.farmer.startRun()).ok).toBe(true)
        await waitFor(
            () => r.h.farmer.getState().run.phase,
            (p) => p === 'running',
            'run active'
        )
        const bytes = readFileSync(r.configPath)
        expect((await r.secrets.getState()).editDisabledReason).toMatch(/run is active/i)
        const res = await r.secrets.set('ntfyToken', FAKE.ntfyToken)
        expect(res).toMatchObject({ ok: false, code: 'RUN_ACTIVE' })
        expect(readFileSync(r.configPath)).toEqual(bytes)
    })

    it('config.json missing: state is unavailable with a plain reason, and Set fails without inventing success', async () => {
        const r = await ready()
        rmSync(r.configPath)
        const s = await r.secrets.getState()
        expect(['unavailable', 'error']).toContain(s.status)
        expect(s.fields).toEqual([])
        const res = await r.secrets.set('ntfyToken', FAKE.ntfyToken)
        expect(res.ok).toBe(false)
    })

    it('no secret value appears in the app log or the audit log, and audit lines name the field only', async () => {
        const r = await ready()
        for (const id of Object.keys(FAKE) as SecretId[]) await r.secrets.set(id, FAKE[id])
        await r.secrets.clear('discordUrl')
        // The log file is written in the background: wait until the last audit line is on disk.
        const text = await waitFor(
            () => logs(r),
            (t) => t.includes('Discord webhook URL: cleared'),
            'the clear audit line'
        )
        for (const v of allFakeValues) expect(text).not.toContain(v)
        expect(text).toMatch(/Discord webhook URL: cleared/)
        expect(text).toMatch(/Telegram bot token: saved \(value not logged\)/)
    })
})

describe('secrets service with a stand-in engine API (failure paths)', () => {
    function standIn(config: unknown, patch: () => Promise<unknown>) {
        const dir = join(process.cwd(), 'node_modules', '.cache', 'rf-secrets-standin')
        const redactor = new Redactor()
        const records: string[] = []
        const sink = {
            write: (rec: { message: string }) => void records.push(rec.message)
        } as unknown as JsonlLog
        const api = {
            config: () => Promise.resolve({ path: join(dir, 'engine', 'config.json'), config }),
            patchConfig: patch
        } as unknown as EngineApi
        const service = new SecretsService({
            host: { api: () => api, editBlock: () => null, run: (work) => work() },
            engineRoot: join(dir, 'engine'),
            redactor,
            audit: sink,
            appLog: sink,
            backupDir: join(dir, 'backups'),
            restrict: () => Promise.resolve({ ok: true, detail: 'test' })
        })
        return { service, records, redactor }
    }

    it('an engine error text that echoes the value is masked before it reaches the screen or the audit log', async () => {
        const { mkdirSync, writeFileSync } = await import('node:fs')
        const dir = join(process.cwd(), 'node_modules', '.cache', 'rf-secrets-standin', 'engine')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'config.json'), '{}')
        const { service, records } = standIn({}, () =>
            Promise.reject(new AppError('CONFIG_INVALID', `webhook.ntfy.token invalid: ${FAKE.ntfyToken}`))
        )
        const res = await service.set('ntfyToken', FAKE.ntfyToken)
        expect(res.ok).toBe(false)
        expect(res.message).not.toContain(FAKE.ntfyToken)
        expect(res.message).toContain('***')
        for (const m of records) expect(m).not.toContain(FAKE.ntfyToken)
    })

    it('if the engine saves a different value than was sent, it is reported as a failure', async () => {
        const { mkdirSync, writeFileSync } = await import('node:fs')
        const dir = join(process.cwd(), 'node_modules', '.cache', 'rf-secrets-standin', 'engine')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'config.json'), '{}')
        const { service } = standIn({}, () => Promise.resolve({}))
        const res = await service.set('ntfyToken', FAKE.ntfyToken)
        expect(res).toMatchObject({ ok: false, code: 'WRITE_FAILED' })
        expect(res.message).toMatch(/reading it back/i)
    })
})
