import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineApi } from '../../src/main/engine/apiClient'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { NotificationsService } from '../../src/main/notifications'
import { App } from '../../src/renderer/App'
import type { NotifyChannelId } from '../../src/shared/notifications-types'
import { farmerState, installNotifyBridge } from '../helpers/notifyBridge'
import { FAKE } from '../fixtures/fake-secrets'

// Phase 17: the Notifications page against the REAL NotificationsService (Phase 16): a real config.json in a temp folder,
// the real switch code (backup, patch, read back) and the real test code. Only two things are stand-ins (rule 18): the
// engine's PATCH /config (it merges the body into the file, like the engine does) and the network (a recording fetch).
// Values are FAKE. This proves the page and the service agree on state, texts and outcomes, and that nothing is sent
// until the person presses "Send test message".

const REAL_ENGINE = join(__dirname, '..', '..', 'engine')

interface Call {
    readonly url: string
    readonly body: string
}

interface Rig {
    readonly configPath: string
    readonly backupDir: string
    readonly calls: Call[]
    readonly net: { answer: () => Promise<Response> }
    readonly engine: { patches: number }
    readonly service: NotificationsService
    save(hooks: Record<string, Record<string, unknown>>): void
    enabledOf(id: NotifyChannelId): unknown
}

const dirs: string[] = []

function makeRig(): Rig {
    const dir = mkdtempSync(join(tmpdir(), 'rf-notify-ui-'))
    dirs.push(dir)
    const engineRoot = join(dir, 'engine')
    mkdirSync(engineRoot, { recursive: true })
    const configPath = join(engineRoot, 'config.json')
    cpSync(join(REAL_ENGINE, 'config.example.json'), configPath)
    const redactor = new Redactor()
    const redact = (t: string): string => redactor.redact(t)
    const logs = join(dir, 'userData', 'logs')
    const calls: Call[] = []
    const net = { answer: (): Promise<Response> => Promise.resolve(new Response('', { status: 200 })) }
    const engine = { patches: 0 }
    const read = (): Record<string, Record<string, Record<string, unknown>>> =>
        JSON.parse(readFileSync(configPath, 'utf8')) as Record<
            string,
            Record<string, Record<string, unknown>>
        >
    const api = {
        patchConfig: (body: Record<string, unknown>): Promise<unknown> => {
            engine.patches += 1
            const cfg = read()
            const hooks = (body['webhook'] ?? {}) as Record<string, Record<string, unknown>>
            for (const [k, v] of Object.entries(hooks)) {
                cfg['webhook'] = cfg['webhook'] ?? {}
                cfg['webhook'][k] = { ...(cfg['webhook'][k] ?? {}), ...v }
            }
            writeFileSync(configPath, JSON.stringify(cfg, null, 2))
            return Promise.resolve({ ok: true })
        }
    } as unknown as EngineApi
    const backupDir = join(dir, 'userData', 'backups', 'config')
    const service = new NotificationsService({
        host: { api: () => api, editBlock: () => null, run: (work) => work() },
        engineRoot,
        redactor,
        audit: new JsonlLog(logs, 'audit.log', 'audit', redact),
        appLog: new JsonlLog(logs, 'app.log', 'app', redact),
        backupDir,
        fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), body: String(init?.body ?? '') })
            return net.answer()
        }) as typeof fetch,
        // Every test starts at a different moment, so the 5 second "too soon" guard never mixes tests up.
        now: () => new Date(),
        restrict: () => Promise.resolve({ ok: true, detail: 'test' })
    })
    return {
        configPath,
        backupDir,
        calls,
        net,
        engine,
        service,
        save: (hooks) => {
            const cfg = read()
            for (const [k, v] of Object.entries(hooks)) {
                cfg['webhook'] = cfg['webhook'] ?? {}
                cfg['webhook'][k] = { ...(cfg['webhook'][k] ?? {}), ...v }
            }
            writeFileSync(configPath, JSON.stringify(cfg, null, 2))
        },
        enabledOf: (id) => read()['webhook']?.[id]?.['enabled']
    }
}

function connect(rig: Rig): void {
    installNotifyBridge(
        {
            getNotificationsState: () => rig.service.getState(),
            setNotificationEnabled: (id, enabled) => rig.service.setEnabled(id, enabled),
            sendTestNotification: (id) => rig.service.sendTest(id)
        },
        farmerState()
    )
}

const card = (id: NotifyChannelId) => within(screen.getByTestId(`notify-card-${id}`))

async function openPage(): Promise<void> {
    render(<App />)
    await screen.findByTestId('notify-card-discord')
}

