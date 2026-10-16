import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupService } from '../../src/main/backupService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import type {
    BackupCreateResult,
    BackupDetail,
    BackupInspectResult,
    BackupListResult,
    BackupSummary,
    BackupVerification
} from '../../src/shared/backup-types'
import { App } from '../../src/renderer/App'
import { FAKE } from '../fixtures/fake-secrets'
import { installBridge } from '../helpers/notifyBridge'

// Phase 19: the Backups page. First with a stand-in bridge (rule 18), then against the REAL BackupService on real files in a
// temp folder (the same service the app uses). Everything secret in here is FAKE.

const T = '2026-10-15T10:00:00.000Z'
const ID = 'backup-20261015-100000-123'
const ok: VerificationLike = { status: 'ok', checkedAt: T, filesChecked: 3, problems: [], notes: [] }
type VerificationLike = BackupVerification
const bad: VerificationLike = {
    status: 'failed',
    checkedAt: T,
    filesChecked: 3,
    problems: [
        {
            kind: 'file-missing',
            file: 'accounts.env',
            text: 'Accounts file (accounts.env) is missing from the backup.'
        }
    ],
    notes: []
}
const summary = (id: string, v: VerificationLike = ok): BackupSummary => ({
    id,
    createdAt: T,
    appVersion: '0.0.1',
    fileCount: 3,
    totalBytes: 2048,
    skipped: [],
    verification: v
})
const list = (backups: BackupSummary[], over: Partial<BackupListResult> = {}): BackupListResult => ({
    ok: true,
    message: null,
    backups,
    unfinishedCount: 0,
    ...over
})
const detail = (v: VerificationLike = ok): BackupDetail => ({
    id: ID,
    createdAt: T,
    appVersion: '0.0.1',
    platform: 'win32',
    totalBytes: 2048,
    accountCount: 2,
    files: [
        {
            role: 'engine-config',
            name: 'engine-config.json',
            sizeBytes: 500,
            sha256: 'ab'.repeat(32),
            containsSecrets: true
        },
        {
            role: 'accounts',
            name: 'accounts.env',
            sizeBytes: 1000,
            sha256: 'cd'.repeat(32),
            containsSecrets: true
        },
        {
            role: 'app-settings',
            name: 'app-settings.json',
            sizeBytes: 548,
            sha256: 'ef'.repeat(32),
            containsSecrets: false
        }
    ],
    skipped: [],
    verification: v
})

function openPage(): void {
    window.location.hash = '#/backups'
    render(<App />)
}

beforeEach(() => {
    window.location.hash = '#/backups'
})
afterEach(() => {
    delete window.farmerShell
})

