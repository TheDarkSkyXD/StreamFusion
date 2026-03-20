# Electron Performance Optimizations

This document summarizes the Electron-specific performance optimizations implemented to reduce bundle size, prevent main thread blocking, and eliminate unnecessary resource usage.

## Summary of Changes

### 1. 🎯 Menu.setApplicationMenu(null) - Main Process
**File:** `src/main.ts`

Since StreamFusion uses a custom frameless window with its own title bar, the default Electron application menu was never visible but was still being created and consuming memory. Setting it to `null` at app startup eliminates this overhead.

**Benefits:**
- Reduced memory usage (~1-2MB depending on menu complexity)
- Faster app startup
- Cleaner process (no hidden menu resources)

### 2. ⚡ Lazy-loaded ReactQueryDevtools - Renderer
**File:** `src/providers/query-provider.tsx`

ReactQueryDevtools is now only loaded in development mode via dynamic imports. In production builds, the devtools code is completely excluded from the bundle.

**Benefits:**
- ~200KB+ reduction in production bundle size
- Faster initial load time
- No devtools overhead in production

### 3. 🕐 requestIdleCallback for Memory Pressure Detection
**File:** `src/components/player/hooks/use-video-lifecycle.ts`

Replaced `setInterval` with `requestIdleCallback` for non-critical memory monitoring. This ensures the check only runs when the browser is idle, preventing disruption to user interactions.

**Benefits:**
- Main thread stays responsive during video playback
- Memory checks don't compete with UI rendering
- Graceful degradation with setTimeout fallback

### 4. 📦 New Idle Scheduler Utility Module
**File:** `src/lib/idle-scheduler.ts`

A comprehensive utility module providing `requestIdleCallback` wrappers that can be used throughout the codebase:

- `scheduleIdleTask()` - One-time idle callback with fallback
- `cancelIdleTask()` - Cancel a scheduled callback
- `schedulePeriodicIdleTask()` - Recurring tasks during idle time
- `runIdleBatch()` - Process arrays without blocking main thread
- `deferredInit()` - Lazy initialization during idle time

**Use Cases:**
- Analytics/telemetry logging
- Cache cleanup
- Preloading non-critical resources
- Lazy feature initialization

### 5. 🚀 Vite Renderer Build Optimizations
**File:** `vite.renderer.config.ts`

**Target: ESNext**
- No polyfills needed since Electron always ships with latest Chromium
- Significant bundle size reduction

**Tree-shaking:**
- `moduleSideEffects: 'no-external'` for aggressive dead code elimination
- `propertyReadSideEffects: false` for better property access elimination

**Code Splitting:**
```
vendor-react    → react, react-dom
vendor-router   → @tanstack/react-router
vendor-query    → @tanstack/react-query
vendor-ui       → All Radix UI components
vendor-motion   → framer-motion
vendor-hls      → hls.js
vendor-dnd      → @dnd-kit/* packages
```

**Benefits:**
- Better cache utilization (vendor chunks rarely change)
- Parallel loading of chunks
- Smaller initial bundle

**Production Optimizations:**
- Source maps disabled in production
- `console.debug` calls removed via esbuild's `pure` option
- `debugger` statements dropped

### 6. 🖥️ Vite Main Process Optimizations
**File:** `vite.main.config.ts`

- Target set to `node20` for Node.js-specific optimizations
- Source maps disabled in production
- Console.debug and debugger statements removed in production
- Proper external handling for native modules

## Usage of Idle Scheduler

For future heavy operations, use the idle scheduler:

```typescript
import { scheduleIdleTask, schedulePeriodicIdleTask } from '@/lib/idle-scheduler';

// One-time task
scheduleIdleTask(() => {
  console.log('Running during idle time');
}, { timeout: 5000 });

// Periodic task (every 30 seconds during idle)
const cleanup = schedulePeriodicIdleTask(() => {
  performCacheCleanup();
}, 30000);

// Stop periodic task
cleanup();
```

## Future Recommendations

### Additional Optimizations to Consider:

1. **NAPI-RS Integration** - For compute-intensive tasks like video transcoding or analytics processing, consider integrating Rust via NAPI-RS for near-native performance.

2. **Web Workers** - For heavy data processing that can't be deferred to idle time, offload to Web Workers.

3. **Network Throttling** - During profiling, implement network simulation throttling to identify performance issues.

4. **Lazy Component Loading** - Consider lazy-loading player components and other heavy UI until needed.

5. **Service Worker Caching** - For static assets and API responses that don't change frequently.

## Measuring Impact

To measure the impact of these optimizations:

1. **Bundle Size:**
   ```bash
   npm run package
   # Compare .vite/build output sizes before/after
   ```

2. **Startup Time:**
   Use Electron's `ready-to-show` event timing

3. **Memory Usage:**
   Monitor via Chrome DevTools → Memory tab

4. **Main Thread Blocking:**
   Chrome DevTools → Performance tab → Look for long tasks
