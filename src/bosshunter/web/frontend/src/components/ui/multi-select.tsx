import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  value: string[]
  options: MultiSelectOption[]
  placeholder: string
  onChange: (value: string[]) => void
  className?: string
  compact?: boolean
  portal?: boolean
  searchable?: boolean
  shortLabel?: string
}

export function MultiSelect({ value, options, placeholder, onChange, className, compact = false, portal = false, searchable = false, shortLabel }: MultiSelectProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const visibleOptions = searchable && search.trim()
    ? options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : options
  const [position, setPosition] = useState({ top: 0, left: 0, width: 160 })
  useLayoutEffect(() => {
    if (!portal || !open) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(window.innerWidth - 16, Math.max(searchable ? 280 : 160, rect.width))
      setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 260 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 260) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [portal, open, searchable])
  const selectedLabels = value.map(item => options.find(option => option.value === item)?.label || item)
  const summary = selectedLabels.length === 0
    ? shortLabel || placeholder
    : selectedLabels.join('、')
  const allSelected = visibleOptions.length > 0 && visibleOptions.every(option => value.includes(option.value))
  const toggleAll = () => {
    const visibleValues = new Set(visibleOptions.map(option => option.value))
    onChange(allSelected ? value.filter(item => !visibleValues.has(item)) : [...new Set([...value, ...visibleValues])])
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !detailsRef.current?.open) return
      event.preventDefault()
      detailsRef.current.open = false
      setOpen(false)
      setSearch('')
      triggerRef.current?.focus()
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (detailsRef.current?.open && event.target instanceof Node && !detailsRef.current.contains(event.target) && !menuRef.current?.contains(event.target)) {
        detailsRef.current.open = false
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
    }
  }, [])

  const menu = (
      <div ref={menuRef} role="group" aria-label={`${placeholder}选项列表`} style={portal ? position : undefined} className={cn('z-50 max-h-64 min-w-36 overflow-y-auto rounded-md border border-card-border bg-card p-1 shadow-xl', portal ? 'fixed' : 'absolute mt-1 w-full')}>
        {searchable && <div className="sticky top-0 z-10 bg-card p-1"><input type="search" aria-label={`${placeholder}搜索`} placeholder="搜索库中职位" value={search} onChange={event => setSearch(event.target.value)} autoFocus={open} className="h-8 w-full rounded border border-card-border bg-card px-2 text-xs font-normal text-foreground outline-none focus:border-primary" /></div>}
        <div className="flex items-center gap-2 border-b border-card-border px-2 py-1.5 text-xs font-bold text-foreground">
          <label className="flex cursor-pointer items-center gap-2 hover:text-primary">
            <input type="checkbox" checked={allSelected} disabled={visibleOptions.length === 0} onChange={toggleAll} className="h-3.5 w-3.5 accent-primary" />
            <span>{search.trim() ? '全选搜索结果' : '全选'}</span>
          </label>
          {selectedLabels.length > 0 && <button type="button" className="ml-auto font-normal text-muted hover:text-primary" onClick={() => onChange([])}>清空</button>}
        </div>
        {visibleOptions.map(option => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-normal text-foreground hover:bg-surface">
          <input type="checkbox" aria-label={option.label} checked={value.includes(option.value)} onChange={() => onChange(value.includes(option.value) ? value.filter(item => item !== option.value) : [...value, option.value])} className="h-3.5 w-3.5 accent-primary" />
          <span>{option.label}</span>
        </label>)}
        {visibleOptions.length === 0 && <p className="px-2 py-3 text-xs font-normal text-muted">{searchable ? search.trim() ? '没有匹配的职位' : '当前库暂无可选职位' : '暂无可选项'}</p>}
      </div>
  )
  return (
    <details ref={detailsRef} onToggle={event => { setOpen(event.currentTarget.open); if (!event.currentTarget.open) setSearch('') }} aria-label={`${placeholder}选项`} className={cn('relative min-w-0', className)}>
      <summary
        ref={triggerRef}
        className={cn(
          'flex h-9 w-full cursor-pointer list-none items-center justify-between rounded-md border border-card-border bg-card px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-details-marker]:hidden',
          compact && 'h-7 px-2 text-xs',
        )}
        title={selectedLabels.length > 0 ? selectedLabels.join('、') : placeholder}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <span className="ml-1 shrink-0 text-muted">⌄</span>
      </summary>
      {portal ? open && createPortal(menu, document.body) : menu}
    </details>
  )
}
