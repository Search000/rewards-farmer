import { parseEnvText } from './envFile'

// Line-preserving editor for the accounts `.env` file (Phase 7, docs/architecture.md section 5).
// Pure functions: text in, text out. Nothing here touches the disk. Everything the editor does not own (comments, blank
// lines, other variables, other accounts, unknown ACCOUNT_N_* variables, line endings, a BOM) stays byte for byte.

// The only variables the Accounts screen manages. Other ACCOUNT_N_* lines (for example SAVE_FINGERPRINT_*) are left alone.
export const MANAGED_FIELDS = [
    'EMAIL',
    'PASSWORD',
    'TOTP_SECRET',
    'RECOVERY_EMAIL',
    'LANG_CODE',
    'GEO_LOCALE',
    'PROXY_HTTP',
    'PROXY_URL',
    'PROXY_PORT',
    'PROXY_USERNAME',
    'PROXY_PASSWORD'
] as const
export type ManagedField = (typeof MANAGED_FIELDS)[number]

// Old name of PROXY_HTTP that the engine still reads when PROXY_HTTP is absent (engine/src/util/Load.ts).
const LEGACY_PROXY_HTTP = 'PROXY_AXIOS'

// undefined = leave as is, null = remove the line(s), string = set this value.
export type FieldChange = string | null | undefined
export type FieldChanges = Partial<Record<ManagedField | typeof LEGACY_PROXY_HTTP, FieldChange>>

const SLOT_KEY_RE = /^ACCOUNT_([1-9]\d*)_([A-Z0-9_]+)$/
const MAX_SLOT = 999_999

export interface SlotRecord {
    readonly slot: number
    // Non-empty values only, keyed by the part after ACCOUNT_N_ (EMAIL, PASSWORD, ...). Same grammar as the engine.
    readonly values: Readonly<Record<string, string>>
}

// Accounts as the engine sees them: slots that have a non-empty ACCOUNT_N_EMAIL, in slot order.
export function listSlots(text: string): SlotRecord[] {
    const all = parseEnvText(text)
    const bySlot = new Map<number, Record<string, string>>()
    for (const [key, value] of Object.entries(all)) {
        const m = SLOT_KEY_RE.exec(key)
        if (m === null || value === '') continue
        const slot = Number(m[1])
        if (!Number.isSafeInteger(slot) || slot > MAX_SLOT) continue
        const values = bySlot.get(slot) ?? {}
        values[m[2] ?? ''] = value
        bySlot.set(slot, values)
    }
    return [...bySlot.entries()]
        .filter(([, values]) => values['EMAIL'] !== undefined)
        .sort((a, b) => a[0] - b[0])
        .map(([slot, values]) => ({ slot, values }))
}

// ---- value formatting -----------------------------------------------------------------------------------------------

export class EnvEditError extends Error {}

// The engine trims values and removes ONE pair of matching quotes. A value that itself starts and ends with the same
// quote character is therefore written inside an extra pair of double quotes. Values the grammar cannot carry are refused.
export function formatValue(value: string): string {
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new EnvEditError('A value contains a control character or line break.')
    if (value !== value.trim()) throw new EnvEditError('A value starts or ends with a space; the engine would remove it.')
    const first = value[0]
    const needsQuotes = value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)
    return needsQuotes ? `"${value}"` : value
}

// ---- line model -----------------------------------------------------------------------------------------------------

interface Line {
    text: string
    // Line ending of this line exactly as in the file ('' only for a last line without a newline).
    eol: string
}

function toLines(text: string): Line[] {
    const parts = text.split(/(\r?\n)/)
    const lines: Line[] = []
    for (let i = 0; i < parts.length; i += 2) lines.push({ text: parts[i] ?? '', eol: parts[i + 1] ?? '' })
    // A file that ends with a newline yields one empty trailing piece; it is not a line.
    const last = lines[lines.length - 1]
    if (last !== undefined && last.text === '' && last.eol === '' && lines.length > 1) lines.pop()
    else if (text === '') return []
    return lines
}

function fromLines(lines: readonly Line[]): string {
    return lines.map((l) => l.text + l.eol).join('')
}

function defaultEol(lines: readonly Line[]): string {
    for (const l of lines) if (l.eol !== '') return l.eol
    return '\n'
}

// Key of an active (not commented) assignment line, or null. Same reading as parseEnvText.
function keyOf(text: string): string | null {
    const trimmed = text.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return null
    const eq = trimmed.indexOf('=')
    if (eq === -1) return null
    return trimmed.slice(0, eq).trim()
}

function indexesOfKey(lines: readonly Line[], key: string): number[] {
    const out: number[] = []
    lines.forEach((l, i) => {
        if (keyOf(l.text) === key) out.push(i)
    })
    return out
}

