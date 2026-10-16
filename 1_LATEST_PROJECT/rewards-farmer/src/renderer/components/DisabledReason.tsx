import Tooltip from '@mui/material/Tooltip'
import type { ReactElement } from 'react'

interface Props {
    // When set, the wrapped control is disabled-looking and this text explains why (rule 17).
    readonly reason: string | undefined
    readonly children: ReactElement
}

// Disabled MUI controls do not fire pointer events, so the tooltip needs a focusable wrapper span.
export function DisabledReason({ reason, children }: Props) {
    if (reason === undefined) return children
    return (
        <Tooltip title={reason} describeChild>
            <span tabIndex={0} aria-label={reason} style={{ display: 'inline-flex' }}>
                {children}
            </span>
        </Tooltip>
    )
}
