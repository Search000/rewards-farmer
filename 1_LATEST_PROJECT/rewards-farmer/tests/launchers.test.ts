// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static checks of the double-click launchers (master prompt rules 23 and 24). This does NOT run them: the .bat files can
// only be executed on Windows. Running them there is recorded in the phase report (NOT TESTED where it was not done).

const root = join(__dirname, '..')
const read = (name: string): string => readFileSync(join(root, name), 'utf8')

describe.each(['START.bat', 'TEST.bat'])('%s', (name) => {
    const text = read(name)
    // Comment lines (::) may say "no passwords"; the checks for forbidden content look at commands only.
    const commands = text
        .split('\r\n')
        .filter((l) => !l.trim().startsWith('::'))
        .join('\n')

    it('uses Windows line endings and switches to its own folder', () => {
        expect(text).toMatch(/\r\n/)
        expect(text.replace(/\r\n/g, '')).not.toMatch(/\n/)
        expect(text).toContain('cd /d "%~dp0"')
    })

    it('checks Node.js and tells the user where to download it', () => {
        expect(text).toContain('where node')
        expect(text).toContain('https://nodejs.org/')
        expect(text).toMatch(/LSS 24/)
    })

    it('writes a log in logs\\ and always ends with pause and a SUCCESS or FAILED line with the log path', () => {
        expect(text).toMatch(/logs\\(start|test)\.log/)
        expect(text).toContain('SUCCESS')
        expect(text).toContain('FAILED')
        expect(text).toMatch(/Log file: %LOG%/)
        const tail = text.split('\r\n').filter((l) => l.trim() !== '')
        expect(tail.slice(-3).join('\n')).toMatch(/pause[\s\S]*exit \/b 1/)
        expect(text.match(/\npause/g)?.length ?? text.match(/\r\npause/g)?.length).toBeGreaterThanOrEqual(2)
    })

    it('installs nothing globally, deletes nothing, changes no system policy, and holds no secret', () => {
        expect(commands).not.toMatch(/npm (i|install)\b.*(-g|--global)/)
        expect(commands).not.toMatch(/\b(del|rmdir|rd|erase)\b/i)
        expect(commands).not.toMatch(/Set-ExecutionPolicy|reg add|setx|netsh|schtasks/i)
        expect(commands).not.toMatch(/password|\btoken\b|cookie|apikey|secret/i)
    })
})

describe('what each launcher runs', () => {
    it('START.bat installs on first run or after an unfinished install, then starts the app', () => {
        const t = read('START.bat')
        // npm writes node_modules\\.package-lock.json only when an install finished; a bare folder means an interrupted install.
        expect(t).toContain('if not exist "node_modules\\.package-lock.json"')
        expect(t).toContain('if not exist "engine\\node_modules\\.package-lock.json"')
        expect(t).toContain('npm ci')
        expect(t).toContain('npm run engine:install')
        expect(t).toContain('npm run engine:build')
        expect(t).toContain('npm run start')
        // Downloads that are not the project packages ask first.
        expect(t).toMatch(/choice \/c YN/)
    })

    it('TEST.bat runs type-check, lint, format check and the tests, and reports each', () => {
        const t = read('TEST.bat')
        expect(t).toContain('if not exist "node_modules\\.package-lock.json"')
        for (const cmd of ['npm run typecheck', 'npm run lint', 'npm run format:check', 'npm run test']) {
            expect(t).toContain(cmd)
        }
        for (const label of ['R_TYPES', 'R_LINT', 'R_FORMAT', 'R_TESTS']) expect(t).toContain(label)
    })
})

describe("install safety (found in the user's Windows logs: two launchers ran at once and corrupted node_modules)", () => {
    it.each(['START.bat', 'TEST.bat'])('%s allows only one launcher at a time per folder', (name) => {
        const t = read(name)
        expect(t).toContain('logs\\run.lock')
        expect(t).toContain('"_locked"')
        expect(t).toContain('9>"%LOCK%" call "%~f0" _locked')
        expect(t).toContain('already running')
    })

    it.each(['START.bat', 'TEST.bat'])(
        '%s checks that the tools really exist, not only the marker file',
        (name) => {
            const t = read(name)
            expect(t).toContain('node_modules\\rolldown\\package.json')
            expect(t).toContain('node_modules\\.bin\\%%B.cmd')
            expect(t).toContain('engine\\node_modules\\.bin\\tsc.cmd')
            expect(t).toContain('call :check_app')
            expect(t).toContain('call :check_engine')
        }
    )

    it.each(['START.bat', 'TEST.bat'])('%s warns about very long folder paths', (name) => {
        expect(read(name)).toContain('%CD:~90,1%')
    })
})
