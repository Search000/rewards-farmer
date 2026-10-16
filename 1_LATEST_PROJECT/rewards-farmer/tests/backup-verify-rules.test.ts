import { describe, expect, it } from 'vitest'
import {
    MIN_FREE_RESERVE_BYTES,
    failureFix,
    formatBytes,
    reasonFromErrno,
    requiredFreeBytes,
    verifyEntry
} from '../src/shared/backup-rules'
import type { BackupFileEntry } from '../src/shared/backup-types'

// Phase 19: pure rules of the check after writing and of the failure texts.

const entry: BackupFileEntry = {
    role: 'accounts',
    name: 'accounts.env',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    containsSecrets: true
}

describe('verifyEntry', () => {
    it('same size and checksum: no problem', () => {
        expect(verifyEntry(entry, { size: 100, sha256: 'a'.repeat(64) })).toBeNull()
    })
    it('a different size is size-differs and names both sizes', () => {
        const p = verifyEntry(entry, { size: 90, sha256: 'a'.repeat(64) })
        expect(p?.kind).toBe('size-differs')
        expect(p?.file).toBe('accounts.env')
        expect(p?.text).toContain('90 bytes instead of 100 bytes')
    })
    it('the size is checked before the checksum (a cut-off file is reported as a size problem)', () => {
        expect(verifyEntry(entry, { size: 1, sha256: 'b'.repeat(64) })?.kind).toBe('size-differs')
    })
    it('same size, other checksum: checksum-differs', () => {
        const p = verifyEntry(entry, { size: 100, sha256: 'b'.repeat(64) })
        expect(p?.kind).toBe('checksum-differs')
        expect(p?.text).toMatch(/was changed after the backup was made/)
    })
    it('the text holds no checksum value and no secret', () => {
        const p = verifyEntry(entry, { size: 100, sha256: 'b'.repeat(64) })
        expect(p?.text).not.toContain('a'.repeat(10))
        expect(p?.text).not.toContain('b'.repeat(10))
    })
})

describe('free space rule', () => {
    it('needs the files plus a fixed reserve', () => {
        expect(requiredFreeBytes(0)).toBe(MIN_FREE_RESERVE_BYTES)
        expect(requiredFreeBytes(5000)).toBe(5000 + MIN_FREE_RESERVE_BYTES)
    })
    it('formatBytes: bytes, KB, MB, GB', () => {
        expect(formatBytes(0)).toBe('0 bytes')
        expect(formatBytes(1023)).toBe('1023 bytes')
        expect(formatBytes(1536)).toBe('1.5 KB')
        expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
        expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
    })
})

describe('reasonFromErrno', () => {
    it.each([
        ['EACCES', 'permission-denied'],
        ['EPERM', 'permission-denied'],
        ['ENOSPC', 'disk-full'],
        ['EROFS', 'read-only'],
        ['EIO', 'unknown'],
        [undefined, 'unknown']
    ] as const)('%s -> %s', (code, reason) => {
        expect(reasonFromErrno(code)).toBe(reason)
    })
})

describe('failureFix', () => {
    const reasons = [
        'permission-denied',
        'disk-full',
        'low-space',
        'read-only',
        'source-unreadable',
        'source-not-file',
        'source-too-large',
        'nothing-to-back-up',
        'copy-differs',
        'verify-failed',
        'unknown'
    ] as const
    it.each(reasons)('%s has a plain "what to do" without a typed command', (reason) => {
        const text = failureFix(reason)
        expect(text.length).toBeGreaterThan(40)
        expect(text).not.toMatch(/npm |cmd\b|powershell|sudo|chmod/i)
    })
    it('texts differ per reason where the advice differs', () => {
        expect(new Set(reasons.map((r) => failureFix(r))).size).toBeGreaterThanOrEqual(9)
    })
    it('low space and disk full give the same advice (free space)', () => {
        expect(failureFix('low-space')).toBe(failureFix('disk-full'))
    })
})
