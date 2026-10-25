// Launch only the smoke harness, never the application's real main process.
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const workspace = path.resolve(__dirname, '..')
const temporaryRoot = path.resolve(os.tmpdir())
const userData = fs.mkdtempSync(path.join(temporaryRoot, 'bio-results-smoke-'))
const env = { ...process.env, BIO_RESULTS_SMOKE_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [path.join(__dirname, 'electron-results-smoke.cjs')], {
  cwd: workspace,
  env,
  windowsHide: true,
  stdio: 'inherit'
})
let expired = false
const deadline = setTimeout(() => {
  expired = true
  console.error('Smoke harness exceeded its 58-second launcher deadline; terminating it.')
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 1000
    })
  } else child.kill()
}, 58000)
child.on('error', (error) => console.error(error))
child.on('exit', (code) => {
  clearTimeout(deadline)
  // Only remove the exact temporary directory this launcher created.
  const resolved = path.resolve(userData)
  if (
    path.dirname(resolved) === temporaryRoot &&
    path.basename(resolved).startsWith('bio-results-smoke-')
  ) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    } catch (error) {
      console.error('Temporary profile cleanup:', error.message)
    }
  }
  process.exitCode = expired ? 124 : (code ?? 1)
})
