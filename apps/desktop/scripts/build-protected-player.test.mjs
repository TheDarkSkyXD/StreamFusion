import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const builder = path.join(desktop, 'scripts', 'build-protected-player.mjs')

test('builds the native helper and runs its protocol tests', () => {
  const build = spawnSync(process.execPath, [builder, '--arch', 'x64', '--test'], {
    cwd: desktop,
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.equal(build.status, 0, build.stderr || build.stdout)
  assert.match(build.stdout, /HostProtocolTests passed/)
  const output = path.join(desktop, '.cache', 'native', 'protected-player')
  for (const name of [
    'StreamFusion.ProtectedPlayer.exe',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll',
    'Microsoft.Web.WebView2.LICENSE.txt',
    'Microsoft.Web.WebView2.NOTICE.txt',
    'renderer/src/frontend/features/playback/routes/protected-player.html',
  ]) {
    assert.equal(existsSync(path.join(output, name)), true, name)
  }
  const pagePath = path.join(output, 'renderer', 'src', 'frontend', 'features', 'playback', 'routes', 'protected-player.html')
  const page = readFileSync(pagePath, 'utf8')
  assert.match(page, /protectedPlayer-[\w-]+\.js/)
  for (const [, resource] of page.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.equal(existsSync(path.resolve(path.dirname(pagePath), resource)), true, resource)
  }
  const invalid = spawnSync(path.join(output, 'StreamFusion.ProtectedPlayer.exe'), [
    '--channel', 'bad/url', '--owner', '12345', '--parent-pid', '456',
    '--user-data-dir', 'C:\\StreamFusion\\protected-player', '--muted', 'false',
  ], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(invalid.status, 2, invalid.stderr)
  assert.deepEqual(JSON.parse(invalid.stdout.trim()), { type: 'failed', message: 'Invalid channel.' })
  const cached = spawnSync(process.execPath, [builder, '--arch', 'x64'], {
    cwd: desktop,
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(cached.status, 0, cached.stderr)
  assert.match(cached.stdout, /up to date for x64/)
})
