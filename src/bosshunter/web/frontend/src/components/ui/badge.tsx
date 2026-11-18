import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { HTMLAttributes } from 'react'

const badgeVariants = cva(
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold border transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-secondary/70 text-muted border-border/60',
        pending: 'bg-secondary text-foreground/80 border-border/80',
        scored: 'bg-indigo-500/10 text-indigo-700 border-indigo-200 dark:border-indigo-800 dark:text-indigo-300',
        ready: 'bg-sky-500/10 text-sky-700 border-sky-300 dark:border-sky-800 dark:text-sky-300',
        approved: 'bg-amber-500/10 text-amber-800 border-amber-300 dark:border-amber-800 dark:text-amber-300',
        skipped: 'bg-slate-500/10 text-slate-600 border-slate-200 dark:border-slate-800 dark:text-slate-400',
        sent: 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:border-emerald-800 dark:text-emerald-300',
        replied: 'bg-blue-500/10 text-blue-700 border-blue-300 dark:border-blue-800 dark:text-blue-300',
        resume_sent: 'bg-purple-500/10 text-purple-700 border-purple-200 dark:border-purple-800 dark:text-purple-300',
        needs_resume: 'bg-pink-500/10 text-pink-700 border-pink-300 dark:border-pink-800 dark:text-pink-300',
        follow_up_sent: 'bg-sky-500/10 text-sky-700 border-sky-300 dark:border-sky-800 dark:text-sky-300',
        reply_pending: 'bg-amber-500/15 text-amber-800 border-amber-300 dark:border-amber-700 dark:text-amber-200',
        auto_replied: 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:border-emerald-800 dark:text-emerald-300',
        rejected: 'bg-rose-500/10 text-rose-700 border-rose-300 dark:border-rose-800 dark:text-rose-300',
        error: 'bg-rose-500/15 text-rose-700 border-rose-300 dark:border-rose-800 dark:text-rose-300',
        filtered: 'bg-stone-500/10 text-stone-600 border-stone-200 dark:border-stone-700 dark:text-stone-300',
        campus: 'bg-blue-500/10 text-blue-700 border-blue-200 dark:border-blue-800 dark:text-blue-300',
        experienced: 'bg-violet-500/10 text-violet-700 border-violet-200 dark:border-violet-800 dark:text-violet-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
