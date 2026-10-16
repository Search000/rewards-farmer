import type { SecretId } from '../../src/shared/secrets-types'

// FAKE values for tests only (rule 18). They never appear in the real config or in any report as real credentials.
export const FAKE: Record<SecretId, string> = {
    discordUrl: 'https://discord.com/api/webhooks/123456789012345678/FAKEdiscordTOKEN_abc-123',
    ntfyUrl: 'https://ntfy.example.com',
    ntfyToken: 'tk_FAKEntfyTOKEN12345',
    telegramBotToken: '123456789:AAFAKEtelegramTOKENtestonly1234567890ab',
    telegramChatId: '-1001234567890',
    pushplusToken: 'FAKEpushplusTOKEN1234567890',
    serverchanSendKey: 'SCTFAKEsendkey1234567890',
    chinaApiAppkey: 'FAKEappkey-test-1234'
}
