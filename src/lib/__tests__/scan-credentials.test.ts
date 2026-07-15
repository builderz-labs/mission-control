/**
 * Tests for src/lib/secret-scanner.ts — scanForSecrets and redactSecrets
 */
import { describe, it, expect } from 'vitest'
import { scanForSecrets, redactSecrets } from '@/lib/secret-scanner'

describe('scanForSecrets', () => {
  it('detects AWS access key IDs', () => {
    const hits = scanForSecrets('My key is AKIAIOSFODNN7EXAMPLE')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.some(h => h.type === 'aws_access_key')).toBe(true)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects AWS secret access keys', () => {
    const hits = scanForSecrets('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYaa')
    expect(hits.some(h => h.type === 'aws_secret_key')).toBe(true)
  })

  it('detects GitHub personal access tokens (ghp_)', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const hits = scanForSecrets(`token: ${token}`)
    expect(hits.some(h => h.type === 'github_token')).toBe(true)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects GitHub OAuth tokens (gho_)', () => {
    const token = 'gho_' + 'B'.repeat(36)
    const hits = scanForSecrets(token)
    expect(hits.some(h => h.type === 'github_oauth_token')).toBe(true)
  })

  it('detects GitHub fine-grained PATs (github_pat_)', () => {
    const token = 'github_pat_' + 'C'.repeat(22)
    const hits = scanForSecrets(token)
    expect(hits.some(h => h.type === 'github_pat')).toBe(true)
  })

  it('detects Stripe live keys', () => {
    const key = ['sk', 'live', ''].join('_') + 'D'.repeat(24)
    const hits = scanForSecrets(key)
    expect(hits.some(h => h.type === ['stripe', 'secret', 'key'].join('_'))).toBe(true)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects Stripe test keys with warning severity', () => {
    const key = ['sk', 'test', ''].join('_') + 'E'.repeat(24)
    const hits = scanForSecrets(key)
    expect(hits.some(h => h.type === 'stripe_test_key')).toBe(true)
    expect(hits.find(h => h.type === 'stripe_test_key')!.severity).toBe('warning')
  })

  it('detects JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const hits = scanForSecrets(jwt)
    expect(hits.some(h => h.type === 'jwt')).toBe(true)
  })

  it('detects private keys (PEM)', () => {
    const hits = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEow...')
    expect(hits.some(h => h.type === 'private_key')).toBe(true)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects database connection strings', () => {
    const hits = scanForSecrets('postgres://user:pass@host:5432/mydb?sslmode=require')
    expect(hits.some(h => h.type === 'db_connection_string')).toBe(true)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects mongodb+srv connection strings', () => {
    const hits = scanForSecrets('mongodb+srv://admin:pw123@cluster0.mongodb.net/db')
    expect(hits.some(h => h.type === 'db_connection_string')).toBe(true)
  })

  it('returns no false positives on normal text', () => {
    const hits = scanForSecrets('Hello, this is a normal message about deploying our application to production.')
    expect(hits).toHaveLength(0)
  })

  it('returns no false positives on code snippets', () => {
    const hits = scanForSecrets('const x = 42; function hello() { return "world"; }')
    expect(hits).toHaveLength(0)
  })

  it('returns redactedPreview for each match', () => {
    const hits = scanForSecrets('AKIAIOSFODNN7EXAMPLE')
    expect(hits[0].redactedPreview).toContain('***')
    expect(hits[0].redactedPreview).not.toBe('AKIAIOSFODNN7EXAMPLE')
  })

  it('includes position in match', () => {
    const text = 'prefix AKIAIOSFODNN7EXAMPLE suffix'
    const hits = scanForSecrets(text)
    expect(hits[0].position).toBe(7)
  })
})

describe('redactSecrets', () => {
  it('masks AWS keys in text', () => {
    const text = 'Key is AKIAIOSFODNN7EXAMPLE here'
    const result = redactSecrets(text)
    expect(result).toContain('***REDACTED***')
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('masks GitHub tokens', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const result = redactSecrets(`Use ${token} for auth`)
    expect(result).toContain('***REDACTED***')
    expect(result).not.toContain(token)
  })

  it('preserves text without credentials', () => {
    const text = 'Just a normal message with nothing sensitive.'
    expect(redactSecrets(text)).toBe(text)
  })

  it('masks multiple credentials in one string', () => {
    const token = 'ghp_' + 'X'.repeat(36)
    const text = `AWS: AKIAIOSFODNN7EXAMPLE GitHub: ${token}`
    const result = redactSecrets(text)
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(result).not.toContain(token)
  })
})

describe('scanForSecrets - new patterns', () => {
  it('detects Slack webhook URLs', () => {
    const url = 'https://hooks.slack.com/services/T' + '0'.repeat(8) + '/B' + '0'.repeat(8) + '/' + 'X'.repeat(24)
    const hits = scanForSecrets(url)
    expect(hits.some(h => h.type === 'slack_webhook')).toBe(true)
    expect(hits.find(h => h.type === 'slack_webhook')!.severity).toBe('critical')
  })

  it('detects Discord webhook URLs', () => {
    const url = 'https://discord.com/api/webhooks/12345678901234567/' + 'a'.repeat(68)
    const hits = scanForSecrets(url)
    expect(hits.some(h => h.type === 'discord_webhook')).toBe(true)
  })

  it('detects Anthropic API keys', () => {
    const key = 'sk-ant-api' + 'A'.repeat(30)
    const hits = scanForSecrets(key)
    expect(hits.some(h => h.type === 'anthropic_api_key')).toBe(true)
    expect(hits[0].severity).toBe('critical')
  })

  it('detects SendGrid API keys', () => {
    const key = 'SG.' + 'A'.repeat(22) + '.' + 'B'.repeat(43)
    const hits = scanForSecrets(key)
    expect(hits.some(h => h.type === 'sendgrid_api_key')).toBe(true)
  })

  it('detects Mailgun API keys', () => {
    const key = 'key-' + 'a'.repeat(32)
    const hits = scanForSecrets(key)
    expect(hits.some(h => h.type === 'mailgun_api_key')).toBe(true)
  })

  it('detects Azure storage connection strings', () => {
    const conn = 'DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=' + 'A'.repeat(30)
    const hits = scanForSecrets(conn)
    expect(hits.some(h => h.type === 'azure_storage')).toBe(true)
  })

  it('detects Twilio API keys', () => {
    const key = 'SK' + 'ab12cd34ef56ab12cd34ef56ab12cd34'
    const hits = scanForSecrets(key)
    expect(hits.some(h => h.type === 'twilio_api_key')).toBe(true)
  })
})
