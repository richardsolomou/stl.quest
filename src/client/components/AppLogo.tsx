import { cn } from '@/lib/utils'
import { appPath } from '../../basePath'
import { APP_LOGOS, type AppId } from '../../core/appLogos'

/** An external app's own icon beside its visible name, so it is decorative; the corner rounds the icons drawn edge to edge. */
export function AppLogo({ app, className }: { app: AppId; className?: string }) {
  return <img src={appPath(APP_LOGOS[app])} alt="" className={cn('size-4 shrink-0 rounded-[22%] object-contain', className)} />
}
