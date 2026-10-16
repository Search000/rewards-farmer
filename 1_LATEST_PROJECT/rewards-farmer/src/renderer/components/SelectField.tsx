import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'

export interface SelectOption {
    readonly value: string
    readonly label: string
}

interface Props {
    readonly label: string
    readonly value: string
    readonly options: readonly SelectOption[]
    readonly onChange: (value: string) => void
    readonly disabledReason?: string | undefined
    readonly helperText?: string | undefined
}

export function SelectField({ label, value, options, onChange, disabledReason, helperText }: Props) {
    const disabled = disabledReason !== undefined
    return (
        <TextField
            select
            fullWidth
            label={label}
            value={value}
            disabled={disabled}
            helperText={disabled ? disabledReason : helperText}
            onChange={(e) => onChange(e.target.value)}
        >
            {options.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                    {o.label}
                </MenuItem>
            ))}
        </TextField>
    )
}
