/**
 * Smart Parser and Formatter for recruitment Job Descriptions (JD).
 * Handles messy text without newlines, missing punctuation, compacted bullet points,
 * and extracts sections like duties, qualifications, and bonuses.
 */

export interface JdSection {
  title: string
  kind: 'duties' | 'requirements' | 'bonus' | 'general'
  items: string[]
}

const SECTION_PATTERNS: Array<{
  kind: JdSection['kind']
  label: string
  pattern: RegExp
}> = [
  {
    kind: 'duties',
    label: '岗位职责',
    pattern: /(?:^|[\s,。；;，])(工作职责|岗位职责|职位职责|主要职责|工作内容|职责描述|岗位工作内容|主要工作)[：:\s]*/i,
  },
  {
    kind: 'requirements',
    label: '任职要求',
    pattern: /(?:^|[\s,。；;，])(任职要求|任职资格|任职条件|岗位要求|职位要求|任职标准|招聘要求|招聘条件|工作要求)[：:\s]*/i,
  },
  {
    kind: 'bonus',
    label: '加分条件',
    pattern: /(?:^|[\s,。；;，])(加分项|优先条件|优先考虑|具备以下条件者优先)[：:\s]*/i,
  },
]

// Common numbering delimiters like "1. ", "2、", "(1)", "①", etc.
const ITEM_DELIMITER_REGEX = /(?:^|\s+|[。；;]\s*)(?=(?:\d+[\.、\s]|\(\d+\)|（\d+）|[①-⑩]|\-|\•|\*)\s*)/

/**
 * Splits section text into individual bullet points.
 */
function splitIntoBulletPoints(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // Check if text already has multiple explicit newlines
  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length > 1) {
    const refined: string[] = []
    for (const line of lines) {
      const parts = line.split(ITEM_DELIMITER_REGEX).map(p => p.trim()).filter(Boolean)
      if (parts.length > 1) {
        refined.push(...parts)
      } else {
        refined.push(line)
      }
    }
    return cleanItems(refined)
  }

  // If text is compacted into one single paragraph, split by numbering delimiters
  const splitByNumbering = trimmed.split(ITEM_DELIMITER_REGEX).map(p => p.trim()).filter(Boolean)
  if (splitByNumbering.length > 1) {
    return cleanItems(splitByNumbering)
  }

  // Fallback: split by sentences if very long
  const sentences = trimmed.split(/[。；;]\s+/).map(p => p.trim()).filter(Boolean)
  if (sentences.length > 1) {
    return cleanItems(sentences.map(s => s.endsWith('。') ? s : s + '。'))
  }

  return [trimmed]
}

function cleanItems(items: string[]): string[] {
  return items
    .map(item => item.replace(/^(?:\d+[\.、\s]+|\(\d+\)\s*|（\d+）\s*|[①-⑩]\s*|[\-\•\*]\s*)/, '').trim())
    .filter(item => item.length > 1)
}

/**
 * Parses raw JD text into clean, structured sections.
 */
export function parseJobDescription(rawJd: string | undefined | null): JdSection[] {
  if (!rawJd?.trim()) return []
  const text = rawJd.trim()

  // Find all section matches and their indices
  const sectionMatches: Array<{
    kind: JdSection['kind']
    label: string
    index: number
    length: number
  }> = []

  for (const def of SECTION_PATTERNS) {
    const regex = new RegExp(def.pattern.source, 'gi')
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      sectionMatches.push({
        kind: def.kind,
        label: def.label,
        index: match.index,
        length: match[0].length,
      })
    }
  }

  // Sort by appearance in text
  sectionMatches.sort((a, b) => a.index - b.index)

  // If no sections found, treat the whole text as a general section or detect items
  if (sectionMatches.length === 0) {
    const items = splitIntoBulletPoints(text)
    return [
      {
        title: '岗位描述与要求',
        kind: 'general',
        items,
      },
    ]
  }

  const sections: JdSection[] = []

  // If there is intro text before the first section
  if (sectionMatches[0].index > 0) {
    const preamble = text.slice(0, sectionMatches[0].index).trim()
    if (preamble.length > 3) {
      sections.push({
        title: '职位概况',
        kind: 'general',
        items: splitIntoBulletPoints(preamble),
      })
    }
  }

  for (let i = 0; i < sectionMatches.length; i++) {
    const current = sectionMatches[i]
    const contentStart = current.index + current.length
    const contentEnd = i + 1 < sectionMatches.length ? sectionMatches[i + 1].index : text.length
    const body = text.slice(contentStart, contentEnd).trim()

    const items = splitIntoBulletPoints(body)
    if (items.length > 0) {
      sections.push({
        title: current.label,
        kind: current.kind,
        items,
      })
    }
  }

  return sections
}
