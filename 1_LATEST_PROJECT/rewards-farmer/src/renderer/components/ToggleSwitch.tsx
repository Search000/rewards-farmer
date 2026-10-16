import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import { useTheme } from '@mui/material/styles'
import { tokensFor } from '../theme'

interface Props {
    readonly label: string
    readonly checked: boolean
    readonly onChange: (checked: boolean) => void
    readonly labelPlacement?: 'start' | 'end' | undefined
    readonly disabledReason?: string | undefined
}

// Switch look from screenshots: off = grey outlined thumb, on = lavender track with dark thumb.
export function ToggleSwitch({ label, checked, onChange, labelPlacement = 'end', disabledReason }: Props) {
    const t = tokensFor(useTheme().palette.mode)
    const disabled = disabledReason !== undefined
    return (
        <FormControlLabel
            labelPlacement={labelPlacement}
            disabled={disabled}
            label={disabled ? `${label} (${disabledReason})` : label}
            control={
                <Switch
                    checked={checked}
                    onChange={(e) => {
                        // Defense in depth: a disabled control must never report a change (rule 17).
                        if (!disabled) onChange(e.target.checked)
                    }}
                    sx={{
                        '& .MuiSwitch-track': {
                            borderRadius: 13,
                            opacity: 1,
                            backgroundColor: 'transparent',
                            border: `2px solid ${t.switchOff}`,
                            boxSizing: 'border-box'
                        },
                        '& .MuiSwitch-thumb': { backgroundColor: t.switchOff, boxShadow: 'none' },
                        '& .Mui-checked + .MuiSwitch-track': {
                            backgroundColor: t.primary,
                            borderColor: t.primary,
                            opacity: 1
                        },
                        '& .Mui-checked .MuiSwitch-thumb': { backgroundColor: t.onPrimary }
                    }}
                />
            }
        />
    )
}
