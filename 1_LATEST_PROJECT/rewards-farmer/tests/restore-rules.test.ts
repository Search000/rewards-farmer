import { describe, expect, it } from 'vitest'
import { MANIFEST_VERSION_MESSAGE } from '../src/shared/backup-rules'
import type { BackupVerifyProblem, VerifyProblemKind } from '../src/shared/backup-types'
import {
    actionLabel,
    compareVersions,
    isManifestVersionProblem,
    parseAppVersion,
    planAction,
    problemsFromVerification,
    restoreFix,
    samePlace,
    settingsForRestore,
    settingsSchemaProblem,
    versionProblem
} from '../src/shared/restore-rules'
import type { RestoreAction, RestoreProblemKind } from '../src/shared/restore-types'

// Phase 20: the pure rules (versions, settings schema, what happens to a file, texts). No files here.

const v = (s: string) => {
    const p = parseAppVersion(s)
    if (p === null) throw new Error(`not a version: ${s}`)
    return p
}

describe('app versions', () => {
    it('reads major.minor.patch and ignores a pre-release tag', () => {
        expect(parseAppVersion('0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 })
        expect(parseAppVersion(' 1.22.333 ')).toEqual({ major: 1, minor: 22, patch: 333 })
        expect(parseAppVersion('2.0.0-beta.1')).toEqual({ major: 2, minor: 0, patch: 0 })
        expect(parseAppVersion('2.0.0+build5')).toEqual({ major: 2, minor: 0, patch: 0 })
    })

    it('refuses anything that is not a version', () => {
        for (const bad of [
            '',
            'banana',
            '1',
            '1.2',
            '1.2.x',
            'v1.2.3',
            '1.2.3.4',
            '-1.0.0',
            '1..3',
            '99999999.0.0'
        ]) {
            expect(parseAppVersion(bad)).toBeNull()
        }
    })

    it('compares by major, then minor, then patch', () => {
        expect(compareVersions(v('0.0.1'), v('0.0.1'))).toBe(0)
        expect(compareVersions(v('0.0.2'), v('0.0.1'))).toBeGreaterThan(0)
        expect(compareVersions(v('0.1.0'), v('0.0.9'))).toBeGreaterThan(0)
        expect(compareVersions(v('1.0.0'), v('0.99.99'))).toBeGreaterThan(0)
        expect(compareVersions(v('0.9.0'), v('1.0.0'))).toBeLessThan(0)
        expect(compareVersions(v('0.0.10'), v('0.0.9'))).toBeGreaterThan(0)
    })

    it('a backup of the same or an older app is accepted', () => {
        expect(versionProblem('0.0.1', '0.0.1')).toBeNull()
        expect(versionProblem('0.0.1', '0.0.2')).toBeNull()
        expect(versionProblem('0.9.9', '1.0.0')).toBeNull()
        expect(versionProblem('1.0.0-beta', '1.0.0')).toBeNull()
    })

    it('a backup of a newer app is refused, and the text names both versions', () => {
        for (const [backup, app] of [
            ['0.0.2', '0.0.1'],
            ['0.1.0', '0.0.9'],
            ['1.0.0', '0.9.9']
        ] as const) {
            const p = versionProblem(backup, app)
            expect(p?.kind).toBe('app-too-new')
            expect(p?.text).toContain(backup)
            expect(p?.text).toContain(app)
        }
    })

    it('a version that cannot be read (either side) is refused, never accepted', () => {
        expect(versionProblem('banana', '0.0.1')?.kind).toBe('version-unknown')
        expect(versionProblem('', '0.0.1')?.kind).toBe('version-unknown')
        expect(versionProblem('0.0.1', 'banana')?.kind).toBe('version-unknown')
    })
})

describe('app settings schema inside a backup', () => {
    it('the current and an older schema are accepted (the app upgrades an old file itself)', () => {
        expect(settingsSchemaProblem({ schemaVersion: 2 }, 2, 'app-settings.json')).toBeNull()
        expect(settingsSchemaProblem({ schemaVersion: 1 }, 2, 'app-settings.json')).toBeNull()
    })

    it('a newer schema is refused with both numbers', () => {
        const p = settingsSchemaProblem({ schemaVersion: 3 }, 2, 'app-settings.json')
        expect(p?.kind).toBe('app-too-new')
        expect(p?.file).toBe('app-settings.json')
        expect(p?.text).toMatch(/version 3; this app knows up to 2/)
    })

    it('anything without a usable schema number is refused', () => {
        for (const bad of [
            null,
            'text',
            5,
            [],
            {},
            { schemaVersion: '2' },
            { schemaVersion: 0 },
            { schemaVersion: 1.5 },
            { schemaVersion: -1 }
        ]) {
            expect(settingsSchemaProblem(bad, 2, 'app-settings.json')?.kind).toBe('content-invalid')
        }
    })
})

describe('what happens to one file', () => {
    const sha = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    it('is chosen from the backup, the current file and the place', () => {
        expect(planAction({ sha256: sha }, { state: 'present', sha256: other }, true)).toBe('replace')
        expect(planAction({ sha256: sha }, { state: 'present', sha256: sha }, true)).toBe('unchanged')
        expect(planAction({ sha256: sha }, { state: 'absent' }, true)).toBe('create')
        expect(planAction(null, { state: 'present', sha256: sha }, true)).toBe('keep')
        expect(planAction(null, { state: 'absent' }, false)).toBe('keep')
    })

    it('no place, or a current file that cannot be read, waits (never a silent guess)', () => {
        expect(planAction({ sha256: sha }, { state: 'absent' }, false)).toBe('cannot-restore')
        expect(planAction({ sha256: sha }, { state: 'present', sha256: other }, false)).toBe('cannot-restore')
        expect(planAction({ sha256: sha }, { state: 'unreadable' }, true)).toBe('cannot-restore')
    })

    it('every action has its own label', () => {
        const actions: RestoreAction[] = ['replace', 'create', 'unchanged', 'keep', 'cannot-restore']
        expect(new Set(actions.map(actionLabel)).size).toBe(actions.length)
    })
})

describe('places and the app settings that would be written', () => {
    it('Windows places ignore case and slash direction; other systems do not', () => {
        expect(samePlace('C:\\A\\b.env', 'c:/a/B.env', 'win32')).toBe(true)
        expect(samePlace('C:\\A\\b.env\\', 'C:\\A\\b.env', 'win32')).toBe(true)
        expect(samePlace('C:\\A\\b.env', 'C:\\A\\c.env', 'win32')).toBe(false)
        expect(samePlace('/home/a/B.env', '/home/a/b.env', 'linux')).toBe(false)
        expect(samePlace('/home/a/b.env', '/home/a/b.env', 'linux')).toBe(true)
    })

    const saved = JSON.stringify({
        schemaVersion: 2,
        themeMode: 'light',
        accountsPath: '/old/a.env',
        timerEnabled: true
    })

    it('the same place: the saved bytes are used untouched', () => {
        const r = settingsForRestore(saved, '/old/a.env', 'linux')
        expect(r.keepsCurrentPlace).toBe(false)
        expect(r.text).toBe(saved)
    })

    it('another place: the current accounts file choice is kept, every other saved setting is put back', () => {
        const r = settingsForRestore(saved, '/new/b.env', 'linux')
        expect(r.keepsCurrentPlace).toBe(true)
        expect(JSON.parse(r.text)).toEqual({
            schemaVersion: 2,
            themeMode: 'light',
            accountsPath: '/new/b.env',
            timerEnabled: true
        })
        expect(r.text.endsWith('\n')).toBe(true)
    })

    it('no place saved and none now is the same; a saved place with none now keeps "none"', () => {
        const none = JSON.stringify({ schemaVersion: 2, accountsPath: null })
        expect(settingsForRestore(none, null, 'linux').keepsCurrentPlace).toBe(false)
        const r = settingsForRestore(saved, null, 'linux')
        expect(r.keepsCurrentPlace).toBe(true)
        expect(JSON.parse(r.text).accountsPath).toBeNull()
        expect(JSON.parse(settingsForRestore(none, '/x/y.env', 'linux').text).accountsPath).toBe('/x/y.env')
    })
})

describe('problems of the backup check become restore problems', () => {
    const p = (kind: VerifyProblemKind, text = 'x'): BackupVerifyProblem => ({ kind, file: 'f', text })
    it('maps every kind', () => {
        const map: [VerifyProblemKind, RestoreProblemKind][] = [
            ['manifest-missing', 'incomplete'],
            ['manifest-invalid', 'manifest'],
            ['manifest-wrong-id', 'manifest'],
            ['file-missing', 'file-missing'],
            ['not-a-file', 'damaged'],
            ['size-differs', 'damaged'],
            ['checksum-differs', 'damaged'],
            ['unreadable', 'damaged']
        ]
        for (const [from, to] of map) expect(problemsFromVerification([p(from)])[0]?.kind).toBe(to)
    })

    it('a manifest of another format version is told apart from a broken one, by the shared sentence only', () => {
        expect(isManifestVersionProblem(p('manifest-invalid', MANIFEST_VERSION_MESSAGE))).toBe(true)
        expect(isManifestVersionProblem(p('manifest-invalid', 'The manifest is not valid JSON.'))).toBe(false)
        expect(isManifestVersionProblem(p('file-missing', MANIFEST_VERSION_MESSAGE))).toBe(false)
        expect(problemsFromVerification([p('manifest-invalid', MANIFEST_VERSION_MESSAGE)])[0]?.kind).toBe(
            'wrong-version'
        )
    })

    it('keeps the file name and the text, and every problem', () => {
        const out = problemsFromVerification([p('file-missing', 'one'), p('checksum-differs', 'two')])
        expect(out.map((o) => o.text)).toEqual(['one', 'two'])
        expect(out.every((o) => o.file === 'f')).toBe(true)
    })
})

describe('"what to do" texts', () => {
    const kinds: RestoreProblemKind[] = [
        'bad-name',
        'not-found',
        'incomplete',
        'manifest',
        'wrong-version',
        'file-missing',
        'damaged',
        'app-too-new',
        'version-unknown',
        'content-invalid',
        'run-active',
        'no-target',
        'snapshot-failed'
    ]
    it('every kind has a plain text that is never empty', () => {
        for (const k of kinds) expect(restoreFix(k).length).toBeGreaterThan(40)
    })

    it('no text tells the user to type a command (rule 27) and none holds a path or a secret', () => {
        for (const k of kinds) {
            const t = restoreFix(k)
            expect(t).not.toMatch(/\bnpm\b|\bnode\b|\bgit\b|powershell|cmd\.exe|C:\\|\/home\/|\.env\b.*=/i)
        }
    })

    it('the texts of a refused backup say that nothing was changed', () => {
        for (const k of [
            'bad-name',
            'not-found',
            'damaged',
            'wrong-version',
            'app-too-new',
            'version-unknown',
            'content-invalid',
            'snapshot-failed'
        ] as const) {
            expect(restoreFix(k)).toMatch(/[Nn]othing was changed/)
        }
    })

    it('the texts that name a button name a real one', () => {
        expect(restoreFix('run-active')).toMatch(/Home page, press Stop/)
        expect(restoreFix('no-target')).toMatch(/Accounts Path \/ Open/)
        expect(restoreFix('damaged')).toMatch(/Create backup/)
        expect(restoreFix('not-found')).toMatch(/Check again/)
    })
})
