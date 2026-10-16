import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupService } from '../../src/main/backupService'
import { Redactor } from '../../src/main/engine/redact'
import { JsonlLog } from '../../src/main/jsonlLog'
import { RestoreService } from '../../src/main/restoreService'
import type { BackupListResult, BackupSummary } from '../../src/shared/backup-types'
import type {
    RestoreApplyResult,
    RestoreFailure,
    RestoreFilePlan,
    RestorePrepareResult,
    RestorePreview,
    RestorePreviewResult
} from '../../src/shared/restore-types'
import { App } from '../../src/renderer/App'
import { FAKE } from '../fixtures/fake-secrets'
import { installBridge } from '../helpers/notifyBridge'

// Phase 20: the Restore window. First with a stand-in bridge (rule 18), then against the REAL BackupService and RestoreService
// on real files in a temp folder. Everything secret in here is FAKE.

const T = '2026-10-15T10:00:00.000Z'
const ID = 'backup-20261015-100000-123'
const verification = { status: 'ok', checkedAt: T, filesChecked: 3, problems: [], notes: [] } as const
const summary: BackupSummary = {
    id: ID,
    createdAt: T,
    appVersion: '0.0.1',
    fileCount: 3,
    totalBytes: 2048,
    skipped: [],
    verification
}
const list: BackupListResult = { ok: true, message: null, backups: [summary], unfinishedCount: 0 }

const plan = (
    role: RestoreFilePlan['role'],
    action: RestoreFilePlan['action'],
    label: string
): RestoreFilePlan => ({
    role,
    label,
    action,
    text: `Plan text for ${label}.`,
    containsSecrets: role !== 'app-settings',
    backupBytes: 100,
    currentBytes: action === 'create' ? null : 90,
    backupAccountCount: role === 'accounts' ? 2 : null,
    currentAccountCount: role === 'accounts' && action !== 'create' ? 3 : null
})

const previewOf = (over: Partial<RestorePreview> = {}): RestorePreview => ({
    backup: { id: ID, createdAt: T, appVersion: '0.0.1', platform: 'win32' },
    files: [
        plan('engine-config', 'replace', 'Engine settings'),
        plan('accounts', 'create', 'Accounts file'),
        plan('app-settings', 'unchanged', 'App settings')
    ],
    changeCount: 2,
    blockers: [],
    warnings: [],
    canContinue: true,
    ...over
})

const failureOf = (over: Partial<RestoreFailure> = {}): RestoreFailure => ({
    ok: false,
    stage: 'rejected',
    code: 'READ_FAILED',
    message: 'This backup is damaged, so it was not used.',
    fix: 'Choose another backup from the list.',
    problems: [],
    preview: null,
    userFilesUntouched: true,
    ...over
})

function openPage(): void {
    window.location.hash = '#/backups'
    render(<App />)
}

async function openRestore(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await screen.findByTestId(`backup-row-${ID}`)
    await user.click(screen.getByRole('button', { name: /^Restore backup from/ }))
}

beforeEach(() => {
    window.location.hash = '#/backups'
})
afterEach(() => {
    delete window.farmerShell
})

