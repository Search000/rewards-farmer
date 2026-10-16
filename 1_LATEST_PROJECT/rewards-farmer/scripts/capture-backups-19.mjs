// Drives the REAL built app (dist/, unmodified) over the Chrome DevTools protocol for the Phase 19 report.
// Linux/Xvfb helper. It uses a throw-away user-data folder (XDG_CONFIG_HOME) and a FAKE accounts file, so no real data is touched.
// It needs engine/config.json: if there is none, it makes a temporary copy of config.example.json and removes it at the end.
// Usage: node scripts/capture-backups-19.mjs <outDir>
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const outDir = process.argv[2] ?? 'reports/phase-19-screenshots'
const PORT = 9341
mkdirSync(outDir, { recursive: true })

const work = mkdtempSync(join(tmpdir(), 'rf-capture19-'))
const cfgHome = join(work, 'cfg')
const userData = join(cfgHome, 'Rewards Farmer LUCK')
mkdirSync(userData, { recursive: true })
const accountsFile = join(work, 'FAKE-accounts.env')
writeFileSync(
    accountsFile,
    'ACCOUNT_1_EMAIL=alpha@example.com\nACCOUNT_1_PASSWORD=fake-pw-capture-only\nACCOUNT_2_EMAIL=beta@example.com\nACCOUNT_2_PASSWORD=fake-pw-capture-only2\n'
)
writeFileSync(
    join(userData, 'app-settings.json'),
    JSON.stringify({
        schemaVersion: 2,
        themeMode: 'dark',
        accountsPath: accountsFile,
        timerEnabled: false,
        timerTime: '00:00',
        shutdownAfterRun: false
    })
)
const engineConfig = join('engine', 'config.json')
const madeConfig = !existsSync(engineConfig)
if (madeConfig) copyFileSync(join('engine', 'config.example.json'), engineConfig)

const app = spawn(
    'xvfb-run',
    [
        '-a',
        '-s',
        '-screen 0 1600x1400x24',
        'node_modules/.bin/electron',
        '.',
        '--no-sandbox',
        `--remote-debugging-port=${PORT}`
    ],
    { stdio: 'ignore', detached: true, env: { ...process.env, XDG_CONFIG_HOME: cfgHome } }
)
const cleanup = () => {
    try {
        process.kill(-app.pid, 'SIGKILL')
    } catch {
        /* already gone */
    }
    if (madeConfig) rmSync(engineConfig, { force: true })
    rmSync(work, { recursive: true, force: true })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForTarget() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
            const page = list.find((t) => t.type === 'page')
            if (page) return page
        } catch {
            /* not up yet */
        }
        await sleep(500)
    }
    throw new Error('Electron page target never appeared')
}

const target = await waitForTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
})
let id = 0
const pending = new Map()
const consoleProblems = []
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleProblems.push(msg.params.exceptionDetails.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        consoleProblems.push(
            `${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`
        )
    }
}
const send = (method, params = {}) =>
    new Promise((res) => {
        const myId = ++id
        pending.set(myId, res)
        ws.send(JSON.stringify({ id: myId, method, params }))
    })
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return r.result?.result?.value
}
async function shot(name, { width = 1280, height = 900 } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
    console.log('saved', name)
}
const clickButton = (label) =>
    evalJs(
        `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(label)} || x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`
    )
const text = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`)

await send('Runtime.enable')
await send('Page.enable')
await sleep(2000)

const evidence = {}
await evalJs("location.hash = '#/backups'")
await sleep(2500)
evidence.emptySummary = await text('[data-testid=backup-summary]')
await shot('01-backups-empty', { height: 800 })

evidence.clickedCreate = await clickButton('Create backup')
await sleep(3500)
evidence.createResult = await text('[data-testid=backup-result]')
evidence.summaryAfterCreate = await text('[data-testid=backup-summary]')
evidence.statuses = await evalJs(
    "Array.from(document.querySelectorAll('[data-testid^=backup-status-]')).map((c) => c.innerText)"
)
await shot('02-backups-created', { height: 900 })

evidence.clickedInspect = await evalJs(
    "(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') ?? '').startsWith('Inspect backup')); if (!b) return false; b.click(); return true })()"
)
await sleep(1500)
evidence.detailCheck = await text('[data-testid=backup-detail-check]')
evidence.detailFiles = await evalJs(
    "Array.from(document.querySelectorAll('[data-testid^=backup-file-]')).map((c) => c.innerText)"
)
await shot('03-backups-inspect', { height: 1000 })
await evalJs(
    "Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Close')?.click()"
)
await sleep(600)

// Damage the real backup on the disk (remove one file), then press Check again in the real window.
const full = join(userData, 'backups', 'full')
const folders = existsSync(full) ? readdirSync(full).filter((n) => n.startsWith('backup-')) : []
evidence.backupFolders = folders.length
if (folders[0] !== undefined) rmSync(join(full, folders[0], 'accounts.env'), { force: true })
evidence.clickedCheckAgain = await clickButton('Check again')
await sleep(2500)
evidence.summaryAfterDamage = await text('[data-testid=backup-summary]')
evidence.statusesAfterDamage = await evalJs(
    "Array.from(document.querySelectorAll('[data-testid^=backup-status-]')).map((c) => c.innerText)"
)
await shot('04-backups-damaged', { height: 900 })
await evalJs(
    "(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') ?? '').startsWith('Inspect backup')); b?.click() })()"
)
await sleep(1500)
evidence.damagedDetail = await text('[data-testid=backup-detail-check]')
await shot('05-backups-inspect-damaged', { height: 1000 })

evidence.consoleProblems = consoleProblems
writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
ws.close()
cleanup()
process.exit(0)
