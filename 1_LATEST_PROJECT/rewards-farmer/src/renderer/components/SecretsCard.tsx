import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { validateSecret } from '../../shared/secrets-rules'
import type { SecretGroup, SecretId, SecretStatus } from '../../shared/secrets-types'
import { useSecrets } from '../hooks/useSecrets'
import type { FarmerStateHook } from '../hooks/useFarmerState'
import { ActionButton } from './ActionButton'
import { ConfirmDialog } from './ConfirmDialog'
import { useNotify } from './Notifications'

// Phase 10: write-only secret fields. A saved value is never shown, copied or sent back to this screen: only
// "Saved" / "Not set". There is no reveal and no copy button on purpose (threat model T4). To rotate a key, type the
// new value and press Save. The typed value lives only in this component's state and is dropped after Save.

// Follow-up to Phase 11 (user decision): this is the body of the "Secrets & API keys" page (SecretsPage). The old
// Telegram and Discord sidebar items are gone; their tokens are the first two groups here, then ntfy, PushPlus,
// ServerChan and the search API key. Groups are shown in the order of the first field of each group.

interface FieldGroup {
    readonly name: SecretGroup
    readonly fields: readonly SecretStatus[]
}

function groupFields(fields: readonly SecretStatus[]): readonly FieldGroup[] {
    const order: SecretGroup[] = ['Discord', 'Telegram', 'ntfy', 'PushPlus', 'ServerChan', 'China search API']
    return order
        .map((name) => ({ name, fields: fields.filter((f) => f.group === name) }))
        .filter((g) => g.fields.length > 0)
}

function GroupHeading({ id, name }: { readonly id: string; readonly name: string }) {
    return (
        <Typography id={id} variant="subtitle2" component="h2" sx={{ px: 1.5, pb: 1.5, pt: 0.5 }}>
            {name}
        </Typography>
    )
}

function GroupSection({ name, children }: { readonly name: string; readonly children: ReactNode }) {
    const id = useId()
    return (
        <Box component="section" aria-labelledby={id} sx={{ pb: 1 }}>
            <GroupHeading id={id} name={name} />
            {children}
            <Divider sx={{ mt: 0.5 }} />
        </Box>
    )
}

export function SecretsCard({ farmer }: { readonly farmer: FarmerStateHook }) {
    const { state, api, bridgeMissing, error, reload } = useSecrets(farmer)
    const notify = useNotify()
    const [drafts, setDrafts] = useState<Partial<Record<SecretId, string>>>({})
    const [errors, setErrors] = useState<Partial<Record<SecretId, string>>>({})
    const [busy, setBusy] = useState<SecretId | null>(null)
    const [confirmClear, setConfirmClear] = useState<SecretStatus | null>(null)

    // Typed values must not outlive the card.
    useEffect(() => () => setDrafts({}), [])

    if (bridgeMissing) {
        return (
            <Alert severity="info">
                Secrets and API keys can be saved only inside the desktop app. This page is open outside it,
                so there is no engine config to write to.
            </Alert>
        )
    }
    const lock = busy !== null ? 'Working...' : (state?.editDisabledReason ?? undefined)

    const save = async (f: SecretStatus): Promise<void> => {
        if (api === null) return
        const typed = drafts[f.id] ?? ''
        const check = validateSecret(f.id, typed)
        if (!check.ok) {
            setErrors({ ...errors, [f.id]: check.message })
            return
        }
        setBusy(f.id)
        setErrors({ ...errors, [f.id]: '' })
        try {
            const result = await api.setSecret(f.id, check.value)
            if (result.ok) {
                setDrafts({ ...drafts, [f.id]: '' })
                notify.notify(result.message, 'success')
            } else setErrors({ ...errors, [f.id]: result.message })
        } catch (e: unknown) {
            setErrors({ ...errors, [f.id]: e instanceof Error ? e.message : 'The change failed.' })
        } finally {
            setBusy(null)
            reload()
        }
    }

    const clear = async (f: SecretStatus): Promise<void> => {
        if (api === null) return
        setBusy(f.id)
        try {
            const result = await api.clearSecret(f.id)
            notify.notify(result.message, result.ok ? 'success' : 'error')
        } catch (e: unknown) {
            notify.notify(e instanceof Error ? e.message : 'The change failed.', 'error')
        } finally {
            setBusy(null)
            reload()
        }
    }

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 2 }}>
                Notification tokens (Discord, Telegram, ntfy, PushPlus, ServerChan) and the search API key.
                They are stored in the engine&apos;s config.json (the bot reads them only from there),
                readable by your Windows user only, and are never shown again after saving. To change one,
                type the new value and press Save.
            </Typography>
            {error !== null && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}
            {state === null && error === null && (
                <Typography role="status" variant="body2" sx={{ px: 1.5 }}>
                    Checking the saved secrets...
                </Typography>
            )}
            {state !== null && state.status !== 'ok' && (
                <Alert severity={state.status === 'error' ? 'error' : 'info'} sx={{ mb: 2 }}>
                    {state.reason}
                </Alert>
            )}
            {state?.status === 'ok' && state.editDisabledReason !== null && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Secrets are read-only now: {state.editDisabledReason}
                </Alert>
            )}
            {state?.status === 'ok' &&
                groupFields(state.fields).map((g) => (
                    <GroupSection key={g.name} name={g.name}>
                        {g.fields.map((f) => (
                            <Box
                                key={f.id}
                                role="group"
                                aria-label={f.label}
                                sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 1, pb: 2 }}
                            >
                                <TextField
                                    fullWidth
                                    type="password"
                                    autoComplete="off"
                                    label={f.label}
                                    value={drafts[f.id] ?? ''}
                                    placeholder={f.isSet ? 'Saved. Type a new value to replace it.' : ''}
                                    disabled={lock !== undefined}
                                    error={(errors[f.id] ?? '') !== ''}
                                    helperText={(errors[f.id] ?? '') !== '' ? errors[f.id] : (lock ?? f.help)}
                                    onChange={(e) => setDrafts({ ...drafts, [f.id]: e.target.value })}
                                />
                                <Chip
                                    size="small"
                                    color={f.isSet ? 'success' : 'default'}
                                    label={f.isSet ? 'Saved' : 'Not set'}
                                    sx={{ mt: 2 }}
                                />
                                <ActionButton
                                    variant="text"
                                    label="Save"
                                    ariaLabel={`Save ${f.label}`}
                                    busy={busy === f.id}
                                    disabledReason={
                                        lock ??
                                        ((drafts[f.id] ?? '').trim() === ''
                                            ? 'Type a value first.'
                                            : undefined)
                                    }
                                    onClick={() => void save(f)}
                                />
                                <ActionButton
                                    variant="text"
                                    label="Clear"
                                    ariaLabel={`Clear ${f.label}`}
                                    disabledReason={lock ?? (f.isSet ? undefined : 'Nothing is saved.')}
                                    onClick={() => setConfirmClear(f)}
                                />
                            </Box>
                        ))}
                    </GroupSection>
                ))}
            <ConfirmDialog
                open={confirmClear !== null}
                title={`Clear ${confirmClear?.label ?? ''}?`}
                message="The saved value is removed from config.json. A backup copy of config.json is made first. This cannot be undone from this screen."
                confirmLabel="Clear"
                onCancel={() => setConfirmClear(null)}
                onConfirm={() => {
                    const f = confirmClear
                    setConfirmClear(null)
                    if (f !== null) void clear(f)
                }}
            />
        </Box>
    )
}
