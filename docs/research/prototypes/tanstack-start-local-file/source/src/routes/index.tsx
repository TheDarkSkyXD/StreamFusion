import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
export const Route = createFileRoute('/')({ component: Home })
function Home() {
  const [count, setCount] = useState(0)
  return <main><h2>Home</h2><button onClick={() => setCount(count + 1)}>Count {count}</button></main>
}
