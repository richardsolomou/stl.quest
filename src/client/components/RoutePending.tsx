import { Spinner } from '@/components/ui/spinner'
import { AuthBrand } from './Brand'

export function RoutePending() {
  return (
    <main className="grid min-h-dvh place-items-center p-6" aria-busy="true">
      <output className="flex flex-col items-center gap-5">
        <AuthBrand />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading page…
        </div>
      </output>
    </main>
  )
}
