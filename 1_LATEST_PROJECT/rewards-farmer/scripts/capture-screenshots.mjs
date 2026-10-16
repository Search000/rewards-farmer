// Drives the REAL built app (dist/, unmodified) over the Chrome DevTools protocol and saves screenshots plus
// an evidence JSON. Linux/Xvfb helper for the Phase 5 report. Usage: node scripts/capture-screenshots.mjs <outDir>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const outDir = process.argv[2] ?? 'reports/phase-05-screenshots'
const PORT = 9333
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
    { stdio: 'ignore' }
)
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
async function shot(name, { width = 1280, height = 720, dsf = 1 } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile: false })
    await sleep(500)
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
    console.log('saved', name)
}
const go = async (route) => {
    await evalJs(`location.hash = '#/${route}'`)
    await sleep(400)
}

await send('Runtime.enable')
await send('Page.enable')
await sleep(1500)

const evidence = {}
evidence.title = await evalJs('document.title')
evidence.appInfoViaIpc = await evalJs('window.farmerShell.getAppInfo()')
evidence.exposedApiKeys = await evalJs('Object.keys(window.farmerShell)')
evidence.rendererHasRequire = await evalJs("typeof require !== 'undefined'")
evidence.rendererHasProcess = await evalJs("typeof process !== 'undefined'")
evidence.windowOpenReturnsNull = await evalJs("window.open('https://example.com') === null")
evidence.cspMeta = await evalJs(
    'document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\')?.content ?? null'
)
evidence.fontFamilyApplied = await evalJs('getComputedStyle(document.body).fontFamily')
evidence.bodyBackground = await evalJs('getComputedStyle(document.body).backgroundColor')

await go('home')
await shot('01-home-shell')
await go('accounts')
await shot('02-accounts-shell')
await go('settings')
await shot('03-settings-shell')
await go('about')
await shot('04-about-shell')
await go('design-system')
await shot('05-design-system-top', { height: 900 })
await evalJs("document.querySelector('main').scrollTo(0, 99999)")
await sleep(300)
await shot('06-design-system-bottom', { height: 900 })
await evalJs("document.querySelector('main').scrollTo(0, 0)")

// Open modal and a notification for evidence
await evalJs("[...document.querySelectorAll('button')].find(b => b.textContent === 'Open modal').click()")
await sleep(500)
await shot('07-modal-open')
await evalJs("[...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click()")
await sleep(400)
await evalJs("[...document.querySelectorAll('button')].find(b => b.textContent === 'Error').click()")
await sleep(500)
await shot('08-notification-error')

// Light theme (DERIVED palette, no reference screenshot)
await evalJs('document.querySelector(\'[aria-label="Switch to light theme"]\').click()')
await sleep(400)
await go('home')
await shot('09-home-light')
await evalJs('document.querySelector(\'[aria-label="Switch to dark theme"]\').click()')
await sleep(300)

// Resize behavior: narrow window collapses sidebar to an overlay
await go('home')
await shot('10-narrow-800x600', { width: 800, height: 600 })
await evalJs('document.querySelector(\'[aria-label="Toggle navigation"]\').click()')
await sleep(500)
await shot('11-narrow-overlay-open', { width: 800, height: 600 })
await evalJs('document.querySelector(\'[aria-label="Toggle navigation"]\').click()')
await sleep(300)

// High DPI (device scale factor 2)
await shot('12-home-dsf2', { width: 1280, height: 720, dsf: 2 })

evidence.consoleProblems = consoleProblems
writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))

ws.close()
app.kill('SIGTERM')
await sleep(500)
process.exit(0)