describe('Restore window (stand-in bridge)', () => {
    it('shows the plan per file in a fixed order, the safety note and that nothing was changed', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.resolve<RestorePreviewResult>({ ok: true, preview: previewOf() })
        })
        openPage()
        await openRestore(user)
        expect(await screen.findByTestId('restore-preview')).toBeInTheDocument()
        expect(screen.getByTestId('restore-summary')).toHaveTextContent(
            'A restore would change 2 of your files. Nothing has been changed yet.'
        )
        expect(screen.getByTestId('restore-action-engine-config')).toHaveTextContent('Will be replaced')
        expect(screen.getByTestId('restore-action-accounts')).toHaveTextContent('Will be created')
        expect(screen.getByTestId('restore-action-app-settings')).toHaveTextContent('Already the same')
        expect(screen.getByTestId('restore-file-accounts')).toHaveTextContent('Accounts: 2 in the backup')
        expect(within(screen.getByTestId('restore-dialog')).getByText(/NOT encrypted/)).toBeInTheDocument()
        expect(screen.getByText(/never deletes a file/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Make safety copy' })).toBeEnabled()
    })

    it('a blocked restore still shows the plan, lists the blockers and cannot make the safety copy', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () =>
                Promise.resolve<RestorePreviewResult>({
                    ok: true,
                    preview: previewOf({
                        blockers: ['A run is active. Stop it first: files cannot be restored during a run.'],
                        canContinue: false
                    })
                })
        })
        openPage()
        await openRestore(user)
        expect(await screen.findByTestId('restore-blockers')).toHaveTextContent('A run is active')
        expect(screen.getByTestId('restore-summary')).toHaveTextContent('cannot go on right now')
        expect(screen.getByRole('button', { name: 'Make safety copy' })).toBeDisabled()
    })

    it('nothing to change: no safety copy button works and the text says so', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () =>
                Promise.resolve<RestorePreviewResult>({
                    ok: true,
                    preview: previewOf({ changeCount: 0, canContinue: false })
                })
        })
        openPage()
        await openRestore(user)
        expect(await screen.findByTestId('restore-summary')).toHaveTextContent(
            'Your current files already match this backup. A restore would change nothing.'
        )
        expect(screen.getByRole('button', { name: 'Make safety copy' })).toBeDisabled()
    })

    it('a refused backup shows the reason, the what-to-do text and that no file was changed', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.resolve<RestorePreviewResult>(failureOf())
        })
        openPage()
        await openRestore(user)
        const box = await screen.findByTestId('restore-refused')
        expect(box).toHaveTextContent('This backup cannot be restored')
        expect(screen.getByTestId('restore-refused-fix')).toHaveTextContent(
            'What to do: Choose another backup'
        )
        expect(box).toHaveTextContent('None of your files was changed.')
        expect(screen.queryByRole('button', { name: 'Make safety copy' })).not.toBeInTheDocument()
        expect(screen.queryByTestId('restore-preview')).not.toBeInTheDocument()
    })

    it('a safety copy that was made is shown, and the last button stays disabled with its reason until the box is ticked (rule 17)', async () => {
        const user = userEvent.setup()
        const pv = previewOf()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.resolve<RestorePreviewResult>({ ok: true, preview: pv }),
            prepareRestore: () =>
                Promise.resolve<RestorePrepareResult>({
                    ok: true,
                    message: 'Safety copy backup-x of your current files was made and checked.',
                    preview: pv,
                    snapshot: {
                        status: 'created',
                        id: 'backup-20261015-100001-001',
                        createdAt: T,
                        fileCount: 2,
                        totalBytes: 200,
                        notSaved: ['The accounts file does not exist now.'],
                        checked: true
                    },
                    userFilesUntouched: true
                })
        })
        openPage()
        await openRestore(user)
        await user.click(await screen.findByRole('button', { name: 'Make safety copy' }))
        const snap = await screen.findByTestId('restore-snapshot')
        expect(snap).toHaveTextContent('Safety copy made and checked')
        expect(snap).toHaveTextContent('Not in the safety copy: The accounts file does not exist now.')
        expect(screen.getByTestId('restore-confirm-text')).toHaveTextContent(
            /I understand that the files marked/
        )
        expect(screen.getByTestId('restore-now')).toBeDisabled()
        expect(screen.getByTestId('restore-now-reason')).toHaveTextContent(/Tick the confirmation box first/)
        // Ticking the box is the only thing that enables the button.
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        expect(screen.getByTestId('restore-now')).toBeEnabled()
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        expect(screen.getByTestId('restore-now')).toBeDisabled()
    })

    const createdSnapshot = {
        status: 'created',
        id: 'backup-20261015-100001-001',
        createdAt: T,
        fileCount: 2,
        totalBytes: 200,
        notSaved: [],
        checked: true
    } as const

    async function reachConfirmStep(
        user: ReturnType<typeof userEvent.setup>,
        apply: (id: string, confirmed: boolean) => Promise<RestoreApplyResult>
    ): Promise<void> {
        const pv = previewOf()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.resolve<RestorePreviewResult>({ ok: true, preview: pv }),
            prepareRestore: () =>
                Promise.resolve<RestorePrepareResult>({
                    ok: true,
                    message: 'Safety copy made.',
                    preview: pv,
                    snapshot: createdSnapshot,
                    userFilesUntouched: true
                }),
            applyRestore: apply
        })
        openPage()
        await openRestore(user)
        await user.click(await screen.findByRole('button', { name: 'Make safety copy' }))
        await screen.findByTestId('restore-confirm-step')
    }

    it('Restore now sends the backup id with confirmed = true, once, and shows what was restored', async () => {
        const user = userEvent.setup()
        const apply = vi.fn((id: string, confirmed: boolean) =>
            Promise.resolve<RestoreApplyResult>({
                ok: true,
                message: `Backup ${id} was restored (confirmed: ${String(confirmed)}). Each one read back.`,
                backupId: id,
                finishedAt: T,
                snapshot: createdSnapshot,
                files: [
                    { role: 'engine-config', label: 'Engine settings', action: 'replaced', bytes: 120 },
                    { role: 'accounts', label: 'Accounts file', action: 'created', bytes: 80 }
                ],
                undoAvailable: true,
                notes: ['The engine was restarted on the restored files.']
            })
        )
        await reachConfirmStep(user, apply)
        expect(apply).not.toHaveBeenCalled()
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        await user.click(screen.getByTestId('restore-now'))
        const done = await screen.findByTestId('restore-done')
        expect(apply).toHaveBeenCalledTimes(1)
        expect(apply).toHaveBeenCalledWith(ID, true)
        expect(done).toHaveTextContent('Restore finished and checked')
        expect(screen.getByTestId('restore-applied-engine-config')).toHaveTextContent('replaced')
        expect(screen.getByTestId('restore-applied-accounts')).toHaveTextContent('created')
        expect(screen.getByTestId('restore-note')).toHaveTextContent('The engine was restarted')
        expect(screen.getByTestId('restore-undo-note')).toBeInTheDocument()
        // the button that applied the restore is gone: it cannot be pressed a second time
        expect(screen.queryByTestId('restore-now')).not.toBeInTheDocument()
    })

    it('a restore that failed and was rolled back says so and that every file was put back', async () => {
        const user = userEvent.setup()
        await reachConfirmStep(user, () =>
            Promise.resolve<RestoreApplyResult>({
                ok: false,
                stage: 'write-failed',
                code: 'WRITE_FAILED',
                message: 'The accounts file could not be written. Every file was put back.',
                fix: 'Close programs that use these files, then try again.',
                problems: [],
                preview: null,
                filesState: 'rolled-back'
            })
        )
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        await user.click(screen.getByTestId('restore-now'))
        const box = await screen.findByTestId('restore-apply-failed')
        expect(box).toHaveTextContent('could not be written')
        expect(screen.getByTestId('restore-apply-failed-fix')).toHaveTextContent('What to do:')
        expect(screen.getByTestId('restore-apply-files-state')).toHaveTextContent(/put back/i)
    })

    it('a restore that needs Undo says so loudly and offers no second restore', async () => {
        const user = userEvent.setup()
        await reachConfirmStep(user, () =>
            Promise.resolve<RestoreApplyResult>({
                ok: false,
                stage: 'write-failed',
                code: 'WRITE_FAILED',
                message: 'A file could not be written and the put-back did not work.',
                fix: 'Press Undo in the box "Last restore" on the Backups page.',
                problems: [],
                preview: null,
                filesState: 'needs-undo'
            })
        )
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        await user.click(screen.getByTestId('restore-now'))
        expect(await screen.findByTestId('restore-apply-files-state')).toHaveTextContent(/Undo/)
        expect(screen.queryByTestId('restore-now')).not.toBeInTheDocument()
    })

    it('a broken bridge during the restore points to the Backups page', async () => {
        const user = userEvent.setup()
        await reachConfirmStep(user, () => Promise.reject(new Error('channel closed')))
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        await user.click(screen.getByTestId('restore-now'))
        expect(await screen.findByTestId('restore-bridge-error')).toHaveTextContent(/Backups page/)
    })

    it('a failed safety copy stops the restore and says nothing was changed', async () => {
        const user = userEvent.setup()
        const pv = previewOf()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.resolve<RestorePreviewResult>({ ok: true, preview: pv }),
            prepareRestore: () =>
                Promise.resolve<RestorePrepareResult>(
                    failureOf({
                        stage: 'snapshot-failed',
                        message: 'The safety copy of your current files could not be made.',
                        fix: 'Free some space, then try again.',
                        preview: pv
                    })
                )
        })
        openPage()
        await openRestore(user)
        await user.click(await screen.findByRole('button', { name: 'Make safety copy' }))
        const box = await screen.findByTestId('restore-prepare-failed')
        expect(box).toHaveTextContent('The safety copy could not be made')
        expect(box).toHaveTextContent('None of your files was changed.')
        expect(screen.queryByTestId('restore-now')).not.toBeInTheDocument()
    })

    it('a broken bridge shows a plain text with what to do', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.reject(new Error('bridge down'))
        })
        openPage()
        await openRestore(user)
        expect(await screen.findByTestId('restore-bridge-error')).toHaveTextContent(
            'The backup could not be checked (bridge down). Nothing was changed.'
        )
    })

    it('Close closes the window', async () => {
        const user = userEvent.setup()
        installBridge({
            getBackupsState: () => Promise.resolve(list),
            previewRestore: () => Promise.resolve<RestorePreviewResult>({ ok: true, preview: previewOf() })
        })
        openPage()
        await openRestore(user)
        const dialog = await screen.findByTestId('restore-dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument())
    })
})

