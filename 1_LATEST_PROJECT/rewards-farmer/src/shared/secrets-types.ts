import type { ActionResult } from './farmer-types'

// Phase 10: secret fields of the engine config (webhook tokens, API key).
// RULE: a secret VALUE never travels to the renderer. The renderer only learns "set" or "not set" (rule 8).

export type SecretId =
    | 'discordUrl'
    | 'ntfyUrl'
    | 'ntfyToken'
    | 'telegramBotToken'
    | 'telegramChatId'
    | 'pushplusToken'
    | 'serverchanSendKey'
    | 'chinaApiAppkey'

export type SecretGroup = 'Discord' | 'ntfy' | 'Telegram' | 'PushPlus' | 'ServerChan' | 'China search API'

export interface SecretStatus {
    readonly id: SecretId
    readonly label: string
    readonly group: SecretGroup
    readonly help: string
    // true = a value is saved in the engine config. The value itself is never sent here.
    readonly isSet: boolean
}

export interface SecretsState {
    // ok = read from the real config. unavailable = engine not running / config missing. error = config unusable.
    readonly status: 'ok' | 'unavailable' | 'error'
    readonly reason: string | null
    readonly fields: readonly SecretStatus[]
    // null = Set / Clear allowed. A string = disabled and this is why (rule 17).
    readonly editDisabledReason: string | null
    readonly updatedAt: string
}

export const SECRETS_IPC = {
    getState: 'secrets:get-state',
    set: 'secrets:set',
    clear: 'secrets:clear'
} as const

export interface SecretsApi {
    getSecretsState(): Promise<SecretsState>
    // The value goes to the main process once and is never returned.
    setSecret(id: SecretId, value: string): Promise<ActionResult>
    clearSecret(id: SecretId): Promise<ActionResult>
}
