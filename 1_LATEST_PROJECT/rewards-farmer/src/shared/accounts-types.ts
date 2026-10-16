import type { ActionResult } from './farmer-types'

// Types shared by main, preload and renderer for the Accounts screen (Phase 7).
// Rule 3: everything here comes from the real accounts `.env` file on disk. Secret VALUES never appear in these types,
// only "is it saved" flags (docs/architecture.md section 5, threat model T4).

export const ACCOUNTS_IPC = {
    getState: 'accounts:get-state',
    add: 'accounts:add',
    update: 'accounts:update',
    remove: 'accounts:remove'
} as const

export interface AccountProxyView {
    // Address as written in the file, with any `user:pass@` part removed.
    readonly url: string
    readonly port: number | null
    // ACCOUNT_N_PROXY_HTTP: the engine also uses the proxy for its plain HTTP requests.
    readonly httpToo: boolean
    readonly hasCredentials: boolean
}

export interface AccountView {
    // N in ACCOUNT_N_*. Stable identifier inside the file.
    readonly slot: number
    readonly email: string
    readonly hasPassword: boolean
    readonly hasTotp: boolean
    readonly hasRecoveryEmail: boolean
    // null = the line is not in the file; the engine then uses its defaults ("en" and "auto").
    readonly langCode: string | null
    readonly geoLocale: string | null
    readonly proxy: AccountProxyView | null
    // Reasons the engine itself would reject this account (same rules as the engine's validator). Empty = no problem found.
    readonly problems: readonly string[]
}

export interface AccountsState {
    readonly status: 'not-set' | 'ok' | 'error'
    readonly path: string | null
    readonly error: string | null
    readonly accounts: readonly AccountView[]
    // null = Add / Edit / Remove allowed. A string = they are disabled and this is why (rule 17).
    readonly editDisabledReason: string | null
    // Time of the newest backup made by this app session or found in the backup folder; null = no backup yet.
    readonly lastBackupAt: string | null
    readonly updatedAt: string
}

// What the Add / Edit dialog sends. Renderer data is untrusted: main validates every field again.
// For secrets, an empty string on EDIT means "keep the saved value"; the `clear*` flag removes it.
export interface AccountInput {
    readonly email: string
    readonly password: string
    readonly clearPassword: boolean
    readonly totpSecret: string
    readonly clearTotp: boolean
    readonly recoveryEmail: string
    readonly clearRecovery: boolean
    // Empty = remove the line, the engine default applies ("en" / "auto").
    readonly langCode: string
    readonly geoLocale: string
    // Empty proxyUrl = no proxy for this account.
    readonly proxyUrl: string
    readonly proxyPort: string
    readonly proxyHttpToo: boolean
    readonly proxyUsername: string
    readonly proxyPassword: string
    readonly clearProxyCredentials: boolean
}

export const EMPTY_ACCOUNT_INPUT: AccountInput = {
    email: '',
    password: '',
    clearPassword: false,
    totpSecret: '',
    clearTotp: false,
    recoveryEmail: '',
    clearRecovery: false,
    langCode: '',
    geoLocale: '',
    proxyUrl: '',
    proxyPort: '',
    proxyHttpToo: false,
    proxyUsername: '',
    proxyPassword: '',
    clearProxyCredentials: false
}

export interface AccountsApi {
    getAccountsState(): Promise<AccountsState>
    addAccount(input: AccountInput): Promise<ActionResult>
    // expectedEmail guards against a stale list: main refuses when the slot now holds a different account.
    updateAccount(slot: number, expectedEmail: string, input: AccountInput): Promise<ActionResult>
    removeAccount(slot: number, expectedEmail: string): Promise<ActionResult>
}
