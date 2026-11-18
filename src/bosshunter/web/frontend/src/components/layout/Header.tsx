import { useLocation } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

const pageTitles: Record<string, string> = {
  '/': '今日',
  '/jobs': '挑岗',
  '/subscription': '搜集',
  '/monitor': '跟进',
  '/config': '偏好',
}

export function Header() {
  const location = useLocation()
  const title = pageTitles[location.pathname] || 'JobPilot'

  return (
    <header className="h-16 border-b border-border/80 bg-card/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6 transition-colors">
      <h1 className="text-lg font-bold tracking-tight text-foreground">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/60 px-3 py-1 text-xs text-muted transition-colors">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
          </span>
          <span className="font-medium text-foreground/80">本地服务运行中</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  )
}
