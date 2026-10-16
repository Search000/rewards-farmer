import Tooltip from '@mui/material/Tooltip'
import type { ReactElement } from 'react'

interface Props {
    readonly text: string
    readonly children: ReactElement
}

export function Hint({ text, children }: Props) {
    return (
        <Tooltip title={text} arrow enterDelay={400}>
            {children}
        </Tooltip>
    )
}