describe('Backups page (stand-in bridge)', () => {
    it('outside the desktop app it says so and offers no button', () => {
        render(<App />)
        expect(screen.getByRole('heading', { level: 1, name: 'Backups' })).toBeInTheDocument()
        expect(screen.getByText(/work only inside the desktop app/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Create backup' })).not.toBeInTheDocument()
    })

    it('shows what a backup holds, the security warning and the list with a status per backup', async () => {
        installBridge({
            getBackupsState: () =>
                Promise.resolve(list([summary(ID), summary('backup-20261014-090000-001', bad)]))
        })
        openPage()
        expect(await screen.findByTestId(`backup-row-${ID}`)).toBeInTheDocument()
        expect(screen.getByTestId('backup-security-note')).toHaveTextContent(/NOT encrypted/)
        expect(screen.getByText(/Browser sessions and logs are not part of a backup/)).toBeInTheDocument()
        expect(screen.getByTestId(`backup-status-${ID}`)).toHaveTextContent('Checked: OK')
        expect(screen.getByTestId('backup-status-backup-20261014-090000-001')).toHaveTextContent(
            'Damaged: do not use'
        )
        expect(screen.getByTestId('backup-summary')).toHaveTextContent(
            '2 backups. 1 failed the check and must not be used.'
        )
        const row = screen.getByTestId(`backup-row-${ID}`)
        expect(row).toHaveTextContent('App version 0.0.1, 3 file(s), 2.0 KB')
    })

    it('an empty list says so and does not offer to open a folder that does not exist', async () => {
        installBridge({ getBackupsState: () => Promise.resolve(list([])) })
        openPage()
        expect(await screen.findByText('No backups yet.')).toBeInTheDocument()
        expect(screen.getByTestId('backup-summary')).toHaveTextContent('There is no backup yet.')
        expect(screen.getByRole('button', { name: 'Open backup folder' })).toBeDisabled()
    })

    it('unfinished leftovers are counted, never listed as a backup', async () => {
        installBridge({ getBackupsState: () => Promise.resolve(list([summary(ID)], { unfinishedCount: 2 })) })
        openPage()
        expect(await screen.findByTestId('backup-unfinished')).toHaveTextContent(
            /2 unfinished or set-aside item/
        )
        expect(screen.getAllByTestId(/^backup-row-/)).toHaveLength(1)
    })

    it('Create backup runs the real call once, shows the result and reads the list again', async () => {
        const user = userEvent.setup()
        let release: (r: BackupCreateResult) => void = () => undefined
        const create = vi.fn(() => new Promise<BackupCreateResult>((res) => (release = res)))
        const get = vi.fn(() => Promise.resolve(list([])))
        installBridge({ getBackupsState: get, createBackup: create })
        openPage()
        const button = await screen.findByRole('button', { name: 'Create backup' })
        await user.click(button)
        // While it runs: busy, and a second click does nothing.
        const busy = await screen.findByRole('button', { name: 'Creating and checking...' })
        expect(busy).toBeDisabled()
        fireEvent.click(busy)
        expect(create).toHaveBeenCalledTimes(1)
        release({
            ok: true,
            message: `Backup ${ID} created and checked: 3 file(s), 2.0 KB, every checksum matches.`,
            backup: summary(ID),
            notes: []
        })
        const result = await screen.findByTestId('backup-result')
        expect(result).toHaveTextContent('Backup created')
        expect(result).toHaveTextContent('every checksum matches')
        expect(screen.queryByTestId('backup-fix')).not.toBeInTheDocument()
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    })

    it.each([
        [
            'low disk',
            'low-space',
            'There is not enough free disk space for a backup (about 1.0 MB are needed, 10 bytes are free). No backup was created.',
            'Free some space'
        ],
        [
            'permission denied',
            'permission-denied',
            'The backup could not be written (permission denied). No backup was created.',
            'Health page'
        ],
        [
            'missing file',
            'nothing-to-back-up',
            'There is nothing to back up yet. Accounts file does not exist yet.',
            'Home page'
        ]
    ] as const)(
        'a failed backup (%s) stays on screen with the exact reason and a "What to do"',
        async (_n, reason, message, fixWord) => {
            const user = userEvent.setup()
            installBridge({
                getBackupsState: () => Promise.resolve(list([])),
                createBackup: () =>
                    Promise.resolve({
                        ok: false,
                        code: 'WRITE_FAILED',
                        message,
                        reason,
                        fix: `Do this first: ${fixWord} then press Create backup again.`
                    })
            })
            openPage()
            await user.click(await screen.findByRole('button', { name: 'Create backup' }))
            const result = await screen.findByTestId('backup-result')
            expect(result).toHaveAttribute('role', 'alert')
            expect(result).toHaveTextContent('No backup was created')
            expect(result).toHaveTextContent(message)
            expect(screen.getByTestId('backup-fix')).toHaveTextContent(
                `What to do: Do this first: ${fixWord}`
            )
        }
    )

    it('if the bridge itself fails, the page still says no backup was created and what to do', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list([])),
            createBackup: () => Promise.reject(new Error('channel closed'))
        })
        openPage()
        await user.click(await screen.findByRole('button', { name: 'Create backup' }))
        const result = await screen.findByTestId('backup-result')
        expect(result).toHaveTextContent('channel closed')
        expect(result).toHaveTextContent('No backup was created')
        expect(screen.getByTestId('backup-fix')).toHaveTextContent('START.bat')
    })

    it('Inspect shows the facts, the files, the secrets flag and the check; Check again checks once more', async () => {
        const user = userEvent.setup()
        const inspect = vi.fn((): Promise<BackupInspectResult> =>
            Promise.resolve({ ok: true, detail: detail() })
        )
        installBridge({ getBackupsState: () => Promise.resolve(list([summary(ID)])), inspectBackup: inspect })
        openPage()
        await user.click(await screen.findByRole('button', { name: /^Inspect backup from/ }))
        const box = await screen.findByTestId('backup-detail')
        expect(inspect).toHaveBeenCalledWith(ID)
        expect(box).toHaveTextContent(ID)
        expect(box).toHaveTextContent('by app version 0.0.1 (win32)')
        expect(box).toHaveTextContent('2 account(s) in the saved accounts file')
        expect(screen.getByTestId('backup-detail-check')).toHaveTextContent('Checked: OK')
        expect(screen.getByTestId('backup-detail-check')).toHaveTextContent('All 3 file(s) are present')
        const accounts = screen.getByTestId('backup-file-accounts')
        expect(accounts).toHaveTextContent('Accounts file')
        expect(accounts).toHaveTextContent('accounts.env, 1000 bytes, SHA-256 cdcdcdcdcdcd…')
        expect(within(accounts).getByText('Holds secrets')).toBeInTheDocument()
        expect(
            within(screen.getByTestId('backup-file-app-settings')).queryByText('Holds secrets')
        ).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Check again' }))
        await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2))
        await user.click(screen.getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(screen.queryByTestId('backup-detail')).not.toBeInTheDocument())
    })

    it('Inspect of a damaged backup lists each problem and says not to restore from it', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list([summary(ID, bad)])),
            inspectBackup: () => Promise.resolve({ ok: true, detail: detail(bad) })
        })
        openPage()
        await user.click(await screen.findByRole('button', { name: /^Inspect backup from/ }))
        const check = await screen.findByTestId('backup-detail-check')
        expect(check).toHaveTextContent('Damaged: do not use')
        expect(check).toHaveTextContent('Do not use it to restore')
        expect(check).toHaveTextContent('Accounts file (accounts.env) is missing from the backup.')
    })

    it('Inspect that fails shows the reason (for example the backup is gone)', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list([summary(ID)])),
            inspectBackup: () =>
                Promise.resolve({
                    ok: false,
                    code: 'NOT_FOUND',
                    message: 'This backup no longer exists. Press Check again to refresh the list.'
                })
        })
        openPage()
        await user.click(await screen.findByRole('button', { name: /^Inspect backup from/ }))
        expect(await screen.findByTestId('backup-detail-error')).toHaveTextContent('no longer exists')
    })

    it('Open backup folder asks main to open it (the page sends no path) and shows the answer', async () => {
        const user = userEvent.setup()
        const open = vi.fn(() => Promise.resolve({ ok: true, message: 'The backup folder was opened.' }))
        installBridge({ getBackupsState: () => Promise.resolve(list([summary(ID)])), openBackupFolder: open })
        openPage()
        await user.click(await screen.findByRole('button', { name: 'Open backup folder' }))
        expect(open).toHaveBeenCalledWith()
        expect(await screen.findByText('The backup folder was opened.')).toBeInTheDocument()
    })

    it('an unreadable backup folder shows the reason and a next step, not an empty list', async () => {
        installBridge({
            getBackupsState: () =>
                Promise.resolve(
                    list([], {
                        ok: false,
                        message: 'The backup folder could not be read (permission denied).'
                    })
                )
        })
        openPage()
        const box = await screen.findByTestId('backup-list-error')
        expect(box).toHaveTextContent('permission denied')
        expect(box).toHaveTextContent('press Check again')
        expect(screen.queryByText('No backups yet.')).not.toBeInTheDocument()
    })

    it('if the list cannot be read at all there is a Try again button that really tries again', async () => {
        const user = userEvent.setup()
        const get = vi
            .fn<() => Promise<BackupListResult>>()
            .mockRejectedValueOnce(new Error('bridge down'))
            .mockResolvedValue(list([summary(ID)]))
        installBridge({ getBackupsState: get })
        openPage()
        expect(await screen.findByText('The backups could not be read.')).toBeInTheDocument()
        expect(screen.getByText('bridge down')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Try again' }))
        expect(await screen.findByTestId(`backup-row-${ID}`)).toBeInTheDocument()
    })

    it('the page has a Restore button (check only, Phase 20) but no Delete button (later phase, not built)', async () => {
        installBridge({ getBackupsState: () => Promise.resolve(list([summary(ID)])) })
        openPage()
        await screen.findByTestId(`backup-row-${ID}`)
        expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeEnabled()
        expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument()
    })

    it('a backup that failed its check has a disabled Restore button with the reason (rule 17)', async () => {
        installBridge({ getBackupsState: () => Promise.resolve(list([summary(ID, bad)])) })
        openPage()
        await screen.findByTestId(`backup-row-${ID}`)
        expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeDisabled()
        expect(
            screen.getByLabelText('This backup failed its check, so it cannot be restored.')
        ).toBeInTheDocument()
    })
})

