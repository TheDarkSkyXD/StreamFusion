import { createRootRoute, HeadContent, Scripts, Outlet, Link, ClientOnly } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FiMonitor } from 'react-icons/fi'
export const Route = createRootRoute({ component: Root })
function Root() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  useEffect(() => window.electronAPI?.onBeforeQuit(() => window.electronAPI?.closeWindow()), [])
  return <html lang="en"><head><HeadContent /><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>StreamFusion Start prototype</title></head>
    <body style={{ background: '#0f0f0f', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <h1><FiMonitor /> Start local-file prototype</h1>
      <p data-hydrated={hydrated}>Hydration: {hydrated ? 'ready' : 'pending'}</p>
      <ClientOnly fallback={<p>Loading desktop prototype...</p>}><nav><Link to="/">Home</Link> | <Link to="/details" search={{ tab: 'saved' }}>Details</Link></nav>
      <Outlet /></ClientOnly><Scripts />
    </body></html>
}
