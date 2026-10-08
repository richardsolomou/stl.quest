import { useLocation } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { chunkLoadFailureNoticeId } from '../chunkRecovery'
import { clientNeedsRefresh } from '../updateNotices'

export function UpdateNotices({ serverVersion }: { serverVersion: string }) {
  const [chunkLoadFailed, setChunkLoadFailed] = useState(false)
  useEffect(() => {
    const showNotice = () => setChunkLoadFailed(true)
    window.addEventListener('vite:preloadError', showNotice)
    return () => window.removeEventListener('vite:preloadError', showNotice)
  }, [])

  return (
    <>
      {/* Revealed by the inline chunk recovery script when the app cannot hydrate. */}
      <RefreshNotice id={chunkLoadFailureNoticeId} hidden message="STL Quest couldn’t finish loading." />
      {(chunkLoadFailed || clientNeedsRefresh(serverVersion, __APP_VERSION__)) && <RefreshNotice message="STL Quest has been updated." />}
    </>
  )
}

function RefreshNotice({ id, hidden, message }: { id?: string; hidden?: boolean; message: string }) {
  // A plain link works before hydration; dropping the fragment makes it reload rather than scroll.
  const currentPage = useLocation({ select: (location) => location.pathname + location.searchStr })
  return (
    <div
      id={id}
      hidden={hidden}
      className="fixed right-3 bottom-3 left-3 z-50 flex items-center gap-2 rounded-lg border bg-popover/95 p-2 shadow-lg backdrop-blur sm:right-auto sm:left-1/2 sm:-translate-x-1/2"
    >
      <span className="whitespace-nowrap px-2 text-sm font-medium">{message}</span>
      <a className={buttonVariants({ size: 'sm' })} href={currentPage}>
        <RefreshCw />
        Refresh
      </a>
    </div>
  )
}
