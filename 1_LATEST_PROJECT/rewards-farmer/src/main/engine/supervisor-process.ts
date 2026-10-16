import { spawn } from 'node:child_process'

const IS_WIN = process.platform === 'win32'

export function killTree(pid: number): void {
    try {
        if (IS_WIN) {
            const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            child.on('error', () => undefined)
        } else {
            try {
                process.kill(-pid, 'SIGKILL')
            } catch {
                process.kill(pid, 'SIGKILL')
            }
        }
    } catch {
        // process already gone
    }
}

export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}