afterEach(() => {
    delete window.farmerShell
    while (dirs.length > 0) {
        const d = dirs.pop()
        if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
})

describe('Notifications page with the real service (Phase 17)', () => {
    beforeEach(() => {
        window.location.hash = '#/notifications'
    })

    it('opening the page, reading and refreshing it make NO network request', async () => {
        const rig = makeRig()
        rig.save({ discord: { url: FAKE.discordUrl, enabled: true } })
        connect(rig)
        const user = userEvent.setup()
        await openPage()
        expect(screen.getByTestId('notify-summary')).toHaveTextContent('1 of 4 channels is on: Discord.')
        await user.click(screen.getByRole('button', { name: 'Check again' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled())
        expect(rig.calls).toHaveLength(0)
    })

    it('settings persist: the switch writes the real config.json (and a backup first); the page reads it back', async () => {
        const rig = makeRig()
        rig.save({ discord: { url: FAKE.discordUrl } })
        connect(rig)
        const user = userEvent.setup()
        await openPage()
        const sw = card('discord').getByLabelText(/Send Discord notifications during runs/)
        expect(sw).not.toBeChecked()
        await user.click(sw)
        await waitFor(() => expect(rig.enabledOf('discord')).toBe(true))
        await waitFor(() =>
            expect(screen.getByTestId('notify-summary')).toHaveTextContent('1 of 4 channels is on: Discord.')
        )
        expect(rig.engine.patches).toBe(1)
        expect(readdirSync(rig.backupDir).filter((f) => f.startsWith('config-'))).toHaveLength(1)
        // Persistence: a fresh window (new render) reads the same state from the file.
        document.body.innerHTML = ''
        delete window.farmerShell
        connect(rig)
        render(<App />)
        await screen.findByTestId('notify-card-discord')
        expect(card('discord').getByLabelText(/Send Discord notifications during runs/)).toBeChecked()
        expect(rig.calls).toHaveLength(0)
    })

    it('a channel with nothing saved cannot be switched on or tested; nothing is written and nothing is sent', async () => {
        const rig = makeRig()
        connect(rig)
        await openPage()
        expect(card('telegram').getByLabelText(/Send Telegram notifications during runs/)).toBeDisabled()
        expect(card('telegram').getByRole('button', { name: 'Send test message to Telegram' })).toBeDisabled()
        expect(card('telegram').getByRole('list', { name: 'Telegram problems' })).toHaveTextContent(
            /Telegram bot token is not set/
        )
        expect(rig.engine.patches).toBe(0)
        expect(rig.calls).toHaveLength(0)
    })

    it('the test button sends ONE fixed message and shows the real success', async () => {
        const rig = makeRig()
        rig.save({ discord: { url: FAKE.discordUrl } })
        connect(rig)
        const user = userEvent.setup()
        await openPage()
        await user.click(card('discord').getByRole('button', { name: 'Send test message to Discord' }))
        const result = await screen.findByTestId('notify-result-discord')
        expect(result).toHaveTextContent('Test message sent')
        expect(result).toHaveTextContent(
            'The channel is switched off, so the engine will not use it until you switch it on.'
        )
        expect(rig.calls).toHaveLength(1)
        expect(rig.calls[0]?.url).toBe(FAKE.discordUrl)
        expect(rig.calls[0]?.body).toContain('Rewards Farmer test')
        // Not on the page: the address.
        expect(document.body.textContent ?? '').not.toContain(FAKE.discordUrl)
    })

    it('offline: the real outcome "No internet connection" is shown, and no saved value leaks into the page', async () => {
        const rig = makeRig()
        rig.save({ telegram: { botToken: FAKE.telegramBotToken, chatId: FAKE.telegramChatId } })
        rig.net.answer = () =>
            Promise.reject(
                Object.assign(new TypeError('fetch failed'), {
                    cause: Object.assign(
                        new Error(`getaddrinfo ENOTFOUND api.telegram.org/bot${FAKE.telegramBotToken}`),
                        {
                            code: 'ENOTFOUND'
                        }
                    )
                })
            )
        connect(rig)
        const user = userEvent.setup()
        await openPage()
        await user.click(card('telegram').getByRole('button', { name: 'Send test message to Telegram' }))
        const result = await screen.findByTestId('notify-result-telegram')
        expect(result).toHaveTextContent('No internet connection')
        expect(result).toHaveTextContent('A message was sent to the service.')
        const text = document.body.textContent ?? ''
        for (const v of Object.values(FAKE)) expect(text).not.toContain(v)
    })

    it('a service that refuses (wrong token, HTTP 401) is shown as refused with the HTTP code', async () => {
        const rig = makeRig()
        rig.save({ ntfy: { url: FAKE.ntfyUrl, topic: 'my-topic', token: FAKE.ntfyToken } })
        rig.net.answer = () => Promise.resolve(new Response('no', { status: 401 }))
        connect(rig)
        const user = userEvent.setup()
        await openPage()
        await user.click(card('ntfy').getByRole('button', { name: 'Send test message to ntfy' }))
        const result = await screen.findByTestId('notify-result-ntfy')
        expect(result).toHaveTextContent('The service refused the message')
        expect(result).toHaveTextContent('HTTP 401')
        expect(document.body.textContent ?? '').not.toContain(FAKE.ntfyToken)
    })

    it('misconfiguration: a saved value that is not usable is shown on the card and blocks switch and test', async () => {
        const rig = makeRig()
        rig.save({ discord: { url: 'not-a-web-address', enabled: true } })
        connect(rig)
        await openPage()
        expect(card('discord').getByText('Needs attention')).toBeInTheDocument()
        expect(card('discord').getByRole('list', { name: 'Discord problems' })).toBeInTheDocument()
        expect(card('discord').getByRole('button', { name: 'Send test message to Discord' })).toBeDisabled()
        expect(rig.calls).toHaveLength(0)
    })

    it('a config.json that is not valid: the page shows the service reason, not a channel list', async () => {
        const rig = makeRig()
        writeFileSync(rig.configPath, '{ "webhook": { "discord": ,, } }')
        connect(rig)
        render(<App />)
        const alert = await screen.findByTestId('notify-page-problem')
        expect(alert).toHaveTextContent('config.json is not valid')
        expect(alert).toHaveTextContent(/Repair config\.json/)
        expect(screen.queryByTestId('notify-card-discord')).not.toBeInTheDocument()
        expect(rig.calls).toHaveLength(0)
    })

    it('missing config.json: the page says so', async () => {
        const rig = makeRig()
        rmSync(rig.configPath)
        connect(rig)
        render(<App />)
        const alert = await screen.findByTestId('notify-page-problem')
        expect(alert).toHaveTextContent('config.json is missing')
        expect(alert).toHaveTextContent(/Create config/)
    })
})
