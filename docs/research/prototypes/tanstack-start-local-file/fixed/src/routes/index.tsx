import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
export const Route = createFileRoute('/')({ component: Home })
type DesktopProbePort = {
  getVersion(): Promise<string>; closeWindow(): void; onBeforeQuit(callback: () => void): () => void;
  preferences: { get(): Promise<{theme: string}>; update(value: { theme: 'light' }): Promise<{theme: string}> };
  follows: { getAll(): Promise<unknown[]> };
  slot: { createSlot(id: string): Promise<void>; destroySlot(id: string): Promise<void> };
}
declare global { interface Window { electronAPI?: DesktopProbePort } }
function Home() {
  const [count, setCount] = useState(0)
  const [result, setResult] = useState('')
  async function readDesktop() {
    try {
      const api = window.electronAPI
      if (!api) throw new Error('No desktop preload')
      setResult(JSON.stringify({ version: await api.getVersion(), theme: (await api.preferences.get()).theme, localFollowCount: (await api.follows.getAll()).length, browserNote: localStorage.getItem('start-prototype-note') }))
    } catch (error) { setResult(String(error)) }
  }
  async function savePreference() {
    try {
      if (!window.electronAPI) throw new Error('No desktop preload')
      localStorage.setItem('start-prototype-note', 'kept')
      setResult(JSON.stringify({theme: (await window.electronAPI.preferences.update({ theme: 'light' })).theme}))
    } catch (error) { setResult(String(error)) }
  }
  async function createSlot() {
    try {
      if (!window.electronAPI) throw new Error('No desktop preload')
      await window.electronAPI.slot.createSlot('start-prototype')
      setResult('Player slot created')
    } catch (error) { setResult(String(error)) }
  }
  async function destroySlot() {
    try {
      if (!window.electronAPI) throw new Error('No desktop preload')
      await window.electronAPI.slot.destroySlot('start-prototype')
      setResult('Player slot destroyed')
    } catch (error) { setResult(String(error)) }
  }
  return <main><h2>Home</h2><button onClick={() => setCount(count + 1)}>Count {count}</button>
    <button onClick={readDesktop}>Read desktop state</button>
    <button onClick={savePreference}>Save probe preference</button>
    <button onClick={createSlot}>Create player slot</button>
    <button onClick={destroySlot}>Destroy player slot</button>
    <pre data-probe-result>{result}</pre>
  </main>
}
