import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

// What happened, then what to do about it, then the server's own words for whoever needs them.
export type Notice = { tone: 'error' | 'success'; title: string; hint: string; detail?: string }

export function noticeDetail(error: unknown) {
  return error instanceof Error && error.message ? error.message : undefined
}

export function errorNotice(title: string, hint: string, error?: unknown): Notice {
  return { tone: 'error', title, hint, detail: noticeDetail(error) }
}

export function successNotice(title: string, hint: string): Notice {
  return { tone: 'success', title, hint }
}

export function SettingNotice({ notice }: { notice?: Notice }) {
  if (!notice) return null
  return (
    <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'}>
      {notice.tone === 'error' ? <CircleAlert /> : <CheckCircle2 />}
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{notice.hint}</span>
        {notice.detail && <span className="text-xs break-words opacity-80">{notice.detail}</span>}
      </AlertDescription>
    </Alert>
  )
}
