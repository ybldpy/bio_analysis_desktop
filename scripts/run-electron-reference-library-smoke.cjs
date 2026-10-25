// Launch an isolated offline harness, never the application's real main process.
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const temporaryRoot = path.resolve(os.tmpdir())
const userData = fs.mkdtempSync(path.join(temporaryRoot, 'bio-reference-library-smoke-'))
const env = { ...process.env, BIO_REFERENCE_LIBRARY_SMOKE_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [path.join(__dirname, 'electron-reference-library-smoke.cjs')], {
  cwd: path.resolve(__dirname, '..'),
  env,
  windowsHide: true,
  stdio: 'inherit'
})
let expired = false
let finished = false
const deadline = setTimeout(() => {
  expired = true
  console.error('Reference library smoke exceeded its 58-second launcher deadline.')
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 1000
    })
  } else child.kill()
}, 58000)
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  // Validate the exact temporary directory before recursive cleanup.
  const resolved = path.resolve(userData)
  if (
    path.dirname(resolved) === temporaryRoot &&
    path.basename(resolved).startsWith('bio-reference-library-smoke-')
  ) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    } catch (error) {
      console.error('Temporary profile cleanup:', error.message)
    }
  }
  process.exitCode = expired ? 124 : (code ?? 1)
}
child.on('error', (error) => {
  console.error(JSON.stringify({ success: false, domAssertions: 0, error: error.message }))
  finish(1)
})
child.on('exit', finish)
