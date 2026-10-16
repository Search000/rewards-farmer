// Drives the REAL built app (dist/, unmodified) over the Chrome DevTools protocol for the Phase 12 report.
// Linux/Xvfb helper. Usage: node scripts/capture-health.mjs <outDir>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const outDir = process.argv[2] ?? 'reports/phase-12-screenshots'
const PORT = 9335
mkdirSync(outDir, { recursive: true })

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
    { stdio: 'ignore', detached: true }
)
// xvfb-run starts Electron as a child: kill the whole process group, or a stale app keeps the debug port.
const killApp = () => {
    try {
        process.kill(-app.pid, 'SIGKILL')
    } catch {
        /* already gone */
    }
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
async function shot(name, { width = 1280, height = 800 } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
    console.log('saved', name)
}
const go = async (route) => {
    await evalJs(`location.hash = '#/${route}'`)
    await sleep(900)
}

await send('Runtime.enable')
await send('Page.enable')
await sleep(1500)

const evidence = {}
evidence.exposedApiKeys = await evalJs('Object.keys(window.farmerShell)')
await go('health')
await sleep(2500) // the checks run when the page opens (they run real commands and file tests)
evidence.heading = await evalJs("document.querySelector('h1')?.textContent ?? null")
evidence.summary = await evalJs("document.querySelector('[data-testid=health-summary]')?.textContent ?? null")
evidence.rows = await evalJs(
    "Array.from(document.querySelectorAll('[data-testid^=health-row-]')).map(r => ({ id: r.dataset.testid.replace('health-row-',''), status: r.dataset.status, text: r.innerText.replace(/\\n+/g,' | ') }))"
)
await shot('01-health-page', { width: 1280, height: 1100 })
await shot('02-health-narrow', { width: 800, height: 900 })
await go('home')
await go('health')
await sleep(1500)
evidence.rowCountAfterSecondOpen = await evalJs(
    "document.querySelectorAll('[data-testid^=health-row-]').length"
)
evidence.consoleProblems = consoleProblems
writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
ws.close()
killApp()
process.exit(0)
