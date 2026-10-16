// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
    BACKUP_ROLES,
    backupIdFor,
    countAccountSlots,
    isBackupId,
    manifestToText,
    parseManifest,
    roleDef
} from '../src/shared/backup-rules'
import type { BackupManifest } from '../src/shared/backup-types'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function goodManifest(): BackupManifest {
    return {
        format: 'rewards-farmer-backup',
        manifestVersion: 1,
        id: 'backup-20261015-093000-123',
        appVersion: '0.0.1',
        createdAt: '2026-10-15T09:30:00.123Z',
        platform: 'win32',
        files: [
            {
                role: 'engine-config',
                name: 'engine-config.json',
                sizeBytes: 100,
                sha256: SHA_A,
                containsSecrets: true
            },
            { role: 'accounts', name: 'accounts.env', sizeBytes: 50, sha256: SHA_B, containsSecrets: true }
        ],
        skipped: [{ role: 'app-settings', reason: 'App settings does not exist yet.' }],
        totalBytes: 150,
        accountCount: 2
    }
}

// A deep copy that tests can edit freely.
const edit = (change: (m: Record<string, unknown>) => void): string => {
    const copy = JSON.parse(JSON.stringify(goodManifest())) as Record<string, unknown>
    change(copy)
    return JSON.stringify(copy)
}

describe('backup ids', () => {
    it('builds backup-YYYYMMDD-HHMMSS-mmm in local time', () => {
        expect(backupIdFor(new Date(2026, 9, 5, 7, 8, 9, 45))).toBe('backup-20261005-070809-045')
    })
    it('accepts only the exact shape (with an optional -N suffix)', () => {
        expect(isBackupId('backup-20261015-093000-123')).toBe(true)
        expect(isBackupId('backup-20261015-093000-123-2')).toBe(true)
        for (const bad of [
            '',
            'backup-20261015-093000',
            '../backup-20261015-093000-123',
            'backup-20261015-093000-123/..',
            'backup-20261015-093000-123-',
            '.tmp-backup-20261015-093000-123-abc123',
            'BACKUP-20261015-093000-123',
            42,
            null
        ]) {
            expect(isBackupId(bad), String(bad)).toBe(false)
        }
    })
})

describe('roles', () => {
    it('has three fixed file names that are plain names (no folders, no dots-up)', () => {
        expect(BACKUP_ROLES.map((r) => r.name)).toEqual([
            'engine-config.json',
            'accounts.env',
            'app-settings.json'
        ])
        for (const r of BACKUP_ROLES) expect(r.name).toMatch(/^[a-z-]+\.[a-z]+$/)
    })
    it('marks the config and the accounts file as holding secrets, the app settings not', () => {
        expect(roleDef('engine-config').containsSecrets).toBe(true)
        expect(roleDef('accounts').containsSecrets).toBe(true)
        expect(roleDef('app-settings').containsSecrets).toBe(false)
    })
})

describe('countAccountSlots', () => {
    it('counts distinct ACCOUNT_N_EMAIL lines only', () => {
        const text = [
            'ACCOUNT_1_EMAIL=a@example.com',
            'ACCOUNT_1_PASSWORD=x',
            'ACCOUNT_2_EMAIL=b@example.com',
            '#ACCOUNT_3_EMAIL=c@example.com',
            'ACCOUNT_2_EMAIL=b@example.com',
            'OTHER=1'
        ].join('\r\n')
        expect(countAccountSlots(text)).toBe(2)
    })
    it('is 0 for an empty file', () => {
        expect(countAccountSlots('')).toBe(0)
    })
})

describe('parseManifest', () => {
    it('accepts a good manifest and round-trips through manifestToText', () => {
        const r = parseManifest(manifestToText(goodManifest()))
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.manifest).toEqual(goodManifest())
    })

    const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
        ['not JSON', '{nope', /not valid JSON/],
        ['an array', '[]', /not an object/],
        ['wrong format', edit((m) => (m['format'] = 'other')), /not a Rewards Farmer backup/],
        ['wrong version', edit((m) => (m['manifestVersion'] = 2)), /version is not supported/],
        ['bad id', edit((m) => (m['id'] = '../x')), /valid backup id/],
        ['no app version', edit((m) => (m['appVersion'] = '')), /app version/],
        ['bad time', edit((m) => (m['createdAt'] = 'yesterday')), /valid time/],
        ['no platform', edit((m) => delete m['platform']), /platform/],
        ['negative size', edit((m) => (m['totalBytes'] = -1)), /total size/],
        ['no files', edit((m) => (m['files'] = [])), /lists no files/],
        [
            'unknown role',
            edit((m) => ((m['files'] as Record<string, unknown>[])[0]!['role'] = 'sessions')),
            /unknown role/
        ],
        [
            'role listed twice',
            edit((m) => ((m['files'] as Record<string, unknown>[])[1]!['role'] = 'engine-config')),
            /listed twice/
        ],
        [
            'file name from outside the fixed list',
            edit((m) => ((m['files'] as Record<string, unknown>[])[0]!['name'] = '../config.json')),
            /not the expected one/
        ],
        [
            'short checksum',
            edit((m) => ((m['files'] as Record<string, unknown>[])[0]!['sha256'] = 'abc')),
            /checksum/
        ],
        [
            'upper-case checksum',
            edit((m) => ((m['files'] as Record<string, unknown>[])[0]!['sha256'] = 'A'.repeat(64))),
            /checksum/
        ],
        [
            'wrong secrets flag',
            edit((m) => ((m['files'] as Record<string, unknown>[])[0]!['containsSecrets'] = false)),
            /secrets flag/
        ],
        [
            'sizes that do not add up',
            edit((m) => ((m['files'] as Record<string, unknown>[])[0]!['sizeBytes'] = 101)),
            /total size does not match/
        ],
        [
            'account count without accounts file',
            edit((m) => (m['accountCount'] = null)),
            /account count does not match/
        ],
        ['no skipped list', edit((m) => delete m['skipped']), /no skipped list/],
        [
            'skipped without reason',
            edit((m) => ((m['skipped'] as Record<string, unknown>[])[0]!['reason'] = '')),
            /no reason/
        ],
        [
            'role both saved and skipped',
            edit((m) => ((m['skipped'] as Record<string, unknown>[])[0]!['role'] = 'accounts')),
            /both saved and skipped/
        ]
    ]
    for (const [name, text, message] of cases) {
        it(`rejects ${name}`, () => {
            const r = parseManifest(text)
            expect(r.ok).toBe(false)
            if (!r.ok) expect(r.message).toMatch(message)
        })
    }
})
