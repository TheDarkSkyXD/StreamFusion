import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(desktop, 'native', 'protected-player')
const cache = path.join(desktop, '.cache', 'native')
const output = path.join(cache, 'protected-player')
const version = '1.0.4258.31'
const sha256 = '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9'
const nativeSources = ['Program.cs', 'HostProtocol.cs', 'ProtectedPlayerForm.cs']
const outputFiles = [
  'StreamFusion.ProtectedPlayer.exe',
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'WebView2Loader.dll',
  'Microsoft.Web.WebView2.LICENSE.txt',
  'Microsoft.Web.WebView2.NOTICE.txt',
]

function run(file, args) {
  const result = spawnSync(file, args, { cwd: desktop, encoding: 'utf8', timeout: 120_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${file} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  if (result.stdout) process.stdout.write(result.stdout)
}

async function downloadPackage(archive) {
  if (existsSync(archive)) {
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
    if (digest === sha256) return
  }
  const response = await fetch(`https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${version}`)
  if (!response.ok) throw new Error(`WebView2 SDK download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== sha256) throw new Error(`WebView2 SDK SHA256 mismatch: ${digest}`)
  await writeFile(archive, bytes)
}

function compiler() {
  const windows = process.env.WINDIR || 'C:\\Windows'
  for (const framework of ['Framework64', 'Framework']) {
    const candidate = path.join(windows, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('The .NET Framework C# compiler is required on Windows.')
}

function compile(file, target, sources, sdk) {
  const references = [
    'System.Web.Extensions.dll',
    ...(target === 'winexe' || sources.some((entry) => entry.endsWith('NativeSmokeTests.cs')) ? [
      'System.Windows.Forms.dll',
      'System.Drawing.dll',
    ] : []),
    ...(target === 'winexe' ? [
      path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'),
      path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll'),
    ] : []),
  ]
  run(compiler(), [
    '/nologo', '/optimize+', '/platform:anycpu', `/target:${target}`, `/out:${path.relative(desktop, file)}`,
    ...references.map((reference) => `/reference:${path.isAbsolute(reference) ? path.relative(desktop, reference) : reference}`),
    ...sources.map((entry) => path.relative(desktop, entry)),
  ])
}

const args = process.argv.slice(2)
const archIndex = args.indexOf('--arch')
const arch = archIndex >= 0 ? args[archIndex + 1] : process.arch
if (process.platform !== 'win32') {
  if (args.includes('--if-windows')) process.exit(0)
  throw new Error('The protected player builds on Windows only.')
}
if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported protected player architecture: ${arch}`)
if (args.some((arg) => !['--arch', 'x64', 'arm64', '--test', '--smoke', '--if-windows'].includes(arg))) throw new Error('Unknown build argument.')

await mkdir(cache, { recursive: true })
await mkdir(output, { recursive: true })
const stampPath = path.join(cache, 'protected-player-build.json')
const fingerprint = createHash('sha256')
fingerprint.update(`${version}:${sha256}:${arch}`)
fingerprint.update(await readFile(fileURLToPath(import.meta.url)))
for (const name of nativeSources) fingerprint.update(await readFile(path.join(source, name)))
const buildId = fingerprint.digest('hex')
let isCurrent = false
try {
  isCurrent = JSON.parse(await readFile(stampPath, 'utf8')).buildId === buildId &&
    outputFiles.every((name) => existsSync(path.join(output, name)))
} catch {}
const archive = path.join(cache, `Microsoft.Web.WebView2.${version}.nupkg`)
const sdk = path.join(cache, `Microsoft.Web.WebView2.${version}`)
if (!isCurrent || args.includes('--test')) {
  await downloadPackage(archive)
  if (!existsSync(path.join(sdk, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'))) {
    await mkdir(sdk, { recursive: true })
    run('tar.exe', ['-xf', archive, '-C', sdk])
  }
}
if (!isCurrent) {
  compile(path.join(output, 'StreamFusion.ProtectedPlayer.exe'), 'winexe',
    nativeSources.map((name) => path.join(source, name)), sdk)
  for (const name of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll']) {
    await copyFile(path.join(sdk, 'lib', 'net462', name), path.join(output, name))
  }
  await copyFile(path.join(sdk, 'runtimes', `win-${arch}`, 'native', 'WebView2Loader.dll'), path.join(output, 'WebView2Loader.dll'))
  await copyFile(path.join(sdk, 'LICENSE.txt'), path.join(output, 'Microsoft.Web.WebView2.LICENSE.txt'))
  await copyFile(path.join(sdk, 'NOTICE.txt'), path.join(output, 'Microsoft.Web.WebView2.NOTICE.txt'))
  await writeFile(stampPath, JSON.stringify({ buildId, arch, version }))
}
const files = await readdir(output)
if (files.length < 4) throw new Error('Protected player build is incomplete.')

if (args.includes('--test')) {
  const testExe = path.join(cache, 'HostProtocolTests.exe')
  compile(testExe, 'exe', [path.join(source, 'HostProtocol.cs'), path.join(source, 'HostProtocolTests.cs')], sdk)
  run(testExe, [])
}
if (args.includes('--smoke')) {
  const smokeExe = path.join(cache, 'NativeSmokeTests.exe')
  compile(smokeExe, 'exe', [path.join(source, 'NativeSmokeTests.cs')], sdk)
  run(smokeExe, [path.join(output, 'StreamFusion.ProtectedPlayer.exe'), path.join(cache, 'smoke-profile')])
}
process.stdout.write(`Protected player ${isCurrent ? 'up to date' : 'built'} for ${arch}: ${output}\n`)
