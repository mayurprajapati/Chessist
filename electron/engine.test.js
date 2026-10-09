import { describe, it, expect } from 'vitest'
import { parseInfoLine } from './engine.js'

describe('parseInfoLine', () => {
  it('parses cp score and pv', () => {
    const r = parseInfoLine('info depth 20 multipv 1 score cp 35 nps 1200000 pv e2e4 e7e5')
    expect(r).toEqual({ depth: 20, multipv: 1, cp: 35, nps: 1200000, pv: ['e2e4', 'e7e5'], bestMove: 'e2e4' })
  })

  it('parses mate score', () => {
    const r = parseInfoLine('info depth 12 multipv 1 score mate 3 pv d1h5 g8h6')
    expect(r.mate).toBe(3)
    expect(r.cp).toBeUndefined()
    expect(r.bestMove).toBe('d1h5')
  })

  it('returns null for non-score lines', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-xxxx.nnue')).toBeNull()
  })
})

import { defaultHashMb } from './engine.js'

describe('defaultHashMb', () => {
  it('returns a value clamped to [128, 1024]', () => {
    const v = defaultHashMb()
    expect(v).toBeGreaterThanOrEqual(128)
    expect(v).toBeLessThanOrEqual(1024)
  })
})

import { Engine } from './engine.js'

describe('Engine', () => {
  const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

  it('runs an evaluate request that arrived before readyok', () => {
    const engine = new Engine(null, null)
    const sent = []
    engine._send = (cmd) => sent.push(cmd)
    engine.evaluate(FEN, 12, 1)
    expect(sent).toEqual([])
    engine._handle('readyok')
    expect(sent).toContain('position fen ' + FEN)
    expect(sent).toContain('go depth 12')
  })

  it('reports an error instead of hanging when Stockfish cannot be spawned', async () => {
    const statuses = []
    const engine = new Engine(null, (s) => statuses.push(s))
    expect(() => engine.start('Z:/no/such/dir/stockfish.exe')).not.toThrow()
    await new Promise((r) => setTimeout(r, 200))
    expect(statuses.some((s) => s.status === 'error')).toBe(true)
    expect(engine.proc).toBeNull()
  })
})
