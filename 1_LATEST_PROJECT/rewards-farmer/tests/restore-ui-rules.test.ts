import { describe, expect, it } from 'vitest'
import {
    CONFIRM_LABEL,
    CONFIRM_TEXT,
    RESTORE_NOW_NEEDS_CONFIRM_REASON,
    UNDO_CONFIRM_MESSAGE,
    UNDO_NOTE,
    applyFailureTitle,
    applyFailureTone,
    filesStateText,
    historyBridgeFailureText,
    historyView,
    needsAttention,
    restoreNowView,
    undoButtonView,
    undoFailureTitle
} from '../src/shared/restore-ui-rules'
import type {
    FilesState,
    RestoreApplyFailure,
    RestoreApplyStage,
    RestoreHistory,
    RestoreHistoryStatus,
    RestoreUndoFailure,
    RestoreUndoStage
} from '../src/shared/restore-types'

// Phase 21: the texts and small decisions of the restore execution and undo screens. No React here; these are the facts the
// screens show, so a wrong or empty text is caught without opening a window.

const history = (over: Partial<RestoreHistory> = {}): RestoreHistory => ({
    status: 'undo-available',
    message: 'The last restore finished.',
    backupId: 'backup-20261015-100000-123',
    startedAt: '2026-10-15T10:00:00.000Z',
    finishedAt: '2026-10-15T10:00:01.000Z',
    files: [],
    canUndo: true,
    undoBlockedReason: null,
    ...over
})

const applyFail = (stage: RestoreApplyStage, filesState: FilesState): RestoreApplyFailure => ({
    ok: false,
    stage,
    code: 'WRITE_FAILED',
    message: 'm',
    fix: 'f',
    problems: [],
    preview: null,
    filesState
})
const undoFail = (stage: RestoreUndoStage): RestoreUndoFailure => ({
    ok: false,
    stage,
    code: 'WRITE_FAILED',
    message: 'm',
    fix: 'f',
    filesState: 'untouched'
})

const STAGES: RestoreApplyStage[] = [
    'not-confirmed',
    'rejected',
    'blocked',
    'interrupted-earlier',
    'snapshot-failed',
    'write-failed'
]
const UNDO_STAGES: RestoreUndoStage[] = [
    'not-confirmed',
    'nothing-to-undo',
    'blocked',
    'safety-failed',
    'write-failed'
]
const STATUSES: RestoreHistoryStatus[] = [
    'none',
    'undo-available',
    'interrupted',
    'undo-interrupted',
    'undone',
    'record-damaged'
]

describe('Restore now (rule 17: a disabled button always says why)', () => {
    it('is disabled until the box is ticked, and says so', () => {
        const v = restoreNowView({ confirmed: false, applying: false })
        expect(v.enabled).toBe(false)
        expect(v.reason).toBe(RESTORE_NOW_NEEDS_CONFIRM_REASON)
        expect(v.reason).toMatch(/Tick the confirmation box/)
    })
    it('is enabled when the box is ticked', () => {
        expect(restoreNowView({ confirmed: true, applying: false })).toEqual({ enabled: true, reason: null })
    })
    it('is disabled while it runs, even when the box is ticked', () => {
        const v = restoreNowView({ confirmed: true, applying: true })
        expect(v.enabled).toBe(false)
        expect(v.reason).toMatch(/running/)
    })
})

describe('where the files stand after a refused or failed restore', () => {
    it('has a plain text for every state, and the mixed state points to Undo', () => {
        const states: FilesState[] = ['untouched', 'rolled-back', 'needs-undo']
        for (const s of states) expect(filesStateText(s).length).toBeGreaterThan(20)
        expect(filesStateText('untouched')).toMatch(/None of your files was changed/)
        expect(filesStateText('rolled-back')).toMatch(/put back/)
        expect(filesStateText('needs-undo')).toMatch(/Undo/)
        expect(filesStateText('needs-undo')).toMatch(/may be restored and some not/)
    })
    it('every stage has a title; a rolled-back write failure says it was rolled back', () => {
        for (const st of STAGES) {
            expect(applyFailureTitle(applyFail(st, 'untouched')).length).toBeGreaterThan(5)
        }
        expect(applyFailureTitle(applyFail('write-failed', 'rolled-back'))).toMatch(/rolled back/)
        expect(applyFailureTitle(applyFail('write-failed', 'needs-undo'))).not.toMatch(/rolled back/)
    })
    it('only a mixed state is shown as an error', () => {
        expect(applyFailureTone(applyFail('write-failed', 'needs-undo'))).toBe('error')
        expect(applyFailureTone(applyFail('write-failed', 'rolled-back'))).toBe('warning')
        expect(applyFailureTone(applyFail('blocked', 'untouched'))).toBe('warning')
    })
    it('every undo stage has a title', () => {
        for (const st of UNDO_STAGES) expect(undoFailureTitle(undoFail(st)).length).toBeGreaterThan(5)
    })
})

