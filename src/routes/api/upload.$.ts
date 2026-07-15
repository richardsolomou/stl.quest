import { createFileRoute } from '@tanstack/react-router'
import { handleUpload } from '../../server/uploads'
import { withRequestContext } from '../../server/requestContext'

const handle = ({ request }: { request: Request }) => withRequestContext(request, () => handleUpload(request))

export const Route = createFileRoute('/api/upload/$')({
  server: {
    handlers: {
      OPTIONS: handle,
      POST: handle,
      HEAD: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
})
