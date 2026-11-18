import { useMemo, useState } from 'react'
import {
  Briefcase,
  CheckCircle2,
  Sparkles,
  Award,
  FileText,
  AlignLeft,
} from 'lucide-react'
import { parseJobDescription, type JdSection } from '@/lib/jdFormatter'

interface FormattedJobDescriptionProps {
  jd: string | undefined | null
  scoreReason?: string | null
  className?: string
}

// Tech keywords and requirements to subtly highlight
const HIGHLIGHT_REGEX = /(?:Java|Python|C\+\+|C语言|Go|Rust|JavaScript|TypeScript|React|Vue|Linux|RTOS|FreeRTOS|STM32|ARM|DSP|FPGA|PCB|CAD|Docker|K8s|Kubernetes|MySQL|Redis|SQL|Spring|Git|本科|硕士|大专|博士|应届生|\d+年及?以上?)/g

function highlightKeywords(text: string) {
  const parts = text.split(HIGHLIGHT_REGEX)
  const matches = text.match(HIGHLIGHT_REGEX)
  if (!matches) return text

  return parts.reduce<React.ReactNode[]>((acc, part, i) => {
    if (part) acc.push(part)
    if (i < matches.length) {
      acc.push(
        <span
          key={i}
          className="rounded-sm bg-primary/10 px-1 py-0.5 font-bold text-foreground"
        >
          {matches[i]}
        </span>
      )
    }
    return acc
  }, [])
}

export function FormattedJobDescription({
  jd,
  scoreReason,
  className = '',
}: FormattedJobDescriptionProps) {
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted')
  const sections = useMemo(() => parseJobDescription(jd), [jd])

  if (!jd?.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted">
        暂无详细岗位描述
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Optional AI Focus Highlight */}
      {scoreReason?.trim() && (
        <div className="mb-2.5 rounded-xl border border-primary/30 bg-primary/5 p-2.5 shadow-sm shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] font-black text-primary">
            <Sparkles className="h-3.5 w-3.5" /> AI 匹配核心重点
          </div>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-foreground">
            {scoreReason}
          </p>
        </div>
      )}

      {/* Switch between Formatted and Raw Text */}
      <div className="mb-2 flex items-center justify-between shrink-0">
        <span className="text-[11px] font-bold text-muted">
          {viewMode === 'formatted' ? `已结构化排版 (${sections.length} 个板块)` : '原始文本'}
        </span>
        <button
          type="button"
          onClick={() => setViewMode(prev => (prev === 'formatted' ? 'raw' : 'formatted'))}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
        >
          {viewMode === 'formatted' ? (
            <>
              <AlignLeft className="h-3 w-3" /> 查看原文
            </>
          ) : (
            <>
              <FileText className="h-3 w-3" /> 精读分段
            </>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto pr-1 text-xs leading-relaxed space-y-3">
        {viewMode === 'raw' ? (
          <p className="whitespace-pre-wrap leading-relaxed text-muted">{jd}</p>
        ) : (
          sections.map((section: JdSection, secIdx: number) => {
            const isDuties = section.kind === 'duties'
            const isReq = section.kind === 'requirements'
            const isBonus = section.kind === 'bonus'

            return (
              <div
                key={secIdx}
                className="rounded-xl border border-card-border/60 bg-card/60 p-3 shadow-xs"
              >
                {/* Section Header */}
                <div className="mb-2 flex items-center gap-1.5">
                  {isDuties && <Briefcase className="h-3.5 w-3.5 text-blue-500" />}
                  {isReq && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {isBonus && <Award className="h-3.5 w-3.5 text-amber-500" />}
                  <span
                    className={`font-black text-xs ${
                      isDuties
                        ? 'text-blue-600 dark:text-blue-400'
                        : isReq
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : isBonus
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-foreground'
                    }`}
                  >
                    {section.title}
                  </span>
                  <span className="text-[10px] text-muted font-normal">
                    ({section.items.length}条)
                  </span>
                </div>

                {/* Items with numbered bullets */}
                <div className="space-y-2">
                  {section.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-start gap-2 text-muted leading-5">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-foreground/80">
                        {itemIdx + 1}
                      </span>
                      <p className="flex-1 break-words">{highlightKeywords(item)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
