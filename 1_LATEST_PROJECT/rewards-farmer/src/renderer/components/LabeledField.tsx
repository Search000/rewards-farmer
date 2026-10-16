import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import type { ReactNode } from 'react'

interface Props {
    readonly label: string
    readonly value: string
    readonly icon?: ReactNode | undefined
    // Right-side action (for example an "Open" button).
    readonly action?: ReactNode | undefined
    readonly onChange?: ((value: string) => void) | undefined
    readonly readOnly?: boolean | undefined
    readonly disabledReason?: string | undefined
    readonly error?: string | undefined
    readonly helperText?: string | undefined
}

// Icon + outlined field + optional action: the repeating row of screenshots 1 and 3.
export function LabeledField({
    label,
    value,
    icon,
    action,
    onChange,
    readOnly,
    disabledReason,
    error,
    helperText
}: Props) {
    const disabled = disabledReason !== undefined
    const help = error ?? (disabled ? disabledReason : helperText)
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {icon !== undefined && (
                <Box aria-hidden sx={{ display: 'flex', width: 28, color: 'text.secondary' }}>
                    {icon}
                </Box>
            )}
            <TextField
                fullWidth
                label={label}
                value={value}
                disabled={disabled}
                error={error !== undefined}
                helperText={help}
                onChange={(e) => onChange?.(e.target.value)}
                slotProps={{ input: { readOnly: readOnly === true } }}
            />
            {action}
        </Box>
    )
}
