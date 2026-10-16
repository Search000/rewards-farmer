import guideText from '../../docs/troubleshooting.md?raw'
import { parseGuide } from '../shared/troubleshooting-rules'

// The guide is read from docs/troubleshooting.md at build time, so the page and the file can never disagree.
export const GUIDE_SECTIONS = parseGuide(guideText)
