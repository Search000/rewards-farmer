import { execFile } from 'node:child_process'
import { chmod } from 'node:fs/promises'
import { userInfo } from 'node:os'

// Phase 10: make a file or folder that can hold secrets readable by the current user only.
// POSIX: chmod 600 / 700. Windows: icacls, remove inherited rights and grant the current user only.
// Best effort: the result says what happened and callers log it (never the secret itself).

export interface PermsResult {
    readonly ok: boolean
    readonly detail: string
}

export interface PermsDeps {
    readonly platform?: NodeJS.Platform
    readonly username?: string
    // Runs a program with an argument list (no shell). Rejects on a non-zero exit.
    readonly run?: (file: string, args: readonly string[]) => Promise<void>
}

function defaultRun(file: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(file, [...args], { windowsHide: true, timeout: 15000 }, (error) => {
            if (error === null) resolve()
            else reject(error)
        })
    })
}

export async function restrictToCurrentUser(
    path: string,
    isDir: boolean,
    deps: PermsDeps = {}
): Promise<PermsResult> {
    const platform = deps.platform ?? process.platform
    try {
        if (platform === 'win32') {
            const user = deps.username ?? userInfo().username
            const grant = isDir ? `${user}:(OI)(CI)F` : `${user}:F`
            await (deps.run ?? defaultRun)('icacls', [path, '/inheritance:r', '/grant:r', grant])
            return { ok: true, detail: 'Windows permissions limited to the current user.' }
        }
        await chmod(path, isDir ? 0o700 : 0o600)
        return { ok: true, detail: 'File mode limited to the current user.' }
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        return {
            ok: false,
            detail: `Could not limit permissions${typeof code === 'string' ? ` (${code})` : ''}.`
        }
    }
}
