import Button from '@mui/material/Button'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { tokensFor } from '../theme'
import { DisabledReason } from './DisabledReason'

interface Props {
    readonly label: string
    readonly icon?: ReactNode | undefined
    // 'tonal' = slate-blue "Open" button (screenshot 1). 'text' = "Reset to defaults" / "Save" (screenshot 3).
    // 'pill' = rounded Stop / Start buttons (screenshot 1).
    readonly variant?: 'tonal' | 'text' | 'pill' | undefined
    readonly onClick?: (() => void) | undefined
    // When set the button is disabled and this explains why (rule 17).
    readonly disabledReason?: string | undefined
    readonly busy?: boolean | undefined
    // Longer accessible name when several buttons show the same text (for example one Save per row).
    readonly ariaLabel?: string | undefined
}

export function ActionButton({
    label,
    icon,
    variant = 'tonal',
    onClick,
    disabledReason,
    busy,
    ariaLabel
}: Props) {
    const theme = useTheme()
    const tokens = tokensFor(theme.palette.mode)
    const disabled = disabledReason !== undefined || busy === true

    const sx =
        variant === 'tonal'
            ? { minWidth: 160, height: 62, bgcolor: tokens.primaryContainer, color: tokens.textPrimary }
            : variant === 'pill'
              ? {
                    minWidth: 120,
                    height: 48,
                    borderRadius: 6,
                    bgcolor: tokens.primaryContainer,
                    color: tokens.textPrimary
                }
              : {}

    return (
        <DisabledReason reason={disabledReason}>
            <Button
                variant={variant === 'text' ? 'text' : 'contained'}
                startIcon={icon}
                disabled={disabled}
                aria-busy={busy === true ? true : undefined}
                aria-label={ariaLabel}
                onClick={onClick}
                sx={sx}
            >
                {label}
            </Button>
        </DisabledReason>
    )
}
