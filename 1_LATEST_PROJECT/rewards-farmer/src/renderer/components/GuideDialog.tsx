import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useId } from 'react'
import type { ReactNode } from 'react'
import type { GuideFixKind, GuideSection } from '../../shared/troubleshooting-rules'

// Phase 15: shows one section of docs/troubleshooting.md. Nothing is invented here: every word comes from the guide.

const FIX_TEXT: Record<GuideFixKind, string> = {
    'verified-real': 'Verified with the real app code',
    'verified-run': 'Verified in a real run',
    'verified-stand-in': 'Verified with a stand-in only',
    'not-tested': 'Not tested'
}

// The guide is plain Markdown text. Only two inline marks are used in it: **bold** and `code`. Without this, the dialog would
// show the raw ** and ` characters (seen in the real window, Phase 15).
export function renderInline(text: string): ReactNode[] {
    return text
        .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
        .filter((part) => part !== '')
        .map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                return <strong key={i}>{part.slice(2, -2)}</strong>
            }
            if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                return (
                    <Box component="code" key={i} sx={{ fontFamily: 'monospace' }}>
                        {part.slice(1, -1)}
                    </Box>
                )
            }
            return part
        })
}

interface Props {
    readonly section: GuideSection | null
    readonly onClose: () => void
}

export function GuideDialog({ section, onClose }: Props) {
    const titleId = useId()
    return (
        <Dialog
            open={section !== null}
            onClose={onClose}
            aria-labelledby={titleId}
            maxWidth="sm"
            fullWidth
            scroll="paper"
        >
            {section !== null && (
                <>
                    <DialogTitle id={titleId}>{section.title}</DialogTitle>
                    <DialogContent dividers data-testid="guide-dialog">
                        {section.see.length > 0 && (
                            <Box component="section" sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" component="h3">
                                    You see
                                </Typography>
                                <Box component="ul" sx={{ m: 0, pl: 3 }}>
                                    {section.see.map((s) => (
                                        <Typography component="li" variant="body2" key={s}>
                                            {renderInline(s)}
                                        </Typography>
                                    ))}
                                </Box>
                            </Box>
                        )}
                        <Box component="section" sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" component="h3">
                                What to do
                            </Typography>
                            {section.steps.map((line) => (
                                <Typography
                                    variant="body2"
                                    key={line}
                                    sx={{ mt: 0.5, overflowWrap: 'anywhere' }}
                                >
                                    {renderInline(line)}
                                </Typography>
                            ))}
                        </Box>
                        <Box component="section" sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" component="h3">
                                Was this seen for real?
                            </Typography>
                            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                {renderInline(section.evidence)}
                            </Typography>
                        </Box>
                        <Box component="section">
                            <Typography variant="subtitle2" component="h3">
                                Was the fix tried?
                            </Typography>
                            <Box component="ul" sx={{ m: 0, pl: 3 }}>
                                {section.fixChecks.map((f) => (
                                    <Typography
                                        component="li"
                                        variant="body2"
                                        key={`${f.what}|${f.kind}`}
                                        sx={{ overflowWrap: 'anywhere' }}
                                    >
                                        {renderInline(`${FIX_TEXT[f.kind]}: ${f.what}`)}
                                    </Typography>
                                ))}
                            </Box>
                        </Box>
                        {section.knownGap !== null && (
                            <Typography variant="body2" sx={{ mt: 2, overflowWrap: 'anywhere' }}>
                                {renderInline(`Known gap: ${section.knownGap}`)}
                            </Typography>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={onClose} variant="contained">
                            Close
                        </Button>
                    </DialogActions>
                </>
            )}
        </Dialog>
    )
}
