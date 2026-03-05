import { describe, it, expect } from 'vitest'
import { detectFilePaths, type DetectedFilePath } from '@/lib/file-paths'

function paths(text: string): string[] {
  return detectFilePaths(text).map((r) => r.path)
}

describe('detectFilePaths', () => {
  describe('absolute paths', () => {
    it('detects /Users/ paths', () => {
      expect(paths('open /Users/gary/docs/file.txt')).toEqual([
        '/Users/gary/docs/file.txt',
      ])
    })

    it('detects /home/ paths', () => {
      expect(paths('saved to /home/user/data.csv')).toEqual([
        '/home/user/data.csv',
      ])
    })

    it('detects /tmp/ paths', () => {
      expect(paths('/tmp/scratch/output.log')).toEqual([
        '/tmp/scratch/output.log',
      ])
    })

    it('detects /var/ paths', () => {
      expect(paths('check /var/log/syslog')).toEqual(['/var/log/syslog'])
    })

    it('detects /etc/ paths', () => {
      expect(paths('edit /etc/nginx/nginx.conf')).toEqual([
        '/etc/nginx/nginx.conf',
      ])
    })

    it('detects /opt/ paths', () => {
      expect(paths('/opt/homebrew/bin/node')).toEqual([
        '/opt/homebrew/bin/node',
      ])
    })
  })

  describe('tilde paths', () => {
    it('detects ~/... paths', () => {
      expect(paths('created ~/projects/app/index.ts')).toEqual([
        '~/projects/app/index.ts',
      ])
    })

    it('ignores bare ~/', () => {
      expect(paths('go to ~/ for home')).toEqual([])
    })
  })

  describe('relative paths', () => {
    it('detects ./... paths', () => {
      expect(paths('run ./scripts/build.sh')).toEqual([
        './scripts/build.sh',
      ])
    })

    it('ignores bare ./', () => {
      expect(paths('in ./ directory')).toEqual([])
    })
  })

  describe('URL exclusion', () => {
    it('does not match http:// URLs', () => {
      expect(paths('visit http://example.com/home/page')).toEqual([])
    })

    it('does not match https:// URLs', () => {
      expect(paths('see https://site.com/Users/info')).toEqual([])
    })

    it('does not match ftp:// URLs', () => {
      expect(paths('ftp://server.com/var/files')).toEqual([])
    })
  })

  describe('trailing punctuation stripping', () => {
    it('strips trailing period', () => {
      expect(paths('saved to /tmp/out.json.')).toEqual(['/tmp/out.json'])
    })

    it('strips trailing comma', () => {
      expect(paths('files /tmp/a.txt, /tmp/b.txt are ready')).toEqual([
        '/tmp/a.txt',
        '/tmp/b.txt',
      ])
    })

    it('strips trailing semicolon', () => {
      expect(paths('see /var/log/app.log;')).toEqual(['/var/log/app.log'])
    })

    it('strips trailing exclamation', () => {
      expect(paths('created ~/report.pdf!')).toEqual(['~/report.pdf'])
    })

    it('strips trailing parenthesis', () => {
      expect(paths('(see /tmp/notes.txt)')).toEqual(['/tmp/notes.txt'])
    })
  })

  describe('position tracking', () => {
    it('returns correct start and end indices', () => {
      const text = 'saved to /home/user/data.csv today'
      const results = detectFilePaths(text)
      expect(results).toHaveLength(1)
      expect(results[0].start).toBe(9)
      expect(results[0].end).toBe(28)
      expect(text.slice(results[0].start, results[0].end)).toBe(
        '/home/user/data.csv'
      )
    })
  })

  describe('displayName and extension', () => {
    it('extracts basename as displayName', () => {
      const results = detectFilePaths('open /Users/gary/report.pdf')
      expect(results[0].displayName).toBe('report.pdf')
      expect(results[0].extension).toBe('.pdf')
    })

    it('handles files with no extension', () => {
      const results = detectFilePaths('check /usr/local/bin/node')
      expect(results[0].displayName).toBe('node')
      expect(results[0].extension).toBe('')
    })

    it('handles dotfiles', () => {
      const results = detectFilePaths('edit ~/projects/.gitignore')
      expect(results[0].displayName).toBe('.gitignore')
      expect(results[0].extension).toBe('.gitignore')
    })

    it('handles multiple dots', () => {
      const results = detectFilePaths('/tmp/archive.tar.gz')
      expect(results[0].displayName).toBe('archive.tar.gz')
      expect(results[0].extension).toBe('.gz')
    })
  })

  describe('multiple paths in text', () => {
    it('finds all paths in a multi-line string', () => {
      const text = `Files created:
- /home/user/output.csv
- ~/Documents/notes.md
- ./local/config.json`
      const result = paths(text)
      expect(result).toEqual([
        '/home/user/output.csv',
        '~/Documents/notes.md',
        './local/config.json',
      ])
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(detectFilePaths('')).toEqual([])
    })

    it('returns empty for text with no paths', () => {
      expect(detectFilePaths('hello world, nothing here')).toEqual([])
    })

    it('handles paths with spaces via whitespace boundary', () => {
      // path ends at whitespace
      expect(paths('open /tmp/my file.txt')).toEqual(['/tmp/my'])
    })

    it('handles paths with special chars like hyphens and underscores', () => {
      expect(paths('/home/user/my-project_v2/src/index.ts')).toEqual([
        '/home/user/my-project_v2/src/index.ts',
      ])
    })

    it('handles path at end of string', () => {
      expect(paths('see /var/log/app.log')).toEqual(['/var/log/app.log'])
    })
  })
})
