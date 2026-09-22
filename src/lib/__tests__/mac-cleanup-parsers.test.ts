import { describe, expect, it } from 'vitest'
import { cpuLoadPercent } from '@/lib/mac-cleanup/metrics'
import {
  parseDiskFreeGb,
  parseLaunchctlList,
  parseMemoryPressure,
  parsePackageActivity,
  parseStorageLastRun,
  parseSwapUsedPercent,
} from '@/lib/mac-cleanup/parsers'
import { isAllowlistedBinary } from '@/lib/mac-cleanup/trigger'

describe('mac cleanup parsers', () => {
  it('reads memory_pressure free percent', () => {
    const stdout = [
      'The system has 17179869184 (1048576 pages with a page size of 16384).',
      'System-wide memory free percentage: 23%',
    ].join('\n')
    expect(parseMemoryPressure(stdout)).toBe(23)
  })

  it('reads df available gigabytes', () => {
    const stdout = [
      'Filesystem   1024-blocks      Used Available Capacity  Mounted on',
      '/dev/disk3s5   482797652 395567964  16943576    96%    /System/Volumes/Data',
    ].join('\n')
    expect(parseDiskFreeGb(stdout)).toBe(16)
  })

  it('reads swap used percent', () => {
    expect(parseSwapUsedPercent('total = 31744.00M  used = 31071.94M  free = 672.06M')).toBe(98)
  })

  it('parses launchctl list rows', () => {
    const map = parseLaunchctlList([
      '-	0	com.tylerdevries.clean-mac',
      '123	0	com.tylerdevries.mac-resource-guardian',
      'PID	Status	Label',
    ].join('\n'))
    expect(map.get('com.tylerdevries.clean-mac')).toEqual({ loaded: true, pid: null, lastExit: 0 })
    expect(map.get('com.tylerdevries.mac-resource-guardian')).toEqual({
      loaded: true,
      pid: 123,
      lastExit: 0,
    })
  })

  it('parses storage last-run JSON', () => {
    const parsed = parseStorageLastRun('{"timestamp":"2026-09-04T22:53:30Z","code":"critical_pressure","disk_free_before_gb":19,"disk_free_after_gb":19,"attempted_tools":0,"deferred_tools":2,"failed_tools":0}')
    expect(parsed?.code).toBe('critical_pressure')
    expect(parsed?.deferredTools).toBe(2)
  })

  it('detects npm and pnpm process lines', () => {
    expect(parsePackageActivity('/usr/local/bin/npm install')).toEqual({ npmActive: true, pnpmActive: false })
    expect(parsePackageActivity('/Users/t/.nvm/versions/node/v24.16.0/bin/pnpm test')).toEqual({
      npmActive: false,
      pnpmActive: true,
    })
    expect(parsePackageActivity('')).toEqual({ npmActive: false, pnpmActive: false })
  })
})

describe('cpuLoadPercent', () => {
  it('normalizes load average to percent of cores', () => {
    expect(cpuLoadPercent([8.5, 4, 2], 10)).toBe(85)
    expect(cpuLoadPercent([27, 50, 50], 10)).toBe(100)
  })
})

describe('isAllowlistedBinary', () => {
  const expected = '/Users/t/.local/libexec/mac-resource-guardian/mac-resource-guardian'
  const ok = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 501,
    mode: 0o100700,
    nlink: 1,
  }

  it('accepts a mode-700 owned regular file', () => {
    expect(isAllowlistedBinary(expected, expected, ok, 501)).toBe(true)
  })

  it('rejects a group-writable or world-writable mode', () => {
    expect(isAllowlistedBinary(expected, expected, { ...ok, mode: 0o100755 }, 501)).toBe(false)
  })

  it('rejects a symlink', () => {
    expect(isAllowlistedBinary(expected, expected, { ...ok, isSymbolicLink: () => true }, 501)).toBe(false)
  })
})
