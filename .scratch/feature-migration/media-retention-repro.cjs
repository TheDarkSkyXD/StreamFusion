const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('apps/desktop/src/frontend/features/playback/adapters/browser/hls-playback-session.ts', 'utf8');
class Hls {
  static Events = Object.fromEntries(['MANIFEST_PARSED', 'ERROR', 'FRAG_LOADED', 'LEVEL_SWITCHED', 'BUFFER_FLUSHING'].map(event => [event, event]));
  static isSupported() { return true; }
  static ErrorTypes = {};
  listeners = new Map();
  levels = [];
  constructor(config) { this.config = config; }
  on(event, listener) { this.listeners.set(event, [...(this.listeners.get(event) || []), listener]); }
  off(event, listener) {
    if (!listener) this.listeners.delete(event);
    else this.listeners.set(event, (this.listeners.get(event) || []).filter(value => value !== listener));
  }
  loadSource() {} attachMedia() {} detachMedia() {} destroy() {} stopLoad() {} startLoad() {}
}
const moduleExports = {};
const mocks = {
  'hls.js': Hls,
  '@/renderer/logging/logger': { logger: { debug() {}, info() {}, warn() {}, error() {} } },
  './hls-buffer-config': { resolveHlsBufferConfig: () => ({}), resolveHlsVodBufferConfig: () => ({}) },
  '../../domain/quality-preference': { resolvePreferredQualityId: () => 'auto' },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: moduleExports, require: id => { if (!(id in mocks)) throw Error(id); return mocks[id]; }, navigator: {}, URL, Date, setTimeout,
});
const ast = ts.createSourceFile('session.ts', source, ts.ScriptTarget.Latest, true);
const bindingsType = ast.statements.find(statement => statement.name?.text === 'SessionBindings');
const bindings = Object.fromEntries(bindingsType.members.map(member => [member.name.text, member.name.text.endsWith('Ref') ? { current: null } : () => {}]));
Object.assign(bindings, { videoRef: { current: { addEventListener() {}, removeEventListener() {}, paused: true } }, isLive: true, autoPlay: false, bufferPreferences: {}, src: 'https://example.test/first.m3u8' });
let cleanup;
for (let index = 0; index < 100; index++) {
  cleanup?.();
  bindings.src = `https://example.test/${index}.m3u8`;
  cleanup = moduleExports.startHlsPlaybackSession(bindings);
}
const qualityListeners = bindings.hlsRef.current.listeners.get('LEVEL_SWITCHED')?.length || 0;
console.log(JSON.stringify({ sourceSwitches: 100, retainedQualityListeners: qualityListeners, expected: 1 }));
const following = fs.readFileSync('apps/desktop/src/frontend/features/discovery/components/screens/Following/index.tsx', 'utf8');
const followingAst = ts.createSourceFile('following.tsx', following, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const preloader = followingAst.statements.find(statement => statement.name?.text === 'preloadCategoryThumbnail');
if (preloader) {
  const images = new Map();
  vm.runInNewContext(ts.transpileModule(preloader.getText(followingAst), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nfor(let index=0;index<10000;index++)preloadCategoryThumbnail("https://example.test/"+index+".webp");', { preloadedCategoryThumbnails: images, Image: class {} });
  console.log(JSON.stringify({ requestedCategoryThumbnails: 10000, retainedImages: images.size, expectedMaximum: 24 }));
  if (images.size > 24) process.exitCode = 1;
}
if (qualityListeners !== 1) process.exitCode = 1;
