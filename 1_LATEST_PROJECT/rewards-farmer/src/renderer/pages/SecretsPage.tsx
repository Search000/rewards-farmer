import { SecretsCard } from '../components/SecretsCard'
import { PageCard } from '../components/PageCard'
import type { FarmerStateHook } from '../hooks/useFarmerState'

// Own sidebar page (like Logs). Holds every secret of the engine config: Discord, Telegram, ntfy, PushPlus, ServerChan
// tokens and the search API key. The page logic lives in SecretsCard / useSecrets (Phase 10); nothing here reads or
// shows a saved value.
export function SecretsPage({ farmer }: { readonly farmer: FarmerStateHook }) {
    return (
        <PageCard title="Secrets & API keys">
            <SecretsCard farmer={farmer} />
        </PageCard>
    )
}
