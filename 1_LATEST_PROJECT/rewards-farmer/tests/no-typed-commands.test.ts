import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Master prompt rule 27: the user never types commands. No message in the app may tell them to. START.bat and TEST.bat run the
// commands for them, so only the app's own source is scanned here (not the .bat files, not the tests).

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : []
    })
}

describe('rule 27: the app never tells the user to type a command', () => {
    it('no source file contains npm / npx / git commands in a message', () => {
        const bad: string[] = []
        for (const f of files(join(__dirname, '..', 'src'))) {
            const text = readFileSync(f, 'utf8')
            for (const m of text.matchAll(/(npm run |npm install|npm ci|npx |git submodule|git clone)/g))
                bad.push(`${f}: ${m[0]}`)
        }
        expect(bad).toEqual([])
    })
})

describe('rule 27: the troubleshooting guide never tells the user to type a command', () => {
    it('docs/troubleshooting.md has no npm / npx / git commands', () => {
        const text = readFileSync(join(__dirname, '..', 'docs', 'troubleshooting.md'), 'utf8')
        expect(
            [...text.matchAll(/(npm run |npm install|npm ci|npx |git submodule|git clone)/g)].map((m) => m[0])
        ).toEqual([])
    })
})
