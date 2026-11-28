import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { isUsableExternalNode } from '../src/native-rtc-helper.js'

it('probes external RTC runtimes without entering Electron GUI mode and rejects Electron before loading native code', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-rtc-node-probe-'))
  const previousNodeOptions = process.env.NODE_OPTIONS
  try {
    const preload = join(directory, 'preload.cjs')
    const observed = join(directory, 'mode')
    const loaded = join(directory, 'native-loaded')
    const moduleDirectory = join(directory, 'node_modules', '@roamhq', 'wrtc')
    mkdirSync(moduleDirectory, { recursive: true })
    writeFileSync(join(moduleDirectory, 'index.js'), `
      require('node:fs').writeFileSync(${JSON.stringify(loaded)}, 'loaded');
      exports.RTCPeerConnection = function () {};
    `)
    process.env.NODE_OPTIONS = `--require ${JSON.stringify(preload)}`
    await runScenarios([false, true].map(electron => ({
      name: electron ? 'Electron candidate stays in Node mode and is rejected' : 'standalone Node remains usable',
      run: () => {
        rmSync(loaded, { force: true })
        writeFileSync(preload, `
          const fs = require('node:fs');
          const mode = process.env.ELECTRON_RUN_AS_NODE === '1' ? 'node' : 'gui';
          fs.writeFileSync(${JSON.stringify(observed)}, mode);
          if (mode === 'gui') process.exit(79);
          ${electron ? "process.versions.electron = 'test-electron';" : ''}
        `)
        expect(isUsableExternalNode(process.execPath, join(directory, 'entry.js'))).toBe(!electron)
        expect(readFileSync(observed, 'utf8')).toBe('node')
        expect(existsSync(loaded)).toBe(!electron)
      },
    })))
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previousNodeOptions
    rmSync(directory, { recursive: true, force: true })
  }
})
