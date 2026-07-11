import { useState } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { Board } from '../components/Board'
import { JobModal } from '../components/JobModal'
import { UploadForm } from '../components/UploadForm'

const rootRoute = getRouteApi('__root__')

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(convexQuery(api.jobs.list, {})),
  component: Home,
})

function Home() {
  const me = rootRoute.useLoaderData()
  const { data: jobs } = useSuspenseQuery(convexQuery(api.jobs.list, {}))
  const [uploadOpen, setUploadOpen] = useState(false)
  const [openJobId, setOpenJobId] = useState<string | null>(null)

  const openJob = jobs.find((job) => job._id === openJobId)

  return (
    <div className="app">
      <header className="header">
        <h1>
          Print<span className="accent">Queue</span>
        </h1>
        <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
          Add a print
        </button>
        <span className="who">{me.email}</span>
      </header>

      <Board jobs={jobs} isAdmin={me.isAdmin} onOpenJob={setOpenJobId} />

      {uploadOpen && <UploadForm onClose={() => setUploadOpen(false)} />}
      {openJob && <JobModal job={openJob} isAdmin={me.isAdmin} onClose={() => setOpenJobId(null)} />}
    </div>
  )
}
