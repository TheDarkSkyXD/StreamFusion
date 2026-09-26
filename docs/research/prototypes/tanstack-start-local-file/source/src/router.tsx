import { createRouter, createHashHistory, createMemoryHistory } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
export function getRouter() {
  return createRouter({ routeTree, history: typeof window === 'undefined' ? createMemoryHistory({ initialEntries: ['/'] }) : createHashHistory() })
}