describe('Backups page against the REAL BackupService (real files in a temp folder)', () => {
    const dirs: string[] = []
    afterEach(() => {
        while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
    })

    function realService() {
        const dir = mkdtempSync(join(tmpdir(), 'rf-bpage-'))
        dirs.push(dir)
        mkdirSync(join(dir, 'engine'), { recursive: true })
        mkdirSync(join(dir, 'userData'), { recursive: true })
        const configPath = join(dir, 'engine', 'config.json')
        const accountsPath = join(dir, 'accounts.env')
        const settingsPath = join(dir, 'userData', 'app-settings.json')
        writeFileSync(configPath, JSON.stringify({ webhook: { discord: { url: FAKE.discordUrl } } }))
        writeFileSync(
            accountsPath,
            'ACCOUNT_1_EMAIL=alpha@example.com\nACCOUNT_1_PASSWORD=fake-pw-Zx81-test-only\n'
        )
        writeFileSync(settingsPath, '{"schemaVersion":2}')
        const redactor = new Redactor()
        const redact = (t: string) => redactor.redact(t)
        const logs = join(dir, 'userData', 'logs')
        const service = new BackupService({
            sources: {
                engineConfigPath: configPath,
                appSettingsPath: settingsPath,
                accountsPath: () => accountsPath
            },
            backupRoot: join(dir, 'userData', 'backups', 'full'),
            appVersion: '0.0.1',
            redactor,
            audit: new JsonlLog(logs, 'audit.log', 'audit', redact),
            appLog: new JsonlLog(logs, 'app.log', 'app', redact),
            restrict: () => Promise.resolve({ ok: true, detail: 'test' }),
            openPath: () => Promise.resolve('')
        })
        return { dir, service, accountsPath }
    }

    it('creates a real backup from the page, lists it as OK, then shows it as Damaged after a file is removed', async () => {
        const user = userEvent.setup()
        const { service, dir } = realService()
        installBridge({
            getBackupsState: () => service.list(),
            createBackup: () => service.create(),
            inspectBackup: (id) => service.inspect(id),
            openBackupFolder: () => service.openFolder()
        })
        openPage()
        expect(await screen.findByText('No backups yet.')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Create backup' }))
        const result = await screen.findByTestId('backup-result')
        expect(result).toHaveTextContent(/created and checked: 3 file\(s\)/)
        const row = await screen.findByTestId(/^backup-row-backup-/)
        const id = row.getAttribute('data-testid')?.replace('backup-row-', '') ?? ''
        expect(screen.getByTestId(`backup-status-${id}`)).toHaveTextContent('Checked: OK')

        // Damage a file inside the backup by hand, then press Check again.
        rmSync(join(dir, 'userData', 'backups', 'full', id, 'accounts.env'))
        await user.click(screen.getByRole('button', { name: 'Check again' }))
        await waitFor(() =>
            expect(screen.getByTestId(`backup-status-${id}`)).toHaveTextContent('Damaged: do not use')
        )
        expect(screen.getByTestId('backup-summary')).toHaveTextContent(
            '1 backup. 1 failed the check and must not be used.'
        )

        await user.click(screen.getByRole('button', { name: /^Inspect backup from/ }))
        const check = await screen.findByTestId('backup-detail-check')
        expect(check).toHaveTextContent('Accounts file (accounts.env) is missing from the backup.')

        // Nothing secret or personal is anywhere on the page, and no folder path either.
        const text = document.body.textContent ?? ''
        for (const secret of ['fake-pw-Zx81-test-only', 'alpha@example.com', FAKE.discordUrl, dir]) {
            expect(text).not.toContain(secret)
        }
    })

    it('a real low-disk answer is shown as the page text', async () => {
        const user = userEvent.setup()
        const { dir } = realService()
        const lowService = new BackupService({
            sources: {
                engineConfigPath: join(dir, 'engine', 'config.json'),
                appSettingsPath: join(dir, 'userData', 'app-settings.json'),
                accountsPath: () => join(dir, 'accounts.env')
            },
            backupRoot: join(dir, 'userData', 'backups', 'full'),
            appVersion: '0.0.1',
            redactor: new Redactor(),
            audit: new JsonlLog(join(dir, 'l'), 'a.log', 'audit', (t) => t),
            appLog: new JsonlLog(join(dir, 'l'), 'b.log', 'app', (t) => t),
            fs: { freeBytes: () => Promise.resolve(2048) }
        })
        installBridge({ getBackupsState: () => lowService.list(), createBackup: () => lowService.create() })
        openPage()
        await user.click(await screen.findByRole('button', { name: 'Create backup' }))
        const result = await screen.findByTestId('backup-result')
        expect(result).toHaveTextContent(/not enough free disk space/)
        expect(screen.getByTestId('backup-fix')).toHaveTextContent(/Free some space/)
        expect(result.textContent).not.toContain(dir)
    })
})