describe('the "Last restore" part of the Backups page', () => {
    it('shows nothing when no restore was ever done', () => {
        expect(historyView('none').visible).toBe(false)
        for (const s of STATUSES.filter((x) => x !== 'none')) expect(historyView(s).visible).toBe(true)
    })
    it('an unfinished restore or undo is an error, a finished one is not', () => {
        expect(historyView('interrupted').tone).toBe('error')
        expect(historyView('undo-interrupted').tone).toBe('error')
        expect(historyView('undo-available').tone).toBe('success')
        expect(historyView('record-damaged').tone).toBe('warning')
    })
    it('every status has a title', () => {
        for (const s of STATUSES) expect(historyView(s).title.length).toBeGreaterThan(5)
    })
    it('Undo is shown for a finished or an unfinished restore and for an unfinished undo only', () => {
        expect(undoButtonView(history()).show).toBe(true)
        expect(undoButtonView(history({ status: 'interrupted' })).show).toBe(true)
        expect(undoButtonView(history({ status: 'undo-interrupted' })).show).toBe(true)
        for (const s of ['none', 'undone', 'record-damaged'] as const) {
            expect(undoButtonView(history({ status: s, canUndo: false })).show).toBe(false)
        }
    })
    it('Undo is enabled when it can work, and disabled with the reason when it cannot (rule 17)', () => {
        expect(undoButtonView(history())).toEqual({ show: true, enabled: true, reason: null })
        const blocked = undoButtonView(
            history({ canUndo: false, undoBlockedReason: 'A run is active. Stop it first.' })
        )
        expect(blocked.enabled).toBe(false)
        expect(blocked.reason).toBe('A run is active. Stop it first.')
        // never a disabled button without a reason, even when the record gives none
        const noReason = undoButtonView(history({ canUndo: false, undoBlockedReason: null }))
        expect(noReason.enabled).toBe(false)
        expect(noReason.reason).not.toBeNull()
    })
    it('the top-of-page warning is for unfinished work only', () => {
        expect(needsAttention(history({ status: 'interrupted' }))).toBe(true)
        expect(needsAttention(history({ status: 'undo-interrupted' }))).toBe(true)
        expect(needsAttention(history())).toBe(false)
        expect(needsAttention(history({ status: 'undone', canUndo: false }))).toBe(false)
    })
    it('a bridge failure says no file was changed and what to do', () => {
        const t = historyBridgeFailureText('bridge down')
        expect(t).toMatch(/bridge down/)
        expect(t).toMatch(/No file was changed/)
        expect(t).toMatch(/START\.bat/)
        expect(historyBridgeFailureText(null)).not.toMatch(/\(null\)/)
    })
})

describe('the fixed texts', () => {
    it('the confirmation names what is replaced and where the old files go', () => {
        expect(CONFIRM_TEXT).toMatch(/replaced/)
        expect(CONFIRM_TEXT).toMatch(/safety copy/)
        expect(CONFIRM_LABEL.length).toBeGreaterThan(10)
    })
    it('the undo texts promise only what the service does (a safety copy first, created files removed)', () => {
        expect(UNDO_CONFIRM_MESSAGE).toMatch(/safety copy/)
        expect(UNDO_CONFIRM_MESSAGE).toMatch(/removed/)
        expect(UNDO_NOTE).toMatch(/Undo/)
    })
    it('no fixed text mentions a typed command (rule 27) or holds anything secret-like', () => {
        const all = [
            CONFIRM_TEXT,
            CONFIRM_LABEL,
            RESTORE_NOW_NEEDS_CONFIRM_REASON,
            UNDO_CONFIRM_MESSAGE,
            UNDO_NOTE,
            historyBridgeFailureText('x')
        ].join('\n')
        expect(all).not.toMatch(/npm |powershell|cmd\.exe|password=|https?:\/\//i)
    })
})
