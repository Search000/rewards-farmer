import type { HealthCheck } from './health-types'

// Phase 15: the troubleshooting guide. docs/troubleshooting.md is the ONLY source of the text. This file turns it into
// sections (pure: no file, no clock) so the Health page can open the section that matches a failed row. Tests prove that every
// message quoted in the guide is produced by the real Health service and that every verified fix is backed by a real test.

export type GuideFixKind = 'verified-real' | 'verified-run' | 'verified-stand-in' | 'not-tested'

export interface GuideFixCheck {
    readonly kind: GuideFixKind
    // What was checked, in the guide's words.
    readonly what: string
    // The text after the label: a test reference, an evidence id, or the reason it was not tested.
    readonly note: string
}

export type GuideEvidenceKind = 'observed-pc' | 'observed-here' | 'reproduced-tests'

export interface GuideSection {
    readonly id: string
    readonly title: string
    readonly healthRow: string
    // Exact message fragments the app (or the launcher) shows for this problem.
    readonly see: readonly string[]
    // Raw lines of "What to do" (numbered steps, short paragraphs).
    readonly steps: readonly string[]
    readonly evidence: string
    readonly evidenceKind: GuideEvidenceKind | null
    readonly fixChecks: readonly GuideFixCheck[]
    readonly knownGap: string | null
}

const ANCHOR = /^<a id="([a-z0-9-]+)"><\/a>\s*$/
const LABEL = /^\*\*(.+?):\*\*\s*(.*)$/
const FIX_LINE = /^- (.+?): (VERIFIED \((?:real run|real|stand-in)\)|NOT TESTED)\b\s*(.*)$/

const KIND_BY_LABEL: Readonly<Record<string, GuideFixKind>> = {
    'VERIFIED (real)': 'verified-real',
    'VERIFIED (real run)': 'verified-run',
    'VERIFIED (stand-in)': 'verified-stand-in',
    'NOT TESTED': 'not-tested'
}

function evidenceKindOf(text: string): GuideEvidenceKind | null {
    if (text.startsWith('OBSERVED ON YOUR PC')) return 'observed-pc'
    if (text.startsWith('OBSERVED HERE')) return 'observed-here'
    if (text.startsWith('REPRODUCED IN TESTS')) return 'reproduced-tests'
    return null
}

const bullet = (line: string): string | null => (line.startsWith('- ') ? line.slice(2).trim() : null)

function parseSection(id: string, lines: readonly string[]): GuideSection {
    const titleLine = lines.find((l) => l.startsWith('## '))
    const fields = new Map<string, string[]>()
    let current: string | null = null
    for (const line of lines) {
        const m = LABEL.exec(line)
        if (m?.[1] !== undefined) {
            current = m[1].toLowerCase()
            fields.set(current, m[2] === undefined || m[2] === '' ? [] : [m[2]])
            continue
        }
        if (current !== null && line.trim() !== '') fields.get(current)?.push(line.trim())
    }
    const get = (label: string): string[] => fields.get(label) ?? []
    const fixChecks: GuideFixCheck[] = []
    for (const line of get('fix check')) {
        const m = FIX_LINE.exec(line)
        const kind = m?.[2] === undefined ? undefined : KIND_BY_LABEL[m[2]]
        if (m?.[1] === undefined || kind === undefined) continue
        fixChecks.push({ kind, what: m[1], note: m[3] ?? '' })
    }
    const gap = get('known gap')
    const evidence = get('evidence').join(' ')
    return {
        id,
        title: titleLine === undefined ? id : titleLine.slice(3).trim(),
        healthRow: get('health row').join(' '),
        see: get('you see')
            .map(bullet)
            .filter((s): s is string => s !== null),
        steps: get('what to do'),
        evidence,
        evidenceKind: evidenceKindOf(evidence),
        fixChecks,
        knownGap: gap.length === 0 ? null : gap.join(' ')
    }
}

// Splits the guide at its `<a id="..."></a>` anchors. Text before the first anchor and the final "Known gaps" part are not
// sections.
export function parseGuide(text: string): readonly GuideSection[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const sections: GuideSection[] = []
    let id: string | null = null
    let buf: string[] = []
    const flush = (): void => {
        if (id !== null) sections.push(parseSection(id, buf))
        id = null
        buf = []
    }
    for (const line of lines) {
        const a = ANCHOR.exec(line)
        if (a?.[1] !== undefined) {
            flush()
            id = a[1]
            continue
        }
        if (line.startsWith('## Known gaps')) {
            flush()
            continue
        }
        if (id !== null) buf.push(line)
    }
    flush()
    return sections
}

export function findSection(sections: readonly GuideSection[], id: string): GuideSection | null {
    return sections.find((s) => s.id === id) ?? null
}

// Which guide section opens from a Health row. A row that passed has none. Every failing row id has a section of the same
// name; a row that could not be checked ("unknown") opens the section that explains Unknown rows. The `app` row can only be
// OK or unknown, so it never needs a section of its own.
export function guideIdFor(check: HealthCheck): string | null {
    if (check.status === 'ok') return null
    if (check.status === 'unknown') return 'unknown'
    return check.id
}

export const GUIDE_FILE = 'docs/troubleshooting.md'
