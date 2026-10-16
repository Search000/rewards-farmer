// Drives the REAL built app (dist/) over the Chrome DevTools protocol and saves Home page screenshots plus evidence.
// Linux/Xvfb helper for the Phase 6 report. Usage: node scripts/capture-home.mjs <outDir>
// State 2 uses a throw-away user-data dir whose settings point at a FAKE accounts file in a temp folder (test only).
// It never presses Start, so no browser or bot is launched.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const outDir = process.argv[2] ?? 'reports/phase-06-screenshots'
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evidence = {}

async function session(label, port, userData) {
    const app = spawn(
        'xvfb-run',
        [
            '-a',
            '-s',
            '-screen 0 1600x1000x24',
            'node_modules/.bin/electron',
            '.',
            '--no-sandbox',
            `--user-data-dir=${userData}`,
            `--remote-debugging-port=${port}`
        ],
        { stdio: 'ignore', detached: true }
    )
    let target = null
    for (let i = 0; i < 80 && target === null; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
            target = list.find((t) => t.type === 'page') ?? null
        } catch {
            /* not up yet */
        }
        if (target === null) await sleep(500)
    }
    if (target === null) throw new Error('Electron page target never appeared')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
        ws.onopen = res
        ws.onerror = rej
    })
    let id = 0
    const pending = new Map()
    const problems = []
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg)
            pending.delete(msg.id)
        } else if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.text)
        else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
            problems.push(
                `${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`
            )
    }
    const send = (method, params = {}) =>
        new Promise((res) => {
            const i = ++id
            pending.set(i, res)
            ws.send(JSON.stringify({ id: i, method, params }))
        })
    const evalJs = async (expression) =>
        (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
            ?.result?.value
    await send('Runtime.enable')
    await send('Page.enable')
    await sleep(6000) // engine API child needs a moment to report ready
    await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false
    })
    await sleep(500)
    const shot = async (name) => {
        const r = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
        console.log('saved', name)
    }
    const state = await evalJs('window.farmerShell.getFarmerState()')
    evidence[label] = {
        engine: state.engine,
        accounts: state.accounts,
        run: state.run,
        current: state.current,
        summary: state.summary,
        startDisabledReason: state.startDisabledReason,
        stopDisabledReason: state.stopDisabledReason,
        notices: state.notices.map((n) => n.message),
        pageText: await evalJs('document.body.innerText.slice(0, 1500)')
    }
    await shot(label)
    evidence[label].consoleProblems = problems
    ws.close()
    try {
        process.kill(-app.pid, 'SIGTERM')
    } catch {
        /* already gone */
    }
    await sleep(1500)
}

const base = mkdtempSync(join(tmpdir(), 'rf-home-'))
const ud1 = join(base, 'ud1')
mkdirSync(ud1)
await session('01-home-fresh-no-accounts', 9341, ud1)

const ud2 = join(base, 'ud2')
mkdirSync(ud2)
const accounts = join(base, 'accounts.env')
writeFileSync(
    accounts,
    'ACCOUNT_1_EMAIL=fixture1@example.invalid\nACCOUNT_1_PASSWORD=not-a-real-password\nACCOUNT_2_EMAIL=fixture2@example.invalid\nACCOUNT_2_PASSWORD=not-a-real-password\n'
)
writeFileSync(
    join(ud2, 'app-settings.json'),
    JSON.stringify({
        schemaVersion: 1,
        themeMode: 'dark',
        accountsPath: accounts,
        timerEnabled: false,
        timerTime: '00:00'
    })
)
await session('02-home-accounts-file-set', 9342, ud2)

writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2).slice(0, 3000))
process.exit(0)
