const fs=require('node:fs');
function edit(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
const b='apps/desktop/src/backend/';
edit(b+'ipc/lazy-feature-loader.ts',s=>{
 s=s.replace(/(\[IPC_FEATURES\.AUTH\][\s\S]*?)(?=\[IPC_FEATURES\.BUG_REPORTS\])/,(x)=>x.replaceAll('twitchDiscovery','twitchAccountReader').replaceAll('kickDiscovery','kickAccountReader').replaceAll('features/discovery/composition/twitch-discovery','features/authentication/composition/twitch-account-reader').replaceAll('features/discovery/composition/kick-discovery','features/authentication/composition/kick-account-reader'));
 s=s.replace(/(\[IPC_FEATURES\.VIDEOS\][\s\S]*?)(?=\n  \},)/,x=>x.replaceAll('twitchDiscovery','twitchPlayback').replaceAll('kickDiscovery','kickPlayback').replaceAll('features/discovery/composition/twitch-discovery','features/playback/composition/twitch-playback').replaceAll('features/discovery/composition/kick-discovery','features/playback/composition/kick-playback'));
 s=s.replace('registerChannelHandlers({ readers:',`const { twitchAccountReader } = await import('@backend/features/authentication/composition/twitch-account-reader');\n    registerChannelHandlers({ twitchFollows: twitchAccountReader, readers:`);
 s=s.replace('registerSearchHandlers({ readers:',`const [{ twitchPlayback }, { kickPlayback }] = await Promise.all([import('@backend/features/playback/composition/twitch-playback'), import('@backend/features/playback/composition/kick-playback')]);\n    registerSearchHandlers({ contentReaders: { twitch: twitchPlayback, kick: kickPlayback }, readers:`);
 return s;
});
edit(b+'features/discovery/tests/ipc/handlers/channel-handlers.test.ts',s=>s.replace('registerChannelHandlers({ readers:', 'registerChannelHandlers({ twitchFollows: twitchAccountReader, readers:'));
edit(b+'features/discovery/tests/ipc/handlers/search-handlers.test.ts',s=>s.replace('registerSearchHandlers({ readers:', 'registerSearchHandlers({ contentReaders: { twitch: twitchPlayback, kick: kickPlayback }, readers:'));
edit(b+'features/discovery/tests/search/focused-search-sources.test.ts',s=>s.replace('createFocusedRecentContentSources(clients)', 'createFocusedRecentContentSources(clients, clients)'));
for(const feature of ['authentication','playback']) {
 const adapter=b+`features/${feature}/adapters/kick/kick-${feature==='authentication'?'account-reader':'playback-reader'}.ts`;
 edit(adapter,s=>s.replace(/private readonly requestor: KickRequestor,?\s*/,'').replace(/constructor\(\) \{\}\s*/,'').replace(/import type \{ KickRequestor \} from [^;]+;\s*/,''));
 edit(b+`features/${feature}/composition/kick-${feature==='authentication'?'account-reader':'playback'}.ts`,s=>s.replace(/import \{ kickTransport \}[^;]+;\s*/,'').replace(/\(kickTransport,?\s*/,'('));
}
