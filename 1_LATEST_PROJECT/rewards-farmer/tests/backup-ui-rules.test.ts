import { describe, expect, it } from 'vitest'
import type {
    BackupCreateResult,
    BackupListResult,
    BackupSummary,
    BackupVerification
} from '../src/shared/backup-types'
import {
    bridgeFailureView,
    createView,
    damagedCount,
    listSummary,
    shortChecksum,
    statusView,
    unfinishedNote,
    whenText
} from '../src/shared/backup-ui-rules'

// Phase 19: texts and small decisions of the Backups page.

const T = '2026-10-15T10:00:00.000Z'
const ok: BackupVerification = { status: 'ok', checkedAt: T, filesChecked: 3, problems: [], notes: [] }
const bad: BackupVerification = {
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
const summary = (id: string, v: BackupVerification): BackupSummary => ({
    id,
    createdAt: T,
    appVersion: '0.0.1',
    fileCount: 3,
    totalBytes: 2048,
    skipped: [],
    verification: v
})
const list = (backups: BackupSummary[], unfinishedCount = 0): BackupListResult => ({
    ok: true,
    message: null,
    backups,
    unfinishedCount
})

describe('statusView', () => {
    it('ok is success, failed is error and says do not use', () => {
        expect(statusView(ok)).toEqual({ tone: 'success', label: 'Checked: OK' })
        expect(statusView(bad)).toEqual({ tone: 'error', label: 'Damaged: do not use' })
    })
})

describe('listSummary', () => {
    it('says there is none', () => {
        expect(listSummary(list([]))).toBe('There is no backup yet.')
    })
    it('one good backup', () => {
        expect(listSummary(list([summary('backup-1', ok)]))).toBe(
            '1 backup. Every one passed the check just now.'
        )
    })
    it('never says all good when one is damaged', () => {
        const text = listSummary(list([summary('a', ok), summary('b', bad), summary('c', ok)]))
        expect(text).toBe('3 backups. 1 failed the check and must not be used.')
        expect(text).not.toMatch(/passed/)
    })
    it('damagedCount counts only failed ones', () => {
        expect(damagedCount([summary('a', ok), summary('b', bad)])).toBe(1)
    })
})

describe('unfinishedNote', () => {
    it('is null for zero and says they are never used otherwise', () => {
        expect(unfinishedNote(0)).toBeNull()
        const t = unfinishedNote(2)
        expect(t).toMatch(/^2 unfinished or set-aside item/)
        expect(t).toMatch(/never shown as a backup and never used/)
    })
})

describe('createView', () => {
    it('success keeps message and notes, no fix', () => {
        const r: BackupCreateResult = {
            ok: true,
            message: 'Backup x created and checked.',
            backup: summary('x', ok),
            notes: ['note']
        }
        expect(createView(r)).toEqual({
            ok: true,
            message: 'Backup x created and checked.',
            fix: null,
            notes: ['note']
        })
    })
    it('failure carries the what-to-do text', () => {
        const r: BackupCreateResult = {
            ok: false,
            code: 'WRITE_FAILED',
            message: 'The disk is full. No backup was created.',
            reason: 'disk-full',
            fix: 'Free some space.'
        }
        expect(createView(r)).toEqual({
            ok: false,
            message: 'The disk is full. No backup was created.',
            fix: 'Free some space.',
            notes: []
        })
    })
    it('bridge failure still says no backup was created and gives a next step without a typed command', () => {
        const v = bridgeFailureView('boom')
        expect(v.ok).toBe(false)
        expect(v.message).toMatch(/No backup was created/)
        expect(v.fix).toMatch(/START\.bat/)
        expect(bridgeFailureView(null).message).not.toMatch(/\(null\)/)
    })
})

describe('small helpers', () => {
    it('whenText gives a readable time and a safe text for a bad time', () => {
        expect(whenText(T, 'en-US')).toMatch(/2026/)
        expect(whenText('not a date')).toBe('unknown time')
    })
    it('shortChecksum shows only the start', () => {
        expect(shortChecksum('0123456789abcdef'.repeat(4))).toBe('0123456789ab…')
    })
})
