export interface ProfileSetting {
  degree_level: number // 1: 大专, 2: 本科, 3: 硕士, 4: 博士
  degree_name: string
  major_name: string
  grad_year: string
  ignore_location: boolean
  resume_mode: string // 'default' | 'custom_text'
  resume_text: string
}

export interface JobItem {
  id: string
  campaign_id: string
  job_title: string
  department: string
  degree_req: string
  degree_level: number
  major_req: string
  major_restricted: boolean
  headcount: string
  employment_type: string
  location: string
  raw_jd: string
  url: string
  status: 'unapplied' | 'applied' | 'ignored'
  is_excluded: boolean
  exclude_reason: string | null
  is_manually_restored: boolean
  score: number
  rank: number
  volunteer_tier: 'sprint' | 'core' | 'safety'
  major_bonus_tag: string | null
  fit_reasons: string[]
  shortcomings: string[]
  suggested_keywords: string[]
}

export interface CompanyCampaign {
  id: string
  company_name: string
  source_type: 'url' | 'image' | 'text'
  source_input: string
  status: 'queued' | 'parsing' | 'matching' | 'ready' | 'failed'
  status_message: string
  created_at: string
  updated_at: string
  total_jobs: number
  eligible_jobs: number
  excluded_jobs: number
  applied_jobs: number
  jobs: JobItem[]
}
