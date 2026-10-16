import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { killTree, isProcessAlive } from './supervisor-process'

// If the app is force-killed (task manager, `kill -9`, power loss) it cannot stop the engine API child, which keeps
// running. The supervisor records the child's PID in a small file and, at the next start, stops that process, but ONLY
// when the process command line proves it is our engine server. A recycled PID that belongs to anything else is never
// killed (rule 12: no destructive action on something we cannot identify).

export type ReapResult = 'none' | 'gone' | 'killed' | 'unverified'

export interface ReapDeps {
    readonly isAlive: (pid: number) => boolean
    readonly commandLineOf: (pid: number) => Promise<string | null>
    readonly kill: (pid: number) => void
    readonly log: (level: 'info' | 'warn', message: string) => void
}

export async function writePidFile(file: string, pid: number, serverPath: string): Promise<void> {
    await writeFile(file, JSON.stringify({ pid, serverPath }), 'utf8')
}

export async function removePidFile(file: string): Promise<void> {
    await rm(file, { force: true })
}

export function commandLineOf(pid: number): Promise<string | null> {
    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`],
                { timeout: 8000, windowsHide: true },
                (error, stdout) => resolve(error !== null || stdout.trim() === '' ? null : stdout.trim())
            )
        })
    }
    return readFile(`/proc/${String(pid)}/cmdline`, 'utf8').then(
        (text) => text.split('\0').join(' ').trim(),
        () => null
    )
}

export const DEFAULT_REAP_DEPS = (log: ReapDeps['log']): ReapDeps => ({ isAlive: isProcessAlive, commandLineOf, kill: killTree, log })

export async function reapStaleEngine(pidFile: string, deps: ReapDeps): Promise<ReapResult> {
    let text: string
    try {
        text = await readFile(pidFile, 'utf8')
    } catch {
        return 'none'
    }
    let pid = 0
    let serverPath = ''
    try {
        const o = JSON.parse(text) as { pid?: unknown; serverPath?: unknown }
        if (typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 1) pid = o.pid
        if (typeof o.serverPath === 'string') serverPath = o.serverPath
    } catch {
        // corrupt file: nothing to trust
    }
    await removePidFile(pidFile)
    if (pid === 0 || serverPath === '' || !deps.isAlive(pid)) return 'gone'
    const cmd = await deps.commandLineOf(pid)
    if (cmd !== null && cmd.replaceAll('\\', '/').includes(serverPath.replaceAll('\\', '/'))) {
        deps.kill(pid)
        deps.log('warn', `Stopped a leftover engine process (pid ${String(pid)}) from a previous app session.`)
        return 'killed'
    }
    deps.log('warn', `A process with pid ${String(pid)} from a previous session is still alive but could not be identified as the engine, so it was NOT stopped.`)
    return 'unverified'
}
