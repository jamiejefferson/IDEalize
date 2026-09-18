import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogFileSink, logFileName } from '../src/log-files.ts'

function todaySuffix(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function sink(maxFileBytes = 10 * 1024 * 1024, maxDirectoryBytes = 200 * 1024 * 1024): { s: LogFileSink; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-log-'))
  return { s: new LogFileSink(dir, { maxFileBytes, maxDirectoryBytes }), dir }
}

describe('logFileName', () => {
  it('names the full and error logs by date and segment', () => {
    expect(logFileName('2026-08-16', false, 0)).toBe('dsh-2026-08-16.log')
    expect(logFileName('2026-08-16', true, 0)).toBe('dsh-2026-08-16.error.log')
    expect(logFileName('2026-08-16', false, 2)).toBe('dsh-2026-08-16.2.log')
  })
})

afterEach(() => { vi.useRealTimers() })

describe('LogFileSink burst coalescing', () => {
  function coalescing(maxFileBytes = 10 * 1024 * 1024): { s: LogFileSink; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-log-'))
    return { s: new LogFileSink(dir, { maxFileBytes, maxDirectoryBytes: 200 * 1024 * 1024, coalesceMs: 100 }), dir }
  }

  it('holds a warning burst and writes it in order once the window elapses', () => {
    vi.useFakeTimers()
    const { s, dir } = coalescing()
    const day = todaySuffix()
    s.write('info', 'one')
    s.write('warn', 'two')
    s.write('warn', 'three')

    expect(readdirSync(dir)).toEqual([])
    vi.advanceTimersByTime(100)

    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe('one\ntwo\nthree\n')
    expect(readFileSync(join(dir, `dsh-${day}.error.log`), 'utf8')).toBe('two\nthree\n')
  })

  it('writes an error at once, after the lines that were waiting', () => {
    vi.useFakeTimers()
    const { s, dir } = coalescing()
    const day = todaySuffix()
    s.write('warn', 'before')
    s.write('error', 'fatal')

    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe('before\nfatal\n')
    expect(readFileSync(join(dir, `dsh-${day}.error.log`), 'utf8')).toBe('before\nfatal\n')
  })

  it('writes waiting lines on flush, on close and ahead of a header', () => {
    vi.useFakeTimers()
    const { s, dir } = coalescing()
    const day = todaySuffix()
    const full = join(dir, `dsh-${day}.log`)
    s.write('info', 'a')
    s.flush()
    expect(readFileSync(full, 'utf8')).toBe('a\n')
    s.write('info', 'b')
    s.writeHeader('--- header ---')
    expect(readFileSync(full, 'utf8')).toBe('a\nb\n--- header ---\n')
    s.write('info', 'c')
    s.close()
    expect(readFileSync(full, 'utf8')).toBe('a\nb\n--- header ---\nc\n')
    vi.advanceTimersByTime(1_000)
    expect(readFileSync(full, 'utf8')).toBe('a\nb\n--- header ---\nc\n')
  })

  it('rotates inside a burst on the same line as one append per line', () => {
    vi.useFakeTimers()
    const { s, dir } = coalescing(10)
    const day = todaySuffix()
    s.write('info', 'x'.repeat(8))
    s.write('info', 'y'.repeat(8))
    s.write('info', 'z')
    s.flush()

    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe(`${'x'.repeat(8)}\n`)
    expect(readFileSync(join(dir, `dsh-${day}.1.log`), 'utf8')).toBe(`${'y'.repeat(8)}\n`)
    expect(readFileSync(join(dir, `dsh-${day}.2.log`), 'utf8')).toBe('z\n')
  })

  it('drops waiting lines when the logs are cleared', () => {
    vi.useFakeTimers()
    const { s, dir } = coalescing()
    s.write('info', 'gone')
    s.clear()
    vi.advanceTimersByTime(1_000)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('LogFileSink', () => {
  it('rejects a linked log directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-log-link-'))
    const target = join(root, 'target')
    const linked = join(root, 'logs')
    mkdirSync(target)
    symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir')

    expect(() => new LogFileSink(linked, {
      maxFileBytes: 100,
      maxDirectoryBytes: 1_000,
    })).toThrow(/linked log directory/u)
  })

  it('skips an unsafe entry occupying the next log file name', () => {
    const { s, dir } = sink()
    const day = todaySuffix()
    const occupied = join(dir, `dsh-${day}.log`)
    mkdirSync(occupied)

    expect(() => { s.write('info', 'safe output') }).not.toThrow()
    expect(existsSync(occupied)).toBe(true)
    expect(readFileSync(join(dir, `dsh-${day}.1.log`), 'utf8')).toBe('safe output\n')
  })

  it('writes info to the full log only, and errors to both logs', () => {
    const { s, dir } = sink()
    s.write('info', 'hello info')
    s.write('error', 'hello error')
    s.close()
    const day = todaySuffix()
    expect(readdirSync(dir).sort()).toEqual([`dsh-${day}.error.log`, `dsh-${day}.log`])
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe('hello info\nhello error\n')
    expect(readFileSync(join(dir, `dsh-${day}.error.log`), 'utf8')).toBe('hello error\n')
  })

  it('rotates a file when it exceeds the per-file cap', () => {
    const { s, dir } = sink(10)
    s.write('info', 'x'.repeat(8))
    s.write('info', 'y'.repeat(8))
    s.close()
    const day = todaySuffix()
    const files = readdirSync(dir).filter(f => !f.includes('.error')).sort()
    expect(files).toEqual([`dsh-${day}.1.log`, `dsh-${day}.log`])
  })

  it('continues rotation from files written by an earlier process', () => {
    const { s, dir } = sink(10)
    s.write('info', '12345678')
    s.close()

    const restarted = new LogFileSink(dir, { maxFileBytes: 10, maxDirectoryBytes: 100 })
    restarted.write('info', 'abcdefgh')

    const day = todaySuffix()
    const files = readdirSync(dir).filter(file => !file.includes('.error')).sort()
    expect(files).toEqual([`dsh-${day}.1.log`, `dsh-${day}.log`])
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe('12345678\n')
    expect(readFileSync(join(dir, `dsh-${day}.1.log`), 'utf8')).toBe('abcdefgh\n')
  })

  it('rotates by UTF-8 bytes rather than JavaScript character count', () => {
    const { s, dir } = sink(10)
    s.write('info', '\u4e2d\u6587')
    s.write('info', '\u6d4b\u8bd5')

    const day = todaySuffix()
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe('\u4e2d\u6587\n')
    expect(readFileSync(join(dir, `dsh-${day}.1.log`), 'utf8')).toBe('\u6d4b\u8bd5\n')
  })

  it('truncates one oversized record to the per-file byte cap', () => {
    const { s, dir } = sink(10)
    s.write('info', 'x'.repeat(20))

    const day = todaySuffix()
    const path = join(dir, `dsh-${day}.log`)
    expect(readFileSync(path, 'utf8')).toBe(`${'x'.repeat(9)}\n`)
  })

  it('enforces the directory cap while the process is running', () => {
    const { s, dir } = sink(10, 15)
    s.write('info', '12345678')
    s.write('info', 'abcdefgh')

    const day = todaySuffix()
    expect(readdirSync(dir)).toEqual([`dsh-${day}.1.log`])
    expect(readFileSync(join(dir, `dsh-${day}.1.log`), 'utf8')).toBe('abcdefgh\n')
  })

  it('purges only owned regular log files', () => {
    const { s, dir } = sink()
    const nested = join(dir, 'nested')
    const foreign = join(dir, 'notes.txt')
    const oldLog = join(dir, 'dsh-2020-01-01.log')
    mkdirSync(nested)
    writeFileSync(foreign, 'keep')
    writeFileSync(oldLog, 'remove')
    const old = new Date('2020-01-01T00:00:00Z')
    utimesSync(nested, old, old)
    utimesSync(foreign, old, old)
    utimesSync(oldLog, old, old)

    expect(() => { s.purgeOlderThan(7) }).not.toThrow()
    expect(existsSync(nested)).toBe(true)
    expect(existsSync(foreign)).toBe(true)
    expect(existsSync(oldLog)).toBe(false)
  })

  it('clear removes all files and reopens fresh streams', () => {
    const { s, dir } = sink()
    s.write('info', 'first')
    s.clear()
    s.write('info', 'second')
    s.close()
    const day = todaySuffix()
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toBe('second\n')
  })

  it('writeHeader writes a marker line before ordinary lines', () => {
    const { s, dir } = sink()
    s.writeHeader('--- dsh 2.0.0 darwin run 123 ---')
    s.write('info', 'after header')
    s.close()
    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text.split('\n')[0]).toBe('--- dsh 2.0.0 darwin run 123 ---')
    expect(text).toContain('after header')
  })

  it('masks secrets at the file boundary', () => {
    const { s, dir } = sink()

    s.write('error', 'Authorization: Bearer abc.def.secret')

    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text).toContain('Bearer ****')
    expect(text).not.toContain('abc.def.secret')
  })
})
