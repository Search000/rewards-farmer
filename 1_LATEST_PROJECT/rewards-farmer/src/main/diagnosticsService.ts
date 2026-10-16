import { randomBytes } from 'node:crypto'
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { arch, cpus, homedir, platform, release, totalmem, version as osVersion } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
    BUNDLE_SCHEMA,
    LOG_FILES,
    LOG_TAIL_MAX_BYTES,
    LOG_TAIL_MAX_LINES,
    MAX_BUNDLE_BYTES,
    MAX_CONFIG_BYTES,
    Scrubber,
    cleanConfig,
    defaultBundleName,
    ensureZipName,
    healthText,
    tailLines,
    writeFailureMessage
} from '../shared/diagnostics-rules'
import type { LogFileReport } from '../shared/diagnostics-rules'
import { EXPORT_CANCELLED_MESSAGE } from '../shared/diagnostics-types'
import type { ActionResult, FarmerState, PersistedSettings } from '../shared/farmer-types'
import { summaryText } from '../shared/health-rules'
import type { HealthState } from '../shared/health-types'
import type { JsonlLog } from './jsonlLog'
import { buildZip } from './zipWriter'
import type { ZipEntry } from './zipWriter'

// Phase 14: diagnostics bundle export. One ZIP with versions, the engine config with secrets hidden, the health results and the
// newest lines of the app / engine / errors logs. Rules it keeps:
//   - It never reads the accounts file (.env), the sessions folder or the secrets: those are not in the list of things it reads.
//   - Every piece of text is cleaned (Scrubber) and the finished contents are checked a second time (Scrubber.verify). If the
//     check finds anything, NOTHING is saved.
//   - It reads only the END of each log file, so a huge log is harmless.
//   - The file is written to a temporary name next to the target and renamed when complete, so a half-written bundle never
//     looks like a real one; on any failure the temporary file is removed.
//   - A missing or unreadable part is reported inside the bundle; it does not stop the export.

export interface DiagnosticsDeps {
    readonly appInfo: () => {
        readonly name: string
        readonly version: string
        readonly electron: string
        readonly chrome: string
        readonly isPackaged: boolean
    }
    readonly engineRoot: string
    // Folder with app.log, engine.log, errors.log (and audit.log, which is NOT included).
    readonly logsDir: string
    // ENGINE_PIN file (the engine commit this app was made for). null = unknown.
    readonly enginePinPath: string | null
    readonly settings: () => PersistedSettings
    readonly farmerState: () => FarmerState
    readonly runHealth: () => Promise<HealthState>
    readonly redact: (text: string) => string
    readonly containsKnownSecret: (text: string) => boolean
    readonly audit: JsonlLog
    readonly appLog: JsonlLog
    // Opens the OS save dialog. Returns null when the user cancels.
    readonly pickSavePath: (defaultName: string) => Promise<string | null>
    // Tests replace these with isolated stand-ins.
    readonly writeBundle?: (path: string, data: Buffer) => Promise<void>
    readonly homeDirs?: () => readonly string[]
    readonly now?: () => Date
    readonly maxBundleBytes?: number
    readonly logTailBytes?: number
    readonly logTailLines?: number
    readonly healthTimeoutMs?: number
}

// Writes next to the target under a temporary name, then renames. A failure leaves no temporary file behind.
export async function writeFileAtomic(path: string, data: Buffer): Promise<void> {
    const tmp = `${path}.rf-tmp-${randomBytes(4).toString('hex')}`
    try {
        await writeFile(tmp, data, { flag: 'wx' })
        await rename(tmp, path)
    } catch (error) {
        await rm(tmp, { force: true }).catch(() => undefined)
        throw error
    }
}

type TailRead =
    | { readonly status: 'missing' }
    | { readonly status: 'unreadable'; readonly code: string }
    | { readonly status: 'read'; readonly size: number; readonly chunk: string; readonly fromMiddle: boolean }

