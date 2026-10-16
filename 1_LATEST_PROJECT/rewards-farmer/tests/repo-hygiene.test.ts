import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

describe('repo hygiene', () => {
    it('ENGINE_PIN equals the commit recorded for the engine submodule', () => {
        const pin = readFileSync(join(root, 'ENGINE_PIN'), 'utf8').trim()
        const entry = git('ls-files', '-s', 'engine') // "160000 <sha> 0\tengine"
        expect(entry.split(/\s+/)[1]).toBe(pin)
    })

    it('secrets and user-data paths are git-ignored', () => {
        const mustIgnore = [
            '.env',
            '.env.local',
            'accounts.env',
            'my-accounts.env',
            'sessions/a.json',
            'logs/app.log',
            'diagnostics/x.png',
            'backups/env.bak',
            'userdata/x',
            'config.json',
            'backups/config/config-20261012-120000-000.json',
            'node_modules/x',
            'dist/x.js'
        ]
        for (const p of mustIgnore) {
            expect(() => git('check-ignore', '-q', p), `${p} should be ignored`).not.toThrow()
        }
    })

    it('example files are NOT ignored', () => {
        for (const p of ['accounts.example.env', '.env.example']) {
            expect(() => git('check-ignore', '-q', p), `${p} should be tracked-able`).toThrow()
        }
    })

    it('app Node requirement is at least the engine Node requirement (>=24)', () => {
        const engine = JSON.parse(readFileSync(join(root, 'engine', 'package.json'), 'utf8')) as {
            engines?: { node?: string }
        }
        const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
            engines?: { node?: string }
        }
        expect(engine.engines?.node).toBe('>=24.0.0')
        expect(app.engines?.node).toBe('>=24.0.0')
    })
})