describe('Restore window against the REAL services (real files in a temp folder)', () => {
    const dirs: string[] = []
    afterEach(() => {
        while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
    })

    const ACCOUNTS_OLD = 'ACCOUNT_1_EMAIL=alpha@example.com\nACCOUNT_1_PASSWORD=fake-pw-Zx81-test-only\n'
    const ACCOUNTS_NEW =
        'ACCOUNT_1_EMAIL=alpha@example.com\nACCOUNT_1_PASSWORD=changed-fake-pw-Q9\nACCOUNT_2_EMAIL=beta@example.com\nACCOUNT_2_PASSWORD=fake-pw-2-test-only\n'

    function real(runBlock: () => string | null = () => null) {
        const dir = mkdtempSync(join(tmpdir(), 'rf-rpage-'))
        dirs.push(dir)
        mkdirSync(join(dir, 'engine'), { recursive: true })
        mkdirSync(join(dir, 'userData'), { recursive: true })
        const configPath = join(dir, 'engine', 'config.json')
        const accountsPath = join(dir, 'accounts.env')
        const settingsPath = join(dir, 'userData', 'app-settings.json')
        writeFileSync(configPath, JSON.stringify({ webhook: { discord: { url: FAKE.discordUrl } } }))
        writeFileSync(accountsPath, ACCOUNTS_OLD)
        writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 2, accountsPath }))
        const redactor = new Redactor()
        const redact = (t: string) => redactor.redact(t)
        const logs = join(dir, 'userData', 'logs')
        const audit = new JsonlLog(logs, 'audit.log', 'audit', redact)
        const appLog = new JsonlLog(logs, 'app.log', 'app', redact)
        const sources = {
            engineConfigPath: configPath,
            appSettingsPath: settingsPath,
            accountsPath: () => accountsPath
        }
        const common = {
            sources,
            redactor,
            audit,
            appLog,
            appVersion: '0.0.1',
            restrict: () => Promise.resolve({ ok: true, detail: 'test' })
        }
        const backups = new BackupService({ ...common, backupRoot: join(dir, 'userData', 'backups', 'full') })
        const snapshots = new BackupService({
            ...common,
            backupRoot: join(dir, 'userData', 'backups', 'pre-restore')
        })
        const restore = new RestoreService({
            backups,
            snapshots,
            targets: sources,
            journalPath: join(dir, 'userData', 'backups', 'restore-journal.json'),
            appVersion: '0.0.1',
            settingsSchema: 2,
            runBlock,
            redactor,
            audit,
            appLog
        })
        return { dir, backups, restore, accountsPath, configPath }
    }

    it('previews, makes a real checked safety copy, changes no user file, and shows nothing secret', async () => {
        const user = userEvent.setup()
        const r = real()
        const made = await r.backups.create()
        expect(made.ok).toBe(true)
        writeFileSync(r.accountsPath, ACCOUNTS_NEW)
        const before = readFileSync(r.accountsPath, 'utf8')
        installBridge({
            getBackupsState: () => r.backups.list(),
            previewRestore: (id) => r.restore.preview(id),
            prepareRestore: (id) => r.restore.prepare(id)
        })
        openPage()
        const row = await screen.findByTestId(/^backup-row-backup-/)
        expect(row).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /^Restore backup from/ }))
        expect(await screen.findByTestId('restore-action-accounts')).toHaveTextContent('Will be replaced')
        expect(screen.getByTestId('restore-file-accounts')).toHaveTextContent(
            'Accounts: 1 in the backup, 2 now'
        )
        expect(screen.getByTestId('restore-warnings')).toHaveTextContent(
            /1 account\(s\) would no longer be in the file/
        )

        await user.click(screen.getByRole('button', { name: 'Make safety copy' }))
        expect(await screen.findByTestId('restore-snapshot')).toHaveTextContent(
            'Safety copy made and checked'
        )
        expect(screen.getByTestId('restore-now')).toBeDisabled()

        // No user file was changed by any of it.
        expect(readFileSync(r.accountsPath, 'utf8')).toBe(before)

        const text = document.body.textContent ?? ''
        for (const secret of [
            'fake-pw-Zx81-test-only',
            'changed-fake-pw-Q9',
            'alpha@example.com',
            'beta@example.com',
            FAKE.discordUrl,
            r.dir
        ]) {
            expect(text).not.toContain(secret)
        }
    })

    it('restores through the window, then Undo on the Backups page puts the files back (real files, nothing secret on screen)', async () => {
        const user = userEvent.setup()
        const r = real()
        const made = await r.backups.create()
        expect(made.ok).toBe(true)
        const configOld = readFileSync(r.configPath, 'utf8')
        writeFileSync(r.accountsPath, ACCOUNTS_NEW)
        writeFileSync(r.configPath, JSON.stringify({ headless: false }))
        const configNew = readFileSync(r.configPath, 'utf8')
        installBridge({
            getBackupsState: () => r.backups.list(),
            previewRestore: (id) => r.restore.preview(id),
            prepareRestore: (id) => r.restore.prepare(id),
            applyRestore: (id, confirmed) => r.restore.apply(id, confirmed),
            undoRestore: (confirmed) => r.restore.undo(confirmed),
            getRestoreHistory: () => r.restore.history()
        })
        openPage()
        await screen.findByTestId(/^backup-row-backup-/)
        await user.click(screen.getByRole('button', { name: /^Restore backup from/ }))
        await screen.findByTestId('restore-action-accounts')
        await user.click(screen.getByRole('button', { name: 'Make safety copy' }))
        await screen.findByTestId('restore-confirm-step')
        // nothing is written before the box is ticked and the button is pressed
        expect(readFileSync(r.accountsPath, 'utf8')).toBe(ACCOUNTS_NEW)
        await user.click(screen.getByTestId('restore-confirm-checkbox'))
        await user.click(screen.getByTestId('restore-now'))
        expect(await screen.findByTestId('restore-done')).toHaveTextContent('Restore finished and checked')
        expect(readFileSync(r.accountsPath, 'utf8')).toBe(ACCOUNTS_OLD)
        expect(readFileSync(r.configPath, 'utf8')).toBe(configOld)

        await user.click(within(screen.getByTestId('restore-dialog')).getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument())
        expect(await screen.findByTestId('restore-history-status')).toHaveTextContent('Last restore finished')

        await user.click(await screen.findByTestId('restore-undo'))
        await user.click(await screen.findByRole('button', { name: 'Undo' }))
        expect(await screen.findByTestId('undo-result')).toHaveTextContent('Undo finished and checked')
        expect(readFileSync(r.accountsPath, 'utf8')).toBe(ACCOUNTS_NEW)
        expect(readFileSync(r.configPath, 'utf8')).toBe(configNew)
        expect(await screen.findByTestId('restore-history-status')).toHaveTextContent(
            'Last restore was undone'
        )

        const text = document.body.textContent ?? ''
        for (const secret of [
            'fake-pw-Zx81-test-only',
            'changed-fake-pw-Q9',
            'fake-pw-2-test-only',
            'alpha@example.com',
            'beta@example.com',
            FAKE.discordUrl,
            r.dir
        ]) {
            expect(text).not.toContain(secret)
        }
    })

    it('a run that is active blocks the safety copy, with the real reason on screen', async () => {
        const user = userEvent.setup()
        const r = real(() => 'A run is active. Stop it first: files cannot be restored during a run.')
        await r.backups.create()
        writeFileSync(r.accountsPath, ACCOUNTS_NEW)
        installBridge({
            getBackupsState: () => r.backups.list(),
            previewRestore: (id) => r.restore.preview(id),
            prepareRestore: (id) => r.restore.prepare(id)
        })
        openPage()
        await screen.findByTestId(/^backup-row-backup-/)
        await user.click(screen.getByRole('button', { name: /^Restore backup from/ }))
        expect(await screen.findByTestId('restore-blockers')).toHaveTextContent('A run is active')
        expect(screen.getByRole('button', { name: 'Make safety copy' })).toBeDisabled()
    })

    it('a backup damaged on the disk is refused in the window and nothing is changed', async () => {
        const user = userEvent.setup()
        const r = real()
        const made = await r.backups.create()
        if (!made.ok) throw new Error('setup failed')
        writeFileSync(join(r.dir, 'userData', 'backups', 'full', made.backup.id, 'accounts.env'), 'tampered')
        const before = readFileSync(r.accountsPath, 'utf8')
        installBridge({
            getBackupsState: () => r.backups.list(),
            previewRestore: (id) => r.restore.preview(id),
            prepareRestore: (id) => r.restore.prepare(id)
        })
        openPage()
        await screen.findByTestId(/^backup-row-backup-/)
        // The page's own check already marks it Damaged, so the button is disabled there; the service refuses it as well.
        expect(screen.getByRole('button', { name: /^Restore backup from/ })).toBeDisabled()
        const res = await r.restore.preview(made.backup.id)
        expect(res.ok).toBe(false)
        expect(readFileSync(r.accountsPath, 'utf8')).toBe(before)
        void user
    })
})
