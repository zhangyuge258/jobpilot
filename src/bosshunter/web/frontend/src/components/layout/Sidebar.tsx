import { version } from '../../../package.json'
import { NavLink } from 'react-router-dom'
import { Bell, BriefcaseBusiness, Github, LayoutDashboard, Radar, Settings, Target } from 'lucide-react'
import { useEffect, useState } from 'react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '今日' },
  { to: '/jobs', icon: BriefcaseBusiness, label: '挑岗' },
  { to: '/direct-select', icon: Target, label: '直投' },
  { to: '/subscription', icon: Bell, label: '搜集' },
  { to: '/monitor', icon: Radar, label: '跟进' },
  { to: '/config', icon: Settings, label: '偏好' },
]

const GITHUB_URL = 'https://github.com/powerycy/BossHunter'

interface SidebarProps {
  pendingReplies?: number
}

export function Sidebar({ pendingReplies: pendingRepliesProp }: SidebarProps) {
  const [pendingReplies, setPendingReplies] = useState(pendingRepliesProp ?? 0)

  useEffect(() => {
    if (pendingRepliesProp !== undefined) {
      setPendingReplies(pendingRepliesProp)
      return
    }

    const fetchPendingReplies = async () => {
      try {
        const res = await fetch('/api/history/unresolved-replies/count')
        const data = await res.json()
        setPendingReplies(Number(data.count) || 0)
      } catch {
        setPendingReplies(0)
      }
    }

    fetchPendingReplies()
    const interval = setInterval(fetchPendingReplies, 30000)
    return () => clearInterval(interval)
  }, [pendingRepliesProp])

  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-border/80 bg-card/95 backdrop-blur-md md:w-60 transition-colors">
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-border/80 md:justify-start md:px-5">
        <div className="flex items-center gap-3">
          {/* JobPilot Aero-Nav Compass Logo */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-indigo-800 text-white shadow-sm shadow-blue-500/25 ring-1 ring-white/15">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M12 2.5L20 19.5L12 16L4 19.5L12 2.5Z"
                fill="currentColor"
                fillOpacity="0.25"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <path
                d="M12 16V9.5"
                stroke="#67e8f9"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="12" cy="7.5" r="1.5" fill="#67e8f9" />
            </svg>
          </div>
          <div className="hidden md:block">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-foreground">JobPilot</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">v5.1.0</span>
            </div>
            <div className="text-[11px] font-medium text-muted">智能求职副驾</div>
            {/* v5.1.0 · 本地控制台 */}
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-2 py-4 md:px-3">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            data-tour={item.to === '/config' ? 'nav-config' : item.to === '/' ? 'nav-workbench' : undefined}
            className={({ isActive }) =>
              `relative flex items-center justify-center gap-3 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-all md:justify-between md:px-3 md:text-sm ${
                isActive
                  ? 'bg-primary/10 text-primary font-bold shadow-xs'
                  : 'text-muted hover:text-foreground hover:bg-secondary/60'
              }`
            }
          >
            <span className="flex flex-col items-center gap-1 md:flex-row md:gap-3">
              <item.icon className="w-4 h-4" />
              {item.label}
            </span>
            {item.to === '/monitor' && pendingReplies > 0 && (
              <span className="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-danger animate-pulse md:static" aria-label="有待处理事项" />
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-border/80 px-2 py-4 md:px-4">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="BossHunter GitHub"
          className="relative flex items-center justify-center rounded-xl border border-border/80 bg-secondary/40 px-3 py-2.5 text-xs font-semibold text-foreground transition-all hover:bg-secondary hover:text-primary md:rounded-xl"
        >
          <Github className="h-4 w-4 shrink-0 md:absolute md:left-3" />
          <span className="mx-auto hidden items-center justify-center gap-2 md:flex">
            <span className="text-xl leading-none text-star">★</span>
            GitHub 开源
          </span>
        </a>
        <p className="hidden text-center text-[10px] text-muted md:block">欢迎 Star 支持持续维护</p>
      </div>
    </aside>
  )
}
