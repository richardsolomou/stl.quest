import { useI18n } from '../i18n'

export function PasswordAuthDivider() {
  const { t } = useI18n()
  return (
    <div className="relative my-1 text-center text-xs text-muted-foreground before:absolute before:top-1/2 before:left-0 before:w-full before:border-t">
      <span className="relative bg-card px-2">{t.auth.passwordDivider}</span>
    </div>
  )
}
