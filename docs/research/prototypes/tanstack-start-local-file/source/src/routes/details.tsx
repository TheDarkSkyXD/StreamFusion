import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/details')({
  validateSearch: (search: Record<string, unknown>) => ({ tab: typeof search.tab === 'string' ? search.tab : 'default' }),
  component: Details,
})
function Details() { const { tab } = Route.useSearch(); return <main><h2>Details</h2><p>Tab: {tab}</p></main> }
