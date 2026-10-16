import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '../../src/shared/farmer-types'
import { CHANNELS, UNSUPPORTED, channelState, readLogFilter } from '../../src/shared/notifications-rules'
import type {
    NotificationsState,
    NotifyChannelId,
    NotifyOutcome,
    NotifyTestResult,
    StateProblem
} from '../../src/shared/notifications-types'
import { App } from '../../src/renderer/App'
import { farmerState, installNotifyBridge } from '../helpers/notifyBridge'
import { FAKE } from '../fixtures/fake-secrets'

// Phase 17: the Notifications page with a stand-in bridge (rule 18). The page against the REAL service (real
// config.json in a temp folder, recording network stand-in) is in notifications.service.test.tsx.

type Config = Record<string, unknown>

const FULL: Record<NotifyChannelId, Record<string, unknown>> = {
    discord: { url: FAKE.discordUrl },
    ntfy: { url: FAKE.ntfyUrl, topic: 'my-topic', token: FAKE.ntfyToken },
    telegram: { botToken: FAKE.telegramBotToken, chatId: FAKE.telegramChatId },
    pushplus: { token: FAKE.pushplusToken }
}

function configWith(hooks: Record<string, Record<string, unknown>>): Config {
    return { webhook: hooks }
}

function stateOf(config: Config): NotificationsState {
    return {
        status: 'ok',
        problem: null,
        logFilter: readLogFilter(config),
        reason: null,
        channels: CHANNELS.map((c) => channelState(config, c.id)),
        unsupported: UNSUPPORTED,
        updatedAt: '2026-10-15T10:00:00.000Z'
    }
}

function problemState(problem: StateProblem, reason: string): NotificationsState {
    return {
        status: problem === 'missing' ? 'unavailable' : 'error',
        problem,
        logFilter: 'unknown',
        reason,
        channels: [],
        unsupported: UNSUPPORTED,
        updatedAt: '2026-10-15T10:00:00.000Z'
    }
}

function testResult(
    id: NotifyChannelId,
    outcome: NotifyOutcome,
    message: string,
    requestMade: boolean
): NotifyTestResult {
    return { ok: outcome === 'sent', message, channel: id, outcome, requestMade }
}

// A bridge whose "config" can change, like the real file does.
function rig(initial: Config, farmer = farmerState()) {
    const store = { config: initial }
    const fns = {
        get: vi.fn(() => Promise.resolve(stateOf(store.config))),
        set: vi.fn((id: NotifyChannelId, enabled: boolean): Promise<ActionResult> => {
            const hooks = (store.config['webhook'] ?? {}) as Record<string, Record<string, unknown>>
            store.config = configWith({ ...hooks, [id]: { ...(hooks[id] ?? {}), enabled } })
            return Promise.resolve({ ok: true, message: `Changed ${id} to ${enabled ? 'on' : 'off'}.` })
        }),
        test: vi.fn((id: NotifyChannelId): Promise<NotifyTestResult> =>
            Promise.resolve(testResult(id, 'sent', `Test message sent to ${id}.`, true))
        )
    }
    installNotifyBridge(
        {
            getNotificationsState: fns.get,
            setNotificationEnabled: fns.set,
            sendTestNotification: fns.test
        },
        farmer
    )
    return { store, fns }
}

const card = (id: NotifyChannelId) => within(screen.getByTestId(`notify-card-${id}`))
const switchOf = (id: NotifyChannelId, label: string) =>
    card(id).getByLabelText(new RegExp(`Send ${label} notifications during runs`))
const testButton = (id: NotifyChannelId, label: string) =>
    card(id).getByRole('button', { name: `Send test message to ${label}` })

async function openPage(): Promise<void> {
    window.location.hash = '#/notifications'
    render(<App />)
    await screen.findByTestId('notify-card-discord')
}

