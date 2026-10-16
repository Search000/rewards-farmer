import { formatBytes } from './backup-rules'
import type { BackupCreateResult, BackupListResult, BackupSummary, BackupVerification } from './backup-types'

// Phase 19: the texts and small decisions of the Backups page, kept here (no React, no file access) so the tests can check
// them. Nothing in here can hold a secret: names, sizes, counts and plain sentences only.

export const PAGE_INTRO =
    'A backup is a safe copy of your engine settings (config.json), your accounts file and the app settings. Every backup is checked after it is written and again every time this page is opened, so you can see at once if one was damaged later. Browser sessions and logs are not part of a backup.'

export const PAGE_SECURITY_NOTE =
    'A backup holds real passwords, 2FA secrets and webhook addresses, exactly as in your files, and it is NOT encrypted. It is stored in a folder that only your Windows account can open. Do not copy it to a shared, synced or online folder.'

export const PAGE_FOOTER =
    'Restoring a backup comes in a later step. Nothing is restored, changed or deleted by this page.'

export type StatusTone = 'success' | 'error'

export interface StatusView {
    readonly tone: StatusTone
    readonly label: string
}

export function statusView(v: BackupVerification): StatusView {
    return v.status === 'ok'
        ? { tone: 'success', label: 'Checked: OK' }
        : { tone: 'error', label: 'Damaged: do not use' }
}

export function sizeText(totalBytes: number): string {
    return formatBytes(totalBytes)
}

export function whenText(iso: string, locale?: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return 'unknown time'
    return d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' })
}

export function damagedCount(backups: readonly BackupSummary[]): number {
    return backups.filter((b) => b.verification.status !== 'ok').length
}

// One sentence above the list. Tells the truth about damaged backups and about leftovers.
export function listSummary(list: BackupListResult): string {
    const n = list.backups.length
    if (n === 0) return 'There is no backup yet.'
    const bad = damagedCount(list.backups)
    const noun = n === 1 ? 'backup' : 'backups'
    return bad === 0
        ? `${String(n)} ${noun}. Every one passed the check just now.`
        : `${String(n)} ${noun}. ${String(bad)} failed the check and must not be used.`
}

export function unfinishedNote(count: number): string | null {
    if (count <= 0) return null
    return `${String(count)} unfinished or set-aside item(s) in the backup folder. They are never shown as a backup and never used. The app does not delete them by itself.`
}

export interface CreateView {
    readonly ok: boolean
    readonly message: string
    // What the user can do next. null on success.
    readonly fix: string | null
    readonly notes: readonly string[]
}

export function createView(r: BackupCreateResult): CreateView {
    return r.ok
        ? { ok: true, message: r.message, fix: null, notes: r.notes }
        : { ok: false, message: r.message, fix: r.fix, notes: [] }
}

// The bridge itself failed (not a backup problem).
export function bridgeFailureView(detail: string | null): CreateView {
    return {
        ok: false,
        message: `The backup could not be started${detail === null ? '' : ` (${detail})`}. No backup was created.`,
        fix: 'Close the app and open it again with START.bat, then press Create backup again.',
        notes: []
    }
}

export function shortChecksum(sha256: string): string {
    return `${sha256.slice(0, 12)}…`
}
