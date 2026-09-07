import fs from 'node:fs';
const base='apps/desktop/src/frontend/features/settings/';
const replacements = [
 ['window.electronAPI.diagnostics','getDiagnosticsClient()'],
 ['window.electronAPI?.logs','getLogReader()'],
 ['window.electronAPI?.bugReports','getBugReportWriter()'],
 ['window.electronAPI?.platformHealth','getPlatformHealthFeed()'],
 ['window.electronAPI?.env','getEnvironmentReader()'],
 ['window.electronAPI?.slot','getPlaybackBudgetSettings()'],
 ['window.electronAPI?.notifications','getNotificationCoverageReader()'],
 ['window.electronAPI?.proxy','getProxySettings()'],
 ['window.electronAPI.proxy','getProxySettings()!'],
 ['window.electronAPI.toggleDevTools()','getDesktopControls()?.toggleDevTools()'],
];
for(const relative of [
 'components/hooks/use-diagnostics-workspace.ts',
 'components/hooks/use-diagnostics-resource-history.ts',
 'components/hooks/usePlatformHealth.ts',
 'components/settings/BugReportSection.tsx',
 'components/settings/LogsSection.tsx',
 'components/screens/Settings/index.tsx',
 'components/screens/Settings/diagnostics/DiagnosticsWorkspace.tsx',
 'composition/diagnostics/renderer-diagnostics-reporter.ts',
 'composition/diagnostics/renderer-activity-reporter.ts',
]) {
 const path=base+relative;let source=fs.readFileSync(path,'utf8');const names=new Set();
 for(const [from,to] of replacements) if(source.includes(from)) {source=source.replaceAll(from,to);names.add(to.match(/get\w+/)[0]);}
 if(names.size) source=`import { ${[...names].join(', ')} } from '@/features/settings/composition/settings-services';\n`+source;
 source=source.replace('type PlatformHealthSnapshot = Awaited<ReturnType<typeof window.electronAPI.platformHealth.get>>;',`import type { PlatformHealthSnapshot } from '../../capabilities/platform-health-feed';`);
 if(relative==='components/screens/Settings/index.tsx') {
   source=`import { getSessionInspector } from '@/features/auth/composition/session-inspector';\n`+source.replace('window.electronAPI.auth.tokenStatus(platform)','getSessionInspector()!.tokenStatus(platform)');
 }
 fs.writeFileSync(path,source);
}
// Remove private hooks with no callers rather than inventing runtime ports for dead code.
const hookPath=base+'components/hooks/useElectron.ts';
let hooks=fs.readFileSync(hookPath,'utf8');
hooks=hooks.replace(/\/\*\*\n \* Check if running in Electron environment[\s\S]*?\n}\n\n/,'');
hooks=hooks.replace(/\/\*\*\n \* Get the system theme preference[\s\S]*?\n}\n\n/,'');
hooks=hooks.slice(0,hooks.indexOf('/**\n * Show desktop notification'));
hooks=hooks.replaceAll('window.electronAPI','getDesktopControls()');
hooks=hooks.replaceAll('getDesktopControls().','getDesktopControls()!.');
hooks=`import { getDesktopControls } from '../../composition/settings-services';\n`+hooks;
fs.writeFileSync(hookPath,hooks);
