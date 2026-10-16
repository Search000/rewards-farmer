import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useId, useState } from 'react'
import { cleanAccountInput } from '../../shared/accounts-rules'
import type { ExistingState, FieldErrors } from '../../shared/accounts-rules'
import { EMPTY_ACCOUNT_INPUT } from '../../shared/accounts-types'
import type { AccountInput, AccountView } from '../../shared/accounts-types'
import type { ActionResult } from '../../shared/farmer-types'

interface Props {
    // null = add a new account; otherwise edit this one.
    readonly edit: AccountView | null
    // E-mails of the other accounts in the file (duplicate check, same rule the main process applies).
    readonly otherEmails: readonly string[]
    readonly onSubmit: (input: AccountInput) => Promise<ActionResult>
    readonly onClose: () => void
}

function proxyPortText(edit: AccountView): string {
    const port = edit.proxy?.port
    return port === undefined || port === null ? '' : String(port)
}

function initialInput(edit: AccountView | null): AccountInput {
    if (edit === null) return EMPTY_ACCOUNT_INPUT
    return {
        ...EMPTY_ACCOUNT_INPUT,
        email: edit.email,
        langCode: edit.langCode ?? '',
        geoLocale: edit.geoLocale ?? '',
        proxyUrl: edit.proxy?.url ?? '',
        proxyPort: proxyPortText(edit),
        proxyHttpToo: edit.proxy?.httpToo ?? false
    }
}

interface FieldProps {
    readonly label: string
    readonly value: string
    readonly onChange: (value: string) => void
    readonly error?: string | undefined
    readonly helper?: string | undefined
    readonly placeholder?: string | undefined
    readonly secret?: boolean | undefined
    readonly autoFocus?: boolean | undefined
    readonly disabled?: boolean | undefined
}

function Field({
    label,
    value,
    onChange,
    error,
    helper,
    placeholder,
    secret,
    autoFocus,
    disabled
}: FieldProps) {
    return (
        <TextField
            fullWidth
            size="small"
            label={label}
            value={value}
            type={secret === true ? 'password' : 'text'}
            {...(placeholder === undefined ? {} : { placeholder })}
            {...(autoFocus === true ? { autoFocus: true } : {})}
            disabled={disabled === true}
            error={error !== undefined}
            helperText={error ?? helper}
            onChange={(e) => onChange(e.target.value)}
            slotProps={{ htmlInput: { autoComplete: 'off', spellCheck: false } }}
        />
    )
}

interface SecretFieldProps {
    readonly label: string
    // Used in "Remove the saved ...".
    readonly noun: string
    readonly value: string
    readonly onChange: (value: string) => void
    // The account already has a saved value. Its content is never sent to the window.
    readonly saved: boolean
    readonly clear: boolean
    readonly onClear: (clear: boolean) => void
    readonly error?: string | undefined
    readonly secret: boolean
}

function SecretField({
    label,
    noun,
    value,
    onChange,
    saved,
    clear,
    onClear,
    error,
    secret
}: SecretFieldProps) {
    return (
        <Box>
            <Field
                label={label}
                value={clear ? '' : value}
                onChange={onChange}
                secret={secret}
                disabled={clear}
                error={error}
                helper={saved ? 'Saved. Leave empty to keep the saved value.' : undefined}
            />
            {saved && (
                <FormControlLabel
                    control={
                        <Checkbox size="small" checked={clear} onChange={(e) => onClear(e.target.checked)} />
                    }
                    label={`Remove the saved ${noun}`}
                />
            )}
        </Box>
    )
}

