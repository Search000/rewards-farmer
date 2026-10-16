import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineSettingsState } from '../../src/shared/engine-settings-types'
import type { ActionResult, FarmerState } from '../../src/shared/farmer-types'
import type { FarmerShellApi } from '../../src/shared/ipc-types'
import { SECRET_FIELDS } from '../../src/shared/secrets-rules'
import type { SecretsState } from '../../src/shared/secrets-types'
import { App } from '../../src/renderer/App'
import { FAKE } from '../fixtures/fake-secrets'

// Stand-in for the preload bridge (rule 18). The real engine, files and logs are covered by
// tests/main/secrets.integration.test.ts.

function farmerState(): FarmerState {
    return {
        engine: { link: 'ready', detail: null, version: '4.3.2.4' },
        accounts: { path: null, status: 'not-set', error: null, count: null },
        run: { phase: 'idle', startedAt: null, lastExit: null },
        current: { account: null, points: null, section: null, detail: null, proxy: null },
        summary: { all: null, finished: null, failed: null },
        timer: { enabled: false, time: '00:00', nextFireAt: null },
        startDisabledReason: null,
        stopDisabledReason: 'No run in progress.',
        notices: [],
        updatedAt: '2026-10-11T10:00:00.000Z'
    }
}

const unavailableSettings: EngineSettingsState = {
    status: 'unavailable',
    reason: 'not needed here',
    values: null,
    defaults: null,
    missingKeys: [],
    editDisabledReason: 'x',
    lastBackupAt: null,
    updatedAt: '2026-10-11T10:00:00.000Z'
}

function secretsState(over: Partial<SecretsState> = {}, setIds: readonly string[] = []): SecretsState {
    return {
        status: 'ok',
        reason: null,
        fields: SECRET_FIELDS.map((f) => ({
            id: f.id,
            label: f.label,
            group: f.group,
            help: f.help,
            isSet: setIds.includes(f.id)
        })),
        editDisabledReason: null,
        updatedAt: '2026-10-11T10:00:00.000Z',
        ...over
    }
}

function installBridge(initial: SecretsState, setResult: ActionResult = { ok: true, message: 'Saved.' }) {
    const fns = {
        get: vi.fn(() => Promise.resolve(initial)),
        set: vi.fn(() => Promise.resolve(setResult)),
        clear: vi.fn(() => Promise.resolve({ ok: true, message: 'Cleared.' } as ActionResult))
    }
    const no = () => Promise.reject(new Error('not used'))
    const api: FarmerShellApi = {
        getAppInfo: no,
        getFarmerState: () => Promise.resolve(farmerState()),
        pickAccountsFile: no,
        startRun: no,
        stopRun: no,
        createEngineConfig: no,
        repairEngineConfig: no,
        restartEngine: no,
        setTimer: no,
        onFarmerState: () => () => undefined,
        getSettings: () =>
            Promise.resolve({
                schemaVersion: 2,
                themeMode: 'dark',
                accountsPath: null,
                timerEnabled: false,
                timerTime: '00:00',
                shutdownAfterRun: false
            }),
        setThemeMode: () => Promise.resolve(),
        getAccountsState: no,
        addAccount: no,
        updateAccount: no,
        removeAccount: no,
        getEngineSettingsState: () => Promise.resolve(unavailableSettings),
        saveEngineSettings: no,
        resetEngineSettings: no,
        getNotificationsState: no,
        setNotificationEnabled: no,
        sendTestNotification: no,
        getLogsState: () => Promise.reject(new Error('not used')),
        runHealthChecks: () => Promise.reject(new Error('not used')),
        exportDiagnostics: () => Promise.reject(new Error('not used')),
        getBackupsState: () => Promise.reject(new Error('not used')),
        createBackup: () => Promise.reject(new Error('not used')),
        inspectBackup: () => Promise.reject(new Error('not used')),
        openBackupFolder: () => Promise.reject(new Error('not used')),
        previewRestore: () => Promise.reject(new Error('not used')),
        prepareRestore: () => Promise.reject(new Error('not used')),
        applyRestore: () => Promise.reject(new Error('not used')),
        undoRestore: () => Promise.reject(new Error('not used')),
        // Phase 22: the setup wizard calls. Not the first start by default; no page here uses the rest.
        wizardIsFirstRun: () => Promise.resolve(false),
        wizardGetState: () => Promise.reject(new Error('not used')),
        wizardReset: () => Promise.reject(new Error('not used')),
        wizardCheckPrerequisites: () => Promise.reject(new Error('not used')),
        wizardChooseAccounts: () => Promise.reject(new Error('not used')),
        wizardSetSettings: () => Promise.reject(new Error('not used')),
        wizardReview: () => Promise.reject(new Error('not used')),
        wizardFinish: () => Promise.reject(new Error('not used')),
        getRestoreHistory: () => Promise.reject(new Error('not used')),
        refreshLogs: () => Promise.reject(new Error('not used')),
        exportLogs: () => Promise.reject(new Error('not used')),
        setShutdownAfterRun: no,
        getSecretsState: fns.get,
        setSecret: fns.set,
        clearSecret: fns.clear
    }
    window.farmerShell = api
    return fns
}

