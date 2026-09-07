import fs from 'node:fs';
const b='apps/desktop/src/frontend/features/settings/';
fs.mkdirSync(b+'adapters/browser',{recursive:true});
const reporter=b+'composition/diagnostics/renderer-diagnostics-reporter.ts';
let source=fs.readFileSync(reporter,'utf8');
source=source.replace(/^import .*\n/gm, '');
source=`import type { DiagnosticsClient } from '../../capabilities/diagnostics-client';
import type { RendererCounters } from '../../capabilities/renderer-counters';
import { createManagedInterval } from '@shared/utils/managed-interval';
`+source;
source=source.replace('startRendererDiagnosticsReporter(): () => void','startRendererDiagnosticsReporter(client: DiagnosticsClient, counters: RendererCounters): () => void');
source=source.replaceAll('getChatStoreDiagnosticCounters()','counters.chatCalls()').replaceAll('getRenderCounts()','counters.renderCounts()').replaceAll('getActiveIntervalCount()','counters.intervalCount()').replaceAll('getDiagnosticsClient()','client');
fs.writeFileSync(b+'adapters/browser/renderer-diagnostics-reporter.ts',source);
fs.writeFileSync(reporter,`import { getActiveIntervalCount } from '@/components/dev/interval-tracker';
import { getRenderCounts } from '@/components/dev/use-render-count';
import { getChatStoreDiagnosticCounters } from '@/features/chat/components/state/chat-store';
import { startRendererDiagnosticsReporter as startReporter } from '../../adapters/browser/renderer-diagnostics-reporter';
import { getDiagnosticsClient } from '../settings-services';

export function startRendererDiagnosticsReporter(): () => void {
  return startReporter(getDiagnosticsClient(), {
    chatCalls: getChatStoreDiagnosticCounters,
    renderCounts: getRenderCounts,
    intervalCount: getActiveIntervalCount,
  });
}
`);
const activity=b+'composition/diagnostics/renderer-activity-reporter.ts';
let activitySource=fs.readFileSync(activity,'utf8');
const start=activitySource.indexOf('    let previousChatEvents');
const end=activitySource.indexOf('\n  }, []);',start);
let body=activitySource.slice(start,end).replaceAll('getChatStoreDiagnosticCounters()','chatCounters()').replaceAll('getDiagnosticsClient()','client').replace('normalizedRoute()','normalizedRoute(window.location.hash, window.location.pathname)');
fs.writeFileSync(b+'adapters/browser/renderer-activity-reporter.ts',`import type { DiagnosticsClient } from '../../capabilities/diagnostics-client';
import { normalizedRoute } from '../../domain/activity-route';
import { createManagedInterval } from '@shared/utils/managed-interval';

function total(counters: { addMessage: number; addMessageBatched: number }): number {
  return counters.addMessage + counters.addMessageBatched;
}

export function startRendererActivityReporter(client: DiagnosticsClient, chatCounters: () => { addMessage: number; addMessageBatched: number }): () => void {
${body}
}
`);
fs.writeFileSync(b+'components/hooks/use-renderer-activity-reporter.ts',`import { useEffect } from 'react';
import { startRendererActivityReporter } from '../../composition/diagnostics/renderer-activity-reporter';

export function useRendererActivityReporter(): void {
  useEffect(startRendererActivityReporter, []);
}
`);
fs.writeFileSync(activity,`import { getChatStoreDiagnosticCounters } from '@/features/chat/components/state/chat-store';
import { startRendererActivityReporter as startReporter } from '../../adapters/browser/renderer-activity-reporter';
import { getDiagnosticsClient } from '../settings-services';

export function startRendererActivityReporter(): () => void {
  return startReporter(getDiagnosticsClient(), getChatStoreDiagnosticCounters);
}
`);
const app='apps/desktop/src/frontend/App.tsx';
fs.writeFileSync(app,fs.readFileSync(app,'utf8').replace('@/features/settings/composition/diagnostics/renderer-activity-reporter','@/features/settings/components/hooks/use-renderer-activity-reporter'));
const net=b+'components/hooks/network-status-store.ts';
let network=fs.readFileSync(net,'utf8');
network=network.replace(/async function probeConnectivity\(\)[\s\S]*?\n}\n\n/, '');
network=`import { probeConnectivity } from '../../adapters/electron/connectivity-probe';\n`+network;
fs.writeFileSync(net,network);