function slotLineIndexes(lines: readonly Line[], slot: number): number[] {
    const prefix = `ACCOUNT_${String(slot)}_`
    const out: number[] = []
    lines.forEach((l, i) => {
        const k = keyOf(l.text)
        if (k !== null && k.startsWith(prefix)) out.push(i)
    })
    return out
}

function insertAfter(lines: Line[], index: number, text: string, eol: string): void {
    const target = lines[index]
    if (target === undefined) {
        lines.push({ text, eol: '' })
        return
    }
    if (target.eol === '') {
        // Inserting after a final line that has no newline: give it one, the new last line gets none.
        target.eol = eol
        lines.splice(index + 1, 0, { text, eol: '' })
    } else {
        lines.splice(index + 1, 0, { text, eol: target.eol })
    }
}

function appendBlockStart(lines: Line[], eol: string): void {
    if (lines.length === 0) return
    const last = lines[lines.length - 1]
    if (last !== undefined && last.eol === '') last.eol = eol
    // One blank line between the old content and a new account block.
    if (last !== undefined && last.text.trim() !== '') lines.push({ text: '', eol })
}

function setLine(line: Line, key: string, value: string): void {
    const indent = /^\s*/.exec(line.text)?.[0] ?? ''
    line.text = `${indent}${key}=${formatValue(value)}`
}

// ---- operations -----------------------------------------------------------------------------------------------------

export function nextFreeSlot(text: string): number {
    let max = 0
    for (const key of Object.keys(parseEnvText(text))) {
        const m = SLOT_KEY_RE.exec(key)
        if (m === null) continue
        const n = Number(m[1])
        if (Number.isSafeInteger(n) && n <= MAX_SLOT && n > max) max = n
    }
    return max + 1
}

// Apply field changes to one slot. Existing lines are changed in place (every duplicate of the key, so the result does not
// depend on which duplicate the engine reads); missing lines are added after the slot's last line; a brand new slot gets a
// "# Account N" header at the end of the file.
export function applyChanges(text: string, slot: number, changes: FieldChanges): string {
    const lines = toLines(text)
    const eol = text.includes('\r\n') ? '\r\n' : defaultEol(lines)
    const slotName = String(slot)
    const isNew = slotLineIndexes(lines, slot).length === 0

    // A new file, or a file that ends with a newline, keeps ending with one. A file without a final newline stays that way.
    const endsWithEol = lines.length === 0 || (lines[lines.length - 1]?.eol ?? '') !== ''
    let started = !isNew
    for (const field of [...MANAGED_FIELDS, LEGACY_PROXY_HTTP] as const) {
        const change = changes[field]
        if (change === undefined) continue
        const key = `ACCOUNT_${slotName}_${field}`
        const found = indexesOfKey(lines, key)
        if (change === null) {
            for (let i = found.length - 1; i >= 0; i -= 1) lines.splice(found[i] ?? 0, 1)
            continue
        }
        if (found.length > 0) {
            for (const i of found) {
                const line = lines[i]
                if (line !== undefined) setLine(line, key, change)
            }
            continue
        }
        const formatted = `${key}=${formatValue(change)}`
        if (!started) {
            appendBlockStart(lines, eol)
            lines.push({ text: `# Account ${slotName}`, eol })
            lines.push({ text: formatted, eol: endsWithEol ? eol : '' })
            started = true
            continue
        }
        const after = slotLineIndexes(lines, slot)
        const anchor = after.length > 0 ? (after[after.length - 1] ?? lines.length - 1) : lines.length - 1
        insertAfter(lines, anchor, formatted, eol)
    }
    return fromLines(lines)
}

// Remove every active ACCOUNT_<slot>_* line, and the "# Account <slot>" header directly above them if there is one.
// Commented-out lines, other accounts and all other lines stay.
export function removeSlot(text: string, slot: number): string {
    const lines = toLines(text)
    const indexes = slotLineIndexes(lines, slot)
    if (indexes.length === 0) return text
    const header = new RegExp(`^\\s*#\\s*account\\s+${String(slot)}\\b`, 'i')
    const first = indexes[0] ?? 0
    const drop = new Set(indexes)
    const above = lines[first - 1]
    if (above !== undefined && header.test(above.text)) drop.add(first - 1)
    const kept = lines.filter((_, i) => !drop.has(i))
    // Removing the last line of a file that had no final newline must not leave a dangling newline behind.
    const wasLast = indexes[indexes.length - 1] === lines.length - 1
    const lastKept = kept[kept.length - 1]
    if (wasLast && lastKept !== undefined && lines[lines.length - 1]?.eol === '') lastKept.eol = ''
    return fromLines(kept)
}