const group = (name: string) => screen.getByRole('group', { name })
// The row (role group) and its input share the label text, so the input is looked up inside its row.
const field = (name: string) => within(group(name)).getByLabelText(name)
const findField = async (name: string) => {
    await screen.findByRole('group', { name })
    return field(name)
}

describe('Secrets card (Phase 10 renderer)', () => {
    beforeEach(() => {
        window.location.hash = '#/secrets'
    })
    afterEach(() => {
        delete window.farmerShell
    })

    it('outside Electron the page says so and shows no field', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Secrets & API keys' })).toBeInTheDocument()
        expect(screen.getByText(/only inside the desktop app/i)).toBeInTheDocument()
        expect(screen.queryByRole('group', { name: 'Telegram bot token' })).not.toBeInTheDocument()
    })

    it('is its own page: Discord and Telegram come first, each group has a heading, Settings has no secret fields', async () => {
        installBridge(secretsState())
        render(<App />)
        await findField('Discord webhook URL')
        const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
        expect(headings).toEqual([
            'Discord',
            'Telegram',
            'ntfy',
            'PushPlus',
            'ServerChan',
            'China search API'
        ])
        // The Telegram fields sit inside the Telegram section, the Discord field inside the Discord section.
        const telegram = screen.getByRole('region', { name: 'Telegram' })
        expect(within(telegram).getByRole('group', { name: 'Telegram bot token' })).toBeInTheDocument()
        expect(within(telegram).getByRole('group', { name: 'Telegram chat ID' })).toBeInTheDocument()
        expect(
            within(screen.getByRole('region', { name: 'Discord' })).getByRole('group', {
                name: 'Discord webhook URL'
            })
        ).toBeInTheDocument()
        // Not in the sidebar as separate tabs any more.
        const nav = screen.getByRole('navigation', { name: 'Main navigation' })
        expect(within(nav).queryByRole('button', { name: 'Telegram' })).not.toBeInTheDocument()
        expect(within(nav).queryByRole('button', { name: 'Discord' })).not.toBeInTheDocument()
        expect(within(nav).getByRole('button', { name: 'Secrets & API keys' })).toHaveAttribute(
            'aria-current',
            'page'
        )
    })

    it('the Settings page no longer carries the secret fields', async () => {
        window.location.hash = '#/settings'
        installBridge(secretsState())
        render(<App />)
        await screen.findByRole('heading', { level: 1, name: 'Settings' })
        expect(screen.queryByRole('group', { name: 'Telegram bot token' })).not.toBeInTheDocument()
        expect(screen.queryByText('Secrets & API keys', { selector: 'h2' })).not.toBeInTheDocument()
    })

    it('lists every field as masked input with Saved / Not set, and never shows a saved value', async () => {
        installBridge(secretsState({}, ['telegramBotToken', 'pushplusToken']))
        render(<App />)
        const bot = await findField('Telegram bot token')
        expect(bot).toHaveAttribute('type', 'password')
        expect(bot).toHaveValue('')
        expect(within(group('Telegram bot token')).getByText('Saved')).toBeInTheDocument()
        expect(within(group('Discord webhook URL')).getByText('Not set')).toBeInTheDocument()
        expect(document.body.textContent).not.toContain(FAKE.telegramBotToken)
        for (const f of SECRET_FIELDS) expect(field(f.label)).toHaveAttribute('type', 'password')
        expect(screen.queryByRole('button', { name: /reveal|show|copy/i })).not.toBeInTheDocument()
    })

    it('Save is disabled until something is typed, then sends exactly the id and the typed value and clears the field', async () => {
        const fns = installBridge(secretsState())
        const user = userEvent.setup()
        render(<App />)
        const field = await findField('Telegram bot token')
        expect(screen.getByRole('button', { name: 'Save Telegram bot token' })).toBeDisabled()
        await user.type(field, FAKE.telegramBotToken)
        // Looked up again: the button is a new element once it is enabled.
        await user.click(screen.getByRole('button', { name: 'Save Telegram bot token' }))
        await waitFor(() => expect(fns.set).toHaveBeenCalledTimes(1))
        expect(fns.set).toHaveBeenCalledWith('telegramBotToken', FAKE.telegramBotToken)
        await waitFor(() => expect(field).toHaveValue(''))
    })

    it('an invalid value is refused on screen, without calling the bridge, and the message does not repeat the value', async () => {
        const fns = installBridge(secretsState())
        const user = userEvent.setup()
        render(<App />)
        const field = await findField('Telegram bot token')
        await user.type(field, 'definitely-not-a-token')
        await user.click(screen.getByRole('button', { name: 'Save Telegram bot token' }))
        expect(await screen.findByText(/does not look like a Telegram bot token/i)).toBeInTheDocument()
        expect(fns.set).not.toHaveBeenCalled()
        expect(document.body.textContent).not.toContain('definitely-not-a-token')
    })

    it('a refusal from the main process is shown and the typed value stays so it can be fixed', async () => {
        installBridge(secretsState(), {
            ok: false,
            code: 'WRITE_FAILED',
            message: 'Could not make a backup copy (EACCES).'
        })
        const user = userEvent.setup()
        render(<App />)
        const field = await findField('ntfy access token')
        await user.type(field, FAKE.ntfyToken)
        await user.click(screen.getByRole('button', { name: 'Save ntfy access token' }))
        expect(await screen.findByText(/Could not make a backup copy/)).toBeInTheDocument()
        expect(field).toHaveValue(FAKE.ntfyToken)
    })

    it('Clear is disabled when nothing is saved; when saved it asks first and only then calls the bridge', async () => {
        const fns = installBridge(secretsState({}, ['discordUrl']))
        const user = userEvent.setup()
        render(<App />)
        await findField('Discord webhook URL')
        expect(screen.getByRole('button', { name: 'Clear ntfy access token' })).toBeDisabled()
        await user.click(screen.getByRole('button', { name: 'Clear Discord webhook URL' }))
        expect(fns.clear).not.toHaveBeenCalled()
        await user.click(await screen.findByRole('button', { name: 'Clear' }))
        await waitFor(() => expect(fns.clear).toHaveBeenCalledWith('discordUrl'))
    })

    it('while a run is active everything is disabled and the reason is shown', async () => {
        installBridge(secretsState({ editDisabledReason: 'A run is active.' }, ['discordUrl']))
        render(<App />)
        expect(await screen.findByText(/Secrets are read-only now: A run is active\./)).toBeInTheDocument()
        expect(field('Telegram bot token')).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Clear Discord webhook URL' })).toBeDisabled()
    })

    it('when the engine is not ready it says why and shows no fields', async () => {
        installBridge(
            secretsState({
                status: 'unavailable',
                reason: 'The engine is not running, so the saved secrets cannot be checked.',
                fields: [],
                editDisabledReason: 'The engine is not ready.'
            })
        )
        render(<App />)
        expect(await screen.findByText(/saved secrets cannot be checked/i)).toBeInTheDocument()
        expect(screen.queryByRole('group', { name: 'Telegram bot token' })).not.toBeInTheDocument()
    })
})