export function AccountDialog({ edit, otherEmails, onSubmit, onClose }: Props) {
    const titleId = useId()
    const [input, setInput] = useState<AccountInput>(() => initialInput(edit))
    const [submitted, setSubmitted] = useState(false)
    const [saving, setSaving] = useState(false)
    const [serverError, setServerError] = useState<string | null>(null)

    const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]): void =>
        setInput((prev) => ({ ...prev, [key]: value }))

    const existing: ExistingState | null =
        edit === null
            ? null
            : {
                  hasPassword: edit.hasPassword,
                  hasTotp: edit.hasTotp,
                  hasRecoveryEmail: edit.hasRecoveryEmail,
                  hasProxyCredentials: edit.proxy?.hasCredentials ?? false
              }
    // The same validation the main process runs. Hints show only after the first Save, so the form does not shout while typing.
    const check = cleanAccountInput(input, otherEmails, existing)
    const errors: FieldErrors = submitted && !check.ok ? check.errors : {}

    const save = async (): Promise<void> => {
        if (saving) return
        setSubmitted(true)
        setServerError(null)
        if (!check.ok) return
        setSaving(true)
        try {
            const result = await onSubmit(input)
            if (result.ok) onClose()
            else setServerError(result.message)
        } catch (e: unknown) {
            setServerError(e instanceof Error ? e.message : 'The change failed.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open {...(saving ? {} : { onClose })} fullWidth maxWidth="sm" aria-labelledby={titleId}>
            <DialogTitle id={titleId}>{edit === null ? 'Add account' : 'Edit account'}</DialogTitle>
            <Box
                component="form"
                noValidate
                onSubmit={(e) => {
                    e.preventDefault()
                    void save()
                }}
            >
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        Everything is written to your accounts file only. A backup copy is made first.
                    </Typography>
                    <Field
                        label="E-mail"
                        value={input.email}
                        onChange={(v) => set('email', v)}
                        error={errors.email}
                        autoFocus
                        helper={
                            edit === null
                                ? undefined
                                : 'Changing the e-mail does not move the saved login session of the old e-mail.'
                        }
                    />
                    <SecretField
                        label="Password"
                        noun="password"
                        secret
                        value={input.password}
                        onChange={(v) => set('password', v)}
                        saved={edit?.hasPassword ?? false}
                        clear={input.clearPassword}
                        onClear={(c) => set('clearPassword', c)}
                        error={errors.password}
                    />
                    <SecretField
                        label="2FA secret"
                        noun="2FA secret"
                        secret
                        value={input.totpSecret}
                        onChange={(v) => set('totpSecret', v)}
                        saved={edit?.hasTotp ?? false}
                        clear={input.clearTotp}
                        onClear={(c) => set('clearTotp', c)}
                        error={errors.totpSecret}
                    />
                    <SecretField
                        label="Recovery e-mail"
                        noun="recovery e-mail"
                        secret={false}
                        value={input.recoveryEmail}
                        onChange={(v) => set('recoveryEmail', v)}
                        saved={edit?.hasRecoveryEmail ?? false}
                        clear={input.clearRecovery}
                        onClear={(c) => set('clearRecovery', c)}
                        error={errors.recoveryEmail}
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Field
                            label="Language"
                            value={input.langCode}
                            onChange={(v) => set('langCode', v)}
                            error={errors.langCode}
                            placeholder="en"
                            helper="Empty = engine default (en)."
                        />
                        <Field
                            label="Region"
                            value={input.geoLocale}
                            onChange={(v) => set('geoLocale', v)}
                            error={errors.geoLocale}
                            placeholder="auto"
                            helper="Empty = engine default (auto)."
                        />
                    </Box>
                    <Typography variant="subtitle2" component="h3">
                        Proxy for this account (optional)
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Field
                            label="Proxy address"
                            value={input.proxyUrl}
                            onChange={(v) => set('proxyUrl', v)}
                            error={errors.proxyUrl}
                            placeholder="http://proxy.example.com"
                        />
                        <Box sx={{ width: 140, flexShrink: 0 }}>
                            <Field
                                label="Proxy port"
                                value={input.proxyPort}
                                onChange={(v) => set('proxyPort', v)}
                                error={errors.proxyPort}
                            />
                        </Box>
                    </Box>
                    <FormControlLabel
                        control={
                            <Checkbox
                                size="small"
                                checked={input.proxyHttpToo}
                                onChange={(e) => set('proxyHttpToo', e.target.checked)}
                            />
                        }
                        label="Also use the proxy for plain HTTP requests"
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Field
                            label="Proxy user name"
                            value={input.clearProxyCredentials ? '' : input.proxyUsername}
                            onChange={(v) => set('proxyUsername', v)}
                            disabled={input.clearProxyCredentials}
                            error={errors.proxyUsername}
                        />
                        <Field
                            label="Proxy password"
                            secret
                            value={input.clearProxyCredentials ? '' : input.proxyPassword}
                            onChange={(v) => set('proxyPassword', v)}
                            disabled={input.clearProxyCredentials}
                            error={errors.proxyPassword}
                        />
                    </Box>
                    {(edit?.proxy?.hasCredentials ?? false) && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    size="small"
                                    checked={input.clearProxyCredentials}
                                    onChange={(e) => set('clearProxyCredentials', e.target.checked)}
                                />
                            }
                            label="Remove the saved proxy user name and password"
                        />
                    )}
                    {serverError !== null && (
                        <Alert severity="error" role="alert">
                            {serverError}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        disabled={saving}
                        aria-busy={saving ? true : undefined}
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </Button>
                </DialogActions>
            </Box>
        </Dialog>
    )
}