describe('Notifications page (Phase 17)', () => {
    beforeEach(() => {
        window.location.hash = '#/notifications'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron it says so and shows no channel', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
        expect(screen.getByText(/only inside the desktop app/i)).toBeInTheDocument()
        expect(screen.queryByTestId('notify-card-discord')).not.toBeInTheDocument()
    })

    it('has its own sidebar item that opens the page', async () => {
        rig(configWith({}))
        window.location.hash = '#/home'
        const user = userEvent.setup()
        render(<App />)
        const nav = screen.getByRole('navigation', { name: 'Main navigation' })
        await user.click(within(nav).getByRole('button', { name: 'Notifications' }))
        expect(within(nav).getByRole('button', { name: 'Notifications' })).toHaveAttribute(
            'aria-current',
            'page'
        )
        expect(await screen.findByTestId('notify-card-discord')).toBeInTheDocument()
    })

    it('shows the four channels of the service, the summary, and the two channels that are not available', async () => {
        const { fns } = rig(configWith({ discord: { ...FULL.discord, enabled: true } }))
        await openPage()
        expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
            'Discord',
            'ntfy',
            'Telegram',
            'PushPlus',
            'Not available'
        ])
        expect(screen.getByTestId('notify-summary')).toHaveTextContent('1 of 4 channels is on: Discord.')
        expect(screen.getByTestId('notify-unsupported-serverchan')).toHaveTextContent(/ServerChan/)
        expect(screen.getByTestId('notify-unsupported-clawbot')).toHaveTextContent(/QR-code login/)
        // Opening the page only READS. It never switches or tests anything.
        expect(fns.set).not.toHaveBeenCalled()
        expect(fns.test).not.toHaveBeenCalled()
    })

    it('says what the engine really sends: every non-debug line when no log filter is on, only matches when it is on', async () => {
        rig(configWith({}))
        await openPage()
        expect(screen.getByTestId('notify-log-filter')).toHaveTextContent(/EVERY log line except debug/)
        expect(screen.getByTestId('notify-log-filter')).toHaveTextContent(/e-mail addresses/)
        expect(document.body.textContent ?? '').not.toMatch(/warnings and errors by default/)
        document.body.innerHTML = ''
        delete window.farmerShell
        rig({ webhook: { webhookLogFilter: { enabled: true } } })
        render(<App />)
        await screen.findByTestId('notify-card-discord')
        expect(screen.getByTestId('notify-log-filter')).toHaveTextContent(/only the lines that match it/)
    })

    it('each card says its state in words', async () => {
        rig(
            configWith({
                discord: { ...FULL.discord, enabled: true },
                ntfy: { ...FULL.ntfy, enabled: false },
                telegram: { botToken: FAKE.telegramBotToken }
            })
        )
        await openPage()
        expect(card('discord').getByText('On')).toBeInTheDocument()
        expect(card('ntfy').getByText('Off - ready to switch on')).toBeInTheDocument()
        expect(card('telegram').getByText('Needs attention')).toBeInTheDocument()
        expect(card('telegram').getByRole('list', { name: 'Telegram problems' })).toHaveTextContent(
            /chat ID is not set/
        )
        expect(card('pushplus').getByText('Not set up')).toBeInTheDocument()
    })

    it('a channel that is not set up: switch and test are disabled and say why; clicking does nothing', async () => {
        const { fns } = rig(configWith({}))
        await openPage()
        expect(switchOf('pushplus', 'PushPlus')).toBeDisabled()
        expect(
            card('pushplus').getByText(/PushPlus token is not set/, { selector: 'span' })
        ).toBeInTheDocument()
        const t = testButton('pushplus', 'PushPlus')
        expect(t).toBeDisabled()
        // A disabled control has pointer-events: none, so a person cannot click it. fireEvent sends the click anyway,
        // the worst case: nothing may reach the service.
        fireEvent.click(t)
        fireEvent.click(switchOf('pushplus', 'PushPlus'))
        expect(fns.test).not.toHaveBeenCalled()
        expect(fns.set).not.toHaveBeenCalled()
    })

    it('the switch is saved at once; the page reads the saved state back and shows it', async () => {
        const { fns, store } = rig(configWith({ discord: FULL.discord }))
        const user = userEvent.setup()
        await openPage()
        expect(screen.getByTestId('notify-summary')).toHaveTextContent('No channel is on.')
        const readsBefore = fns.get.mock.calls.length
        await user.click(switchOf('discord', 'Discord'))
        await waitFor(() => expect(fns.set).toHaveBeenCalledWith('discord', true))
        expect(fns.set).toHaveBeenCalledTimes(1)
        expect(await screen.findByText('Changed discord to on.')).toBeInTheDocument()
        await waitFor(() =>
            expect(screen.getByTestId('notify-summary')).toHaveTextContent('1 of 4 channels is on: Discord.')
        )
        expect(fns.get.mock.calls.length).toBeGreaterThan(readsBefore)
        expect(switchOf('discord', 'Discord')).toBeChecked()
        expect(JSON.stringify(store.config)).toContain('"enabled":true')
        // And off again.
        await user.click(switchOf('discord', 'Discord'))
        await waitFor(() => expect(fns.set).toHaveBeenLastCalledWith('discord', false))
        await waitFor(() => expect(switchOf('discord', 'Discord')).not.toBeChecked())
    })

    it('a refused switch shows the exact reason and does not pretend it changed', async () => {
        const { fns } = rig(configWith({ discord: FULL.discord }))
        fns.set.mockResolvedValueOnce({
            ok: false,
            code: 'WRITE_DISABLED',
            message: 'Config writes are switched off in the engine.'
        })
        const user = userEvent.setup()
        await openPage()
        await user.click(switchOf('discord', 'Discord'))
        expect(await screen.findByText('Config writes are switched off in the engine.')).toBeInTheDocument()
        await waitFor(() => expect(switchOf('discord', 'Discord')).not.toBeChecked())
    })

    it('a switch whose call throws shows a message and keeps the old state', async () => {
        const { fns } = rig(configWith({ discord: FULL.discord }))
        fns.set.mockRejectedValueOnce(new Error('bridge gone'))
        const user = userEvent.setup()
        await openPage()
        await user.click(switchOf('discord', 'Discord'))
        expect(await screen.findByText(/The switch was not saved \(bridge gone\)/)).toBeInTheDocument()
        expect(switchOf('discord', 'Discord')).not.toBeChecked()
    })

    it('engine not ready: the switch is disabled with the reason, but a test is still allowed', async () => {
        rig(configWith({ discord: FULL.discord }), farmerState({ link: 'down' }))
        await openPage()
        await waitFor(() => expect(switchOf('discord', 'Discord')).toBeDisabled())
        expect(card('discord').getByText(/The engine is not ready/, { selector: 'span' })).toBeInTheDocument()
        expect(testButton('discord', 'Discord')).toBeEnabled()
    })

    it('a run in progress: the switch is disabled with the reason', async () => {
        rig(configWith({ discord: { ...FULL.discord, enabled: true } }), farmerState({ phase: 'running' }))
        await openPage()
        await waitFor(() => expect(switchOf('discord', 'Discord')).toBeDisabled())
        expect(card('discord').getByText(/A run is active/, { selector: 'span' })).toBeInTheDocument()
    })

    it('the test button reports the real result and keeps it on screen', async () => {
        const { fns } = rig(configWith({ discord: FULL.discord }))
        const user = userEvent.setup()
        await openPage()
        expect(screen.queryByTestId('notify-result-discord')).not.toBeInTheDocument()
        await user.click(testButton('discord', 'Discord'))
        await waitFor(() => expect(fns.test).toHaveBeenCalledWith('discord'))
        expect(fns.test).toHaveBeenCalledTimes(1)
        const result = await screen.findByTestId('notify-result-discord')
        expect(result).toHaveTextContent('Test message sent')
        expect(result).toHaveTextContent('Test message sent to discord.')
        expect(result).toHaveTextContent('A message was sent to the service.')
        expect(result).toHaveAttribute('role', 'status')
        // Only that channel got a result.
        expect(screen.queryByTestId('notify-result-ntfy')).not.toBeInTheDocument()
    })

    it.each<[NotifyOutcome, boolean, string, RegExp]>([
        [
            'permission-denied',
            false,
            'Windows did not let the app read config.json (permission denied).',
            /Windows blocked access - nothing was sent/
        ],
        [
            'misconfigured',
            false,
            'Discord webhook URL: is not a valid address.',
            /Setup problem - nothing was sent/
        ],
        ['not-configured', false, 'Discord is not set up.', /Not set up - nothing was sent/],
        [
            'offline',
            true,
            'No internet connection, or the address of Discord could not be found.',
            /No internet connection/
        ],
        ['unreachable', true, 'Discord could not be reached (ECONNREFUSED).', /Could not connect/],
        ['timeout', true, 'Discord did not answer within 10 seconds.', /No answer in time/],
        [
            'rejected',
            true,
            'Discord says this address does not exist (HTTP 404).',
            /The service refused the message/
        ],
        [
            'too-soon',
            false,
            'A test for Discord was just sent. Wait a few seconds and try again.',
            /Too soon - nothing was sent/
        ],
        ['failed', true, 'The message to Discord could not be sent.', /The message could not be sent/]
    ])(
        'failure "%s" is shown with its exact text and the honest request line',
        async (outcome, requestMade, message, title) => {
            const { fns } = rig(configWith({ discord: FULL.discord }))
            fns.test.mockResolvedValueOnce(testResult('discord', outcome, message, requestMade))
            const user = userEvent.setup()
            await openPage()
            await user.click(testButton('discord', 'Discord'))
            const result = await screen.findByTestId('notify-result-discord')
            expect(result).toHaveTextContent(title)
            expect(result).toHaveTextContent(message)
            expect(result).toHaveTextContent(
                requestMade ? 'A message was sent to the service.' : 'No request was sent to any service.'
            )
            // A problem uses the alert role (read out at once), not the status role.
            expect(result).toHaveAttribute('role', 'alert')
        }
    )

    it('a test whose call throws says the result is unknown and does not claim nothing was sent', async () => {
        const { fns } = rig(configWith({ discord: FULL.discord }))
        fns.test.mockRejectedValueOnce(new Error('ipc closed'))
        const user = userEvent.setup()
        await openPage()
        await user.click(testButton('discord', 'Discord'))
        const result = await screen.findByTestId('notify-result-discord')
        expect(result).toHaveTextContent('The test could not be run')
        expect(result).toHaveTextContent('ipc closed')
        expect(result).toHaveTextContent('not known whether a message was sent')
    })

    it('a test that is still going out cannot be started a second time', async () => {
        const { fns } = rig(configWith({ discord: FULL.discord }))
        let release: (r: NotifyTestResult) => void = () => undefined
        fns.test.mockImplementationOnce(
            () =>
                new Promise<NotifyTestResult>((resolve) => {
                    release = resolve
                })
        )
        const user = userEvent.setup()
        await openPage()
        await user.click(testButton('discord', 'Discord'))
        const busy = await screen.findByRole('button', { name: 'Send test message to Discord' })
        expect(busy).toBeDisabled()
        expect(busy).toHaveTextContent('Sending...')
        expect(busy).toHaveAttribute('aria-busy', 'true')
        fireEvent.click(busy)
        // The switch of the same channel is locked too while it works.
        expect(switchOf('discord', 'Discord')).toBeDisabled()
        expect(fns.test).toHaveBeenCalledTimes(1)
        await act(async () => {
            release(testResult('discord', 'sent', 'Test message sent to Discord.', true))
            await Promise.resolve()
        })
        await screen.findByTestId('notify-result-discord')
        await waitFor(() => expect(testButton('discord', 'Discord')).toBeEnabled())
    })

    it.each<[StateProblem, string, RegExp]>([
        ['missing', 'config.json is missing. Use "Create config" on Home first.', /config\.json is missing/],
        [
            'permission',
            'Windows did not let the app read config.json (permission denied). Right-click the engine folder.',
            /Windows blocked access to config\.json/
        ],
        [
            'invalid',
            'config.json is not valid. Use "Repair config.json" on the Health page.',
            /config\.json is not valid/
        ],
        ['unreadable', 'config.json could not be read.', /config\.json could not be read/]
    ])(
        'state "%s": a clear page message with the service text, no channel card, and Check again reads again',
        async (problem, reason, title) => {
            const fns = { get: vi.fn(() => Promise.resolve(problemState(problem, reason))) }
            installNotifyBridge({
                getNotificationsState: fns.get,
                setNotificationEnabled: () => Promise.reject(new Error('not used')),
                sendTestNotification: () => Promise.reject(new Error('not used'))
            })
            const user = userEvent.setup()
            render(<App />)
            const alert = await screen.findByTestId('notify-page-problem')
            expect(alert).toHaveTextContent(title)
            expect(alert).toHaveTextContent(reason)
            expect(screen.queryByTestId('notify-card-discord')).not.toBeInTheDocument()
            // The two channels the engine cannot deliver stay listed.
            expect(screen.getByTestId('notify-unsupported-serverchan')).toBeInTheDocument()
            const before = fns.get.mock.calls.length
            await user.click(within(alert).getByRole('button', { name: 'Check again' }))
            await waitFor(() => expect(fns.get.mock.calls.length).toBeGreaterThan(before))
        }
    )

    it('when the state cannot be read at all it shows the error and a Try again button', async () => {
        // The page reads once when it opens and again when the app state arrives, so the failure has to last until the
        // person presses the button.
        const answer = { broken: true }
        const get = vi.fn(() =>
            answer.broken
                ? Promise.reject(new Error('main is busy'))
                : Promise.resolve(stateOf(configWith({})))
        )
        installNotifyBridge({
            getNotificationsState: get,
            setNotificationEnabled: () => Promise.reject(new Error('not used')),
            sendTestNotification: () => Promise.reject(new Error('not used'))
        })
        const user = userEvent.setup()
        render(<App />)
        expect(await screen.findByText('The notification settings could not be read.')).toBeInTheDocument()
        expect(screen.getByText('main is busy')).toBeInTheDocument()
        answer.broken = false
        await user.click(screen.getByRole('button', { name: 'Try again' }))
        expect(await screen.findByTestId('notify-card-discord')).toBeInTheDocument()
    })

    it('offline: a hint appears when the window goes offline and disappears when it is back; a test is not blocked', async () => {
        rig(configWith({ discord: FULL.discord }))
        await openPage()
        expect(screen.queryByTestId('notify-offline')).not.toBeInTheDocument()
        act(() => {
            window.dispatchEvent(new Event('offline'))
        })
        expect(await screen.findByTestId('notify-offline')).toHaveTextContent(/looks offline/)
        expect(testButton('discord', 'Discord')).toBeEnabled()
        act(() => {
            window.dispatchEvent(new Event('online'))
        })
        await waitFor(() => expect(screen.queryByTestId('notify-offline')).not.toBeInTheDocument())
    })

    it('channels the engine cannot deliver have a disabled switch with the reason and never call the service', async () => {
        const { fns } = rig(configWith({}))
        await openPage()
        for (const [id, label, short] of [
            ['serverchan', 'ServerChan', /the engine ignores this setting/],
            ['clawbot', 'WeChat ClawBot', /needs a QR login on your phone/]
        ] as const) {
            const row = within(screen.getByTestId(`notify-unsupported-${id}`))
            const sw = row.getByLabelText(new RegExp(`Send ${label} notifications`))
            expect(sw).toBeDisabled()
            expect(sw).not.toBeChecked()
            expect(row.getByText(short, { selector: 'span' })).toBeInTheDocument()
            fireEvent.click(sw)
        }
        expect(fns.set).not.toHaveBeenCalled()
    })

    it('links to the Secrets page, where the addresses and tokens are saved', async () => {
        rig(configWith({}))
        await openPage()
        expect(screen.getByRole('link', { name: /Open Secrets & API keys/ })).toHaveAttribute(
            'href',
            '#/secrets'
        )
    })

    it('no saved address, token or chat ID is ever on the page, and the page text promises only a test on request', async () => {
        const { fns } = rig(
            configWith({
                discord: { ...FULL.discord, enabled: true },
                ntfy: { ...FULL.ntfy, enabled: true },
                telegram: { ...FULL.telegram, enabled: true },
                pushplus: { ...FULL.pushplus, enabled: true }
            })
        )
        const user = userEvent.setup()
        await openPage()
        await user.click(testButton('telegram', 'Telegram'))
        await screen.findByTestId('notify-result-telegram')
        const text = document.body.textContent ?? ''
        for (const v of Object.values(FAKE)) expect(text).not.toContain(v)
        expect(text).toMatch(/A message goes out only when you press "Send test message"/)
        expect(fns.test).toHaveBeenCalledTimes(1)
    })

    it('the page can be used with the keyboard: switch and button are reachable and work with Space / Enter', async () => {
        const { fns } = rig(configWith({ discord: FULL.discord }))
        const user = userEvent.setup()
        await openPage()
        switchOf('discord', 'Discord').focus()
        await user.keyboard(' ')
        await waitFor(() => expect(fns.set).toHaveBeenCalledWith('discord', true))
        await waitFor(() => expect(testButton('discord', 'Discord')).toBeEnabled())
        testButton('discord', 'Discord').focus()
        await user.keyboard('{Enter}')
        await waitFor(() => expect(fns.test).toHaveBeenCalledWith('discord'))
    })
})
