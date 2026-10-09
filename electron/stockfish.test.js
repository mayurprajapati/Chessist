import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pickWindowsAsset, peMachine, canRun } from './stockfish.js'

const asset = (name) => ({ name, browser_download_url: name })

// Release assets of sf_19 — one universal build per architecture, ARM64 listed first.
const SF19 = [
  'stockfish-android-arm64-universal.tar.gz',
  'stockfish-linux-x86-64-universal.tar.gz',
  'stockfish-macos-universal.tar.gz',
  'stockfish-windows-arm64-universal.zip',
  'stockfish-windows-x86-64-universal.zip',
].map(asset)

describe('pickWindowsAsset', () => {
  it('prefers the avx2 windows build', () => {
    const assets = [
      asset('stockfish-ubuntu-x86-64-avx2.tar'),
      asset('stockfish-windows-x86-64-sse41-popcnt.zip'),
      asset('stockfish-windows-x86-64-avx2.zip'),
    ]
    expect(pickWindowsAsset(assets, 'x64')).toBe('stockfish-windows-x86-64-avx2.zip')
  })

  it('falls back to the first build for the architecture', () => {
    const assets = [asset('stockfish-windows-x86-64.zip'), asset('stockfish-android.zip')]
    expect(pickWindowsAsset(assets, 'x64')).toBe('stockfish-windows-x86-64.zip')
  })

  it('picks the x64 universal build on x64, never the ARM64 one', () => {
    expect(pickWindowsAsset(SF19, 'x64')).toBe('stockfish-windows-x86-64-universal.zip')
  })

  it('picks the ARM64 build on ARM64', () => {
    expect(pickWindowsAsset(SF19, 'arm64')).toBe('stockfish-windows-arm64-universal.zip')
  })

  it('uses an x64 build on ARM64 when there is no native one', () => {
    expect(pickWindowsAsset([asset('stockfish-windows-x86-64-avx2.zip')], 'arm64')).toBe('stockfish-windows-x86-64-avx2.zip')
  })

  it('returns null when no windows asset matches the architecture', () => {
    expect(pickWindowsAsset([asset('stockfish-mac.tar')], 'x64')).toBeNull()
    expect(pickWindowsAsset([asset('stockfish-windows-arm64-universal.zip')], 'x64')).toBeNull()
  })
})

describe('peMachine / canRun', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chessist-pe-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  // Minimal PE: DOS header ("MZ", e_lfanew = 0x40) followed by "PE\0\0" + Machine.
  const writeExe = (name, machine) => {
    const buf = Buffer.alloc(0x48)
    buf.write('MZ', 0, 'latin1')
    buf.writeUInt32LE(0x40, 0x3c)
    buf.write('PE\0\0', 0x40, 'latin1')
    buf.writeUInt16LE(machine, 0x44)
    const file = path.join(dir, name)
    fs.writeFileSync(file, buf)
    return file
  }
  const x64 = writeExe('x64.exe', 0x8664)
  const arm64 = writeExe('arm64.exe', 0xaa64)
  const junk = path.join(dir, 'junk.exe')
  fs.writeFileSync(junk, 'not an executable')

  it('reads the Machine field', () => {
    expect(peMachine(x64)).toBe(0x8664)
    expect(peMachine(arm64)).toBe(0xaa64)
    expect(peMachine(junk)).toBeNull()
    expect(peMachine(path.join(dir, 'missing.exe'))).toBeNull()
  })

  it('rejects ARM64 builds on x64 hosts', () => {
    expect(canRun(x64, 'x64')).toBe(true)
    expect(canRun(arm64, 'x64')).toBe(false)
  })

  it('accepts native and emulated builds on ARM64 hosts', () => {
    expect(canRun(arm64, 'arm64')).toBe(true)
    expect(canRun(x64, 'arm64')).toBe(true)
  })

  it('rejects files that are not executables', () => {
    expect(canRun(junk, 'x64')).toBe(false)
  })
})
