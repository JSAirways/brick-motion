'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'native', 'camera-mf', 'build')
const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')

function tryRemoveBuild() {
  if (!fs.existsSync(buildDir)) {
    return
  }
  try {
    fs.rmSync(buildDir, {
      recursive: true,
      force: true,
      maxRetries: 15,
      retryDelay: 150
    })
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      console.warn(
        '[native-build] Could not remove native/camera-mf/build (files may be locked). ' +
          'Continuing with configure+build.\n'
      )
      return
    }
    throw err
  }
}

tryRemoveBuild()

const result = spawnSync(
  process.execPath,
  [nodeGyp, 'configure', 'build', '--directory', 'native/camera-mf'],
  {
    cwd: root,
    stdio: 'inherit'
  }
)

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status === null ? 1 : result.status)
