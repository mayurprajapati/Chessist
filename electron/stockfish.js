const fs = require('fs')
const path = require('path')
const https = require('https')
const os = require('os')
const extract = require('extract-zip')

const RELEASES_API = 'https://api.github.com/repos/official-stockfish/Stockfish/releases/latest'

const X64 = /x86-64|x64|amd64/i
const ARM64 = /arm64|aarch64|armv8/i

// Asset names changed across releases: per-CPU builds up to sf_18
// (stockfish-windows-x86-64-avx2.zip, …), one runtime-dispatching build per
// architecture from sf_19 (stockfish-windows-x86-64-universal.zip). Always match
// the host architecture — "any Windows zip" picked the ARM64 build on x64 PCs.
function pickWindowsAsset(assets, arch = process.arch) {
  const win = assets.filter(a => /windows/i.test(a.name) && /\.zip$/i.test(a.name))
  let matches = win.filter(a => (arch === 'arm64' ? ARM64 : X64).test(a.name))
  // Windows on ARM runs x64 builds under emulation.
  if (matches.length === 0 && arch === 'arm64') matches = win.filter(a => X64.test(a.name))
  if (matches.length === 0) return null
  const pick = matches.find(a => /universal/i.test(a.name)) || matches.find(a => /avx2/i.test(a.name)) || matches[0]
  return pick.browser_download_url
}

// Target CPU from a Windows executable's PE header ("Machine" field), or null if
// the file isn't a valid executable.
function peMachine(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const dos = Buffer.alloc(64)
    if (fs.readSync(fd, dos, 0, 64, 0) < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null
    const pe = Buffer.alloc(6)
    if (fs.readSync(fd, pe, 0, 6, dos.readUInt32LE(0x3c)) < 6 || pe.toString('latin1', 0, 4) !== 'PE\0\0') return null
    return pe.readUInt16LE(4)
  } catch { return null } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch {}
  }
}

// Whether this machine can launch the exe. ARM64 builds only run on ARM64 hosts;
// x86/x64 builds run natively or under emulation.
function canRun(file, arch = process.arch) {
  const machine = peMachine(file)
  if (machine === null) return false
  return machine !== 0xaa64 || arch === 'arm64'
}

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Chessist/2.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsJson(res.headers.location))
      }
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Chessist/2.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, dest, onProgress))
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let got = 0
      const out = fs.createWriteStream(dest)
      res.on('data', d => {
        got += d.length
        if (total && onProgress) onProgress(Math.floor(got * 100 / total))
      })
      res.pipe(out)
      out.on('finish', () => out.close(resolve))
      out.on('error', reject)
    }).on('error', reject)
  })
}

// Resolve an existing stockfish path, or download one. userDataDir is app.getPath('userData').
async function ensureStockfish(userDataDir, onStatus) {
  const dest = path.join(userDataDir, 'stockfish.exe')
  if (fs.existsSync(dest)) {
    if (canRun(dest)) return dest
    // Corrupt, or a wrong-architecture build from an older picker — replace it.
    fs.rmSync(dest, { force: true })
  }

  onStatus?.({ status: 'downloading', message: 'Stockfish: connecting...' })
  const release = await httpsJson(RELEASES_API)
  const url = pickWindowsAsset(release.assets || [])
  if (!url) { onStatus?.({ status: 'error', message: 'Stockfish: no Windows build for this CPU' }); return null }

  const tmpZip = path.join(os.tmpdir(), 'stockfish_dl.zip')
  await download(url, tmpZip, pct => onStatus?.({ status: 'downloading', message: `Stockfish: ${pct}%` }))

  const tmpDir = path.join(os.tmpdir(), 'stockfish_extracted')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  await extract(tmpZip, { dir: tmpDir })

  const exe = findExe(tmpDir)
  if (!exe) { onStatus?.({ status: 'error', message: 'Stockfish exe not found in zip' }); return null }
  if (!canRun(exe)) { onStatus?.({ status: 'error', message: 'Stockfish: downloaded build does not run on this CPU' }); return null }
  fs.copyFileSync(exe, dest)
  fs.rmSync(tmpZip, { force: true })
  fs.rmSync(tmpDir, { recursive: true, force: true })

  onStatus?.({ status: 'ready', message: 'Stockfish ready' })
  return dest
}

function findExe(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { const r = findExe(full); if (r) return r }
    else if (/stockfish.*\.exe$/i.test(entry.name)) return full
  }
  return null
}

module.exports = { pickWindowsAsset, peMachine, canRun, ensureStockfish }
