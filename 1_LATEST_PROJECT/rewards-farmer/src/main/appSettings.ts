import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, isValidTime } from '../shared/farmer-types'
import type { PersistedSettings } from '../shared/farmer-types'

// App preferences (docs/architecture.md section 3): `<userData>/app-settings.json`, versioned, atomic writes.
// Holds NO secrets. Only theme, the accounts file PATH, and the timer.

export interface LoadedSettings {
    readonly settings: PersistedSettings
    // Set when the file was unreadable/corrupt and defaults were used (the bad file is kept as a backup).
    readonly notice: string | null
}

export function sanitizeSettings(raw: unknown): PersistedSettings {
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    return {
        schemaVersion: 2,
        themeMode: o['themeMode'] === 'light' ? 'light' : 'dark',
        accountsPath:
            typeof o['accountsPath'] === 'string' && o['accountsPath'] !== '' ? o['accountsPath'] : null,
        timerEnabled: o['timerEnabled'] === true,
        timerTime:
            typeof o['timerTime'] === 'string' && isValidTime(o['timerTime'])
                ? o['timerTime']
                : DEFAULT_SETTINGS.timerTime,
        shutdownAfterRun: o['shutdownAfterRun'] === true
    }
}

export class AppSettingsStore {
    private readonly file: string
    private current: PersistedSettings = DEFAULT_SETTINGS

    constructor(
        private readonly dir: string,
        private readonly now: () => number = Date.now
    ) {
        this.file = join(dir, 'app-settings.json')
    }

    get value(): PersistedSettings {
        return this.current
    }

    async load(): Promise<LoadedSettings> {
        let text: string
        try {
            text = await readFile(this.file, 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                // No file = the defaults. (Phase 21: when the app reads the file again after a restore or an undo that removed
                // it, the values from before must not stay in memory.)
                this.current = DEFAULT_SETTINGS
                return { settings: this.current, notice: null }
            }
            return {
                settings: this.current,
                notice: 'The app settings file could not be read. Defaults are used.'
            }
        }
        try {
            const parsed = JSON.parse(text) as unknown
            this.current = sanitizeSettings(parsed)
            const oldVersion =
                typeof parsed === 'object' && parsed !== null
                    ? (parsed as Record<string, unknown>)['schemaVersion']
                    : undefined
            if (oldVersion !== 2) return await this.migrate(oldVersion)
            return { settings: this.current, notice: null }
        } catch {
            const backup = join(this.dir, `app-settings.corrupt-${String(this.now())}.json`)
            let kept = ''
            try {
                await rename(this.file, backup)
                kept = ' The unreadable file was kept as a backup next to it.'
            } catch {
                // keep going with defaults
            }
            return {
                settings: this.current,
                notice: `The app settings file was corrupt. Defaults are used.${kept}`
            }
        }
    }

    // Schema migration (Phase 8: schema 1 -> 2 adds `shutdownAfterRun`). The old file is copied first and never overwritten;
    // if the copy fails, the old file stays as it is and the new defaults are used in memory only.
    private async migrate(oldVersion: unknown): Promise<LoadedSettings> {
        const backup = join(
            this.dir,
            `app-settings.schema${String(oldVersion ?? 'unknown')}-${String(this.now())}.json`
        )
        try {
            await copyFile(this.file, backup)
        } catch {
            return {
                settings: this.current,
                notice: 'The app settings file is from an older version and could not be backed up, so it was not upgraded.'
            }
        }
        try {
            await this.write(this.current)
        } catch {
            return {
                settings: this.current,
                notice: `The app settings file could not be upgraded. The old file is kept as it was (copy: ${backup}).`
            }
        }
        return { settings: this.current, notice: null }
    }

    private async write(next: PersistedSettings): Promise<void> {
        await mkdir(this.dir, { recursive: true })
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, `${JSON.stringify(next, null, 4)}\n`, 'utf8')
        await rename(tmp, this.file)
    }

    // Atomic: write a temp file, then rename over the real one (threat model T6).
    async update(patch: Partial<Omit<PersistedSettings, 'schemaVersion'>>): Promise<void> {
        const next = sanitizeSettings({ ...this.current, ...patch })
        await this.write(next)
        this.current = next
    }
}