// Reads only the last `maxBytes` of a file.
export async function readTail(path: string, maxBytes: number): Promise<TailRead> {
    let handle
    try {
        handle = await open(path, 'r')
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? 'UNKNOWN'
        return code === 'ENOENT' ? { status: 'missing' } : { status: 'unreadable', code }
    }
    try {
        const info = await handle.stat()
        if (!info.isFile()) return { status: 'unreadable', code: 'NOT_A_FILE' }
        const start = Math.max(0, info.size - maxBytes)
        const length = info.size - start
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, start)
        return {
            status: 'read',
            size: info.size,
            chunk: buffer.subarray(0, bytesRead).toString('utf8'),
            fromMiddle: start > 0
        }
    } catch (e) {
        return { status: 'unreadable', code: (e as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
    } finally {
        await handle.close().catch(() => undefined)
    }
}

const fail = (code: ActionResult['code'], message: string): ActionResult => ({ ok: false, code, message })

function kb(bytes: number): string {
    return bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type BuildOutcome =
    | { readonly ok: true; readonly zip: Buffer; readonly files: number }
    | { readonly ok: false; readonly result: ActionResult }

export class DiagnosticsService {
    private busy = false

    constructor(private readonly deps: DiagnosticsDeps) {}

    private now(): Date {
        return this.deps.now ? this.deps.now() : new Date()
    }

    async exportBundle(): Promise<ActionResult> {
        if (this.busy) return fail('BAD_REQUEST', 'An export is already running. Wait until it has finished.')
        this.busy = true
        try {
            return await this.exportOnce()
        } finally {
            this.busy = false
        }
    }

    private async exportOnce(): Promise<ActionResult> {
        // 1. Ask where to save first, so the window opens at once (collecting the health results can take a few seconds).
        let picked: string | null
        try {
            picked = await this.deps.pickSavePath(defaultBundleName(this.now()))
        } catch {
            return this.failed('EXPORT_FAILED', 'The save window could not be opened. Nothing was saved.')
        }
        if (picked === null) return { ok: false, message: EXPORT_CANCELLED_MESSAGE }
        const target = ensureZipName(picked)
        if (!isAbsolute(target))
            return fail('BAD_REQUEST', 'The save place is not valid. Choose a folder such as Documents.')

        // 2. Collect, clean and check.
        let built: BuildOutcome
        try {
            built = await this.build()
        } catch (error) {
            const why = error instanceof Error ? this.deps.redact(error.message) : 'unexpected error'
            return this.failed('EXPORT_FAILED', `The bundle could not be built (${why}). Nothing was saved.`)
        }
        if (!built.ok) return built.result

        // 3. Write it. The temporary file is removed on every failure.
        try {
            await (this.deps.writeBundle ?? writeFileAtomic)(target, built.zip)
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            return this.failed('WRITE_FAILED', writeFailureMessage(code, target), code)
        }
        this.deps.audit.write({
            level: 'info',
            component: 'DiagnosticsService',
            action: 'export-diagnostics',
            result: 'ok',
            message: `Exported a diagnostics bundle (${String(built.files)} files, ${kb(built.zip.length)}).`
        })
        return {
            ok: true,
            message: `Saved the diagnostics bundle (${String(built.files)} files, ${kb(built.zip.length)}) to ${target}. The automatic safety check found no secrets in it.`
        }
    }

    private failed(code: ActionResult['code'], message: string, detail?: string): ActionResult {
        this.deps.audit.write({
            level: 'warn',
            component: 'DiagnosticsService',
            action: 'export-diagnostics',
            result: 'failed',
            message: `Diagnostics export failed (${code ?? 'unknown'}${detail === undefined ? '' : `, ${detail}`}).`
        })
        return fail(code, message)
    }

    // ---- collecting ---------------------------------------------------------------------------------------------------

    private async build(): Promise<BuildOutcome> {
        const now = this.now()
        const scrub = new Scrubber({
            redact: this.deps.redact,
            containsKnownSecret: this.deps.containsKnownSecret,
            homeDirs: this.deps.homeDirs ? this.deps.homeDirs() : [homedir()]
        })

        const [health, config, logs, pin, enginePackage] = await Promise.all([
            this.collectHealth(),
            this.collectConfig(scrub),
            this.collectLogs(scrub, now),
            this.readEnginePin(),
            this.readEnginePackageVersion()
        ])

        const app = this.deps.appInfo()
        const farmer = this.deps.farmerState()
        const settings = this.deps.settings()
        const doc = {
            schema: BUNDLE_SCHEMA,
            createdAt: now.toISOString(),
            app: {
                name: app.name,
                version: app.version,
                packaged: app.isPackaged,
                electron: app.electron,
                chrome: app.chrome,
                electronNode: process.versions.node
            },
            system: {
                platform: platform(),
                osRelease: release(),
                osVersion: osVersion(),
                arch: arch(),
                cpuCount: cpus().length,
                totalMemoryGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10
            },
            engine: {
                processState: farmer.engine.link,
                processDetail: farmer.engine.detail,
                runningVersion: farmer.engine.version,
                versionInFiles: enginePackage
            },
            run: { phase: farmer.run.phase, lastExit: farmer.run.lastExit },
            accounts: {
                fileChosen: farmer.accounts.path !== null,
                status: farmer.accounts.status,
                count: farmer.accounts.count,
                error: farmer.accounts.error
            },
            appSettings: {
                themeMode: settings.themeMode,
                timerEnabled: settings.timerEnabled,
                timerTime: settings.timerTime,
                shutdownAfterRun: settings.shutdownAfterRun
            },
            engineConfig: config,
            health:
                health === null
                    ? { status: 'unavailable', reason: 'The health checks did not finish in time or failed.' }
                    : {
                          status: 'done',
                          startedAt: health.startedAt,
                          finishedAt: health.finishedAt,
                          summary: summaryText(health.checks),
                          checks: health.checks.map((c) => ({
                              id: c.id,
                              title: c.title,
                              status: c.status,
                              detail: c.detail,
                              fix: c.fix,
                              checkedAt: c.checkedAt
                          }))
                      },
            logs: logs.reports,
            notIncluded: [
                'The accounts file (.env), passwords, 2FA secrets, recovery e-mails and proxy logins',
                'Webhook addresses, bot tokens and API keys (only "set" or "not set" is shown)',
                'The engine sessions folder, cookies and browser data',
                'audit.log (it records what you changed in the app)'
            ]
        }
        const cleaned = scrub.value(doc) as Record<string, unknown>
        // The pinned engine commit is a long hex number that the scrubber would hide; it is read from ENGINE_PIN and
        // only accepted when it is exactly 40 hex characters.
        const engine = cleaned['engine'] as Record<string, unknown>
        engine['pinnedCommit'] = pin

        const entries: { name: string; text: string }[] = [
            { name: 'diagnostics.json', text: `${JSON.stringify(cleaned, null, 2)}\n` },
            {
                name: 'health.txt',
                text:
                    health === null
                        ? 'The health checks did not finish in time or failed, so there is no result.\n'
                        : `${healthText(health, scrub)}\n`
            },
            ...logs.entries
        ]

        // Second, independent check of the finished contents. One finding = nothing is saved.
        const problems = new Set<string>()
        for (const e of entries) for (const p of scrub.verify(e.text)) problems.add(p)
        if (problems.size > 0) {
            const kinds = [...problems].join(', ')
            this.deps.audit.write({
                level: 'warn',
                component: 'DiagnosticsService',
                action: 'export-diagnostics',
                result: 'blocked',
                message: `Diagnostics export blocked by the safety check (${kinds}).`
            })
            this.deps.appLog.write({
                level: 'warn',
                component: 'DiagnosticsService',
                message: `diagnostics export blocked by the safety check (${kinds})`
            })
            return {
                ok: false,
                result: fail(
                    'EXPORT_BLOCKED',
                    `The bundle was NOT saved. The automatic safety check found something that looks like ${kinds} in it. Nothing was written to your disk.`
                )
            }
        }

        const readme = this.readme(
            entries.map((e) => e.name),
            scrub.emailCount,
            now
        )
        const readmeProblems = scrub.verify(readme)
        if (readmeProblems.length > 0)
            return {
                ok: false,
                result: this.failed('EXPORT_BLOCKED', 'The bundle was NOT saved. The safety check failed.')
            }
        const all = [{ name: 'README.txt', text: readme }, ...entries]
        const zip = buildZip(
            all.map((e): ZipEntry => ({ name: e.name, data: Buffer.from(e.text, 'utf8'), modified: now }))
        )
        const limit = this.deps.maxBundleBytes ?? MAX_BUNDLE_BYTES
        if (zip.length > limit)
            return {
                ok: false,
                result: this.failed(
                    'EXPORT_FAILED',
                    `The bundle would be ${kb(zip.length)}, which is more than the allowed ${kb(limit)}. Nothing was saved.`
                )
            }
        return { ok: true, zip, files: all.length }
    }

    private async collectHealth(): Promise<HealthState | null> {
        const limit = this.deps.healthTimeoutMs ?? 30000
        let timer: NodeJS.Timeout | undefined
        try {
            const timeout = new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), limit)
            })
            return await Promise.race([this.deps.runHealth(), timeout])
        } catch {
            return null
        } finally {
            if (timer !== undefined) clearTimeout(timer)
        }
    }

    private async collectConfig(scrub: Scrubber): Promise<Record<string, unknown>> {
        const path = join(this.deps.engineRoot, 'config.json')
        let text: string
        try {
            const info = await stat(path)
            if (info.size > MAX_CONFIG_BYTES)
                return { status: 'too-large', reason: 'config.json is bigger than 1 MB, so it was not read.' }
            text = await readFile(path, 'utf8')
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code
            if (code === 'ENOENT') return { status: 'missing', reason: 'config.json does not exist yet.' }
            return {
                status: 'unreadable',
                reason: `config.json could not be read (${code ?? 'read error'}).`
            }
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
        } catch {
            // The parser message can quote part of the file, so it is not used.
            return {
                status: 'invalid-json',
                reason: 'config.json is not valid JSON. Its content is not included.'
            }
        }
        return { status: 'ok', config: cleanConfig(parsed, scrub) }
    }

    private async collectLogs(
        scrub: Scrubber,
        now: Date
    ): Promise<{ reports: LogFileReport[]; entries: { name: string; text: string }[] }> {
        const maxBytes = this.deps.logTailBytes ?? LOG_TAIL_MAX_BYTES
        const maxLines = this.deps.logTailLines ?? LOG_TAIL_MAX_LINES
        const reports: LogFileReport[] = []
        const entries: { name: string; text: string }[] = []
        for (const def of LOG_FILES) {
            const read = await readTail(join(this.deps.logsDir, def.file), maxBytes)
            if (read.status === 'missing') {
                reports.push({
                    file: def.file,
                    status: 'missing',
                    sizeBytes: null,
                    linesIncluded: 0,
                    olderLinesLeftOut: false,
                    code: null
                })
                continue
            }
            if (read.status === 'unreadable') {
                reports.push({
                    file: def.file,
                    status: 'unreadable',
                    sizeBytes: null,
                    linesIncluded: 0,
                    olderLinesLeftOut: false,
                    code: read.code
                })
                continue
            }
            const tail = tailLines(read.chunk, read.fromMiddle, maxLines)
            const cleanLines = tail.lines.map((l) => scrub.text(l))
            reports.push({
                file: def.file,
                status: read.size === 0 ? 'empty' : 'included',
                sizeBytes: read.size,
                linesIncluded: cleanLines.length,
                olderLinesLeftOut: tail.cut,
                code: null
            })
            if (cleanLines.length === 0) continue
            const header = `# ${def.label}: newest ${String(cleanLines.length)} line(s) of ${def.file}${tail.cut ? ' (older lines are not included)' : ''}. Made ${now.toISOString()}. Secrets, e-mail addresses and IP addresses are hidden.`
            entries.push({ name: def.entry, text: `${[header, ...cleanLines].join('\n')}\n` })
        }
        return { reports, entries }
    }

    private async readEnginePin(): Promise<string | null> {
        if (this.deps.enginePinPath === null) return null
        try {
            const text = (await readFile(this.deps.enginePinPath, 'utf8')).trim()
            return /^[0-9a-f]{40}$/.test(text) ? text : null
        } catch {
            return null
        }
    }

    private async readEnginePackageVersion(): Promise<string | null> {
        try {
            const pkg = JSON.parse(await readFile(join(this.deps.engineRoot, 'package.json'), 'utf8')) as {
                version?: unknown
            }
            return typeof pkg.version === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(pkg.version)
                ? pkg.version
                : null
        } catch {
            return null
        }
    }

    private readme(files: readonly string[], emails: number, now: Date): string {
        const lines = [
            'Rewards Farmer LUCK - diagnostics bundle',
            `Made at ${now.toISOString()}`,
            '',
            'WHAT THIS FILE IS',
            'A summary of the state of the app, made to help someone find a problem. You can open every file in it with Notepad.',
            '',
            'WHAT IS INSIDE',
            '  diagnostics.json  versions, the engine settings with every secret hidden, accounts status (numbers only), health results, log file report',
            '  health.txt        the health checks as readable text, with what to do for each problem',
            ...files
                .filter((f) => f.startsWith('logs/'))
                .map((f) => `  ${f.padEnd(18)}the newest lines of that log, cleaned`),
            '',
            'WHAT WAS LEFT OUT OR HIDDEN',
            '  - The accounts file, passwords, 2FA secrets, recovery e-mails and proxy logins are never read.',
            '  - Webhook addresses, bot tokens and API keys show only "set" or "not set".',
            '  - Sessions, cookies and browser data are never read.',
            `  - E-mail addresses are replaced by <email-1>, <email-2> ... (the same number is the same address). ${String(emails)} address(es) were replaced.`,
            '  - IP addresses are replaced by <ip>. Your Windows user name in folder paths is replaced by <user> or <home>.',
            '  - audit.log is not included.',
            '',
            'AUTOMATIC SAFETY CHECK',
            'Before this file was saved the app looked at every file in it a second time for secrets, tokens, cookies, e-mail addresses and IP addresses. It found none. If it had found something, this file would not have been saved at all.',
            'No program can promise it finds every possible secret. Open the files and look before you send them, and send them only to a person you trust.'
        ]
        return `${lines.join('\n')}\n`
    }
}
