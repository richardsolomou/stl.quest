import { createFileRoute } from '@tanstack/react-router'
import { llmsText } from '../client/landing/llms'
import { hostedFile } from '../server/landingFiles'

export const Route = createFileRoute('/llms.txt')({
  server: { handlers: { GET: () => hostedFile(llmsText, 'text/markdown; charset=utf-8') } },
})
