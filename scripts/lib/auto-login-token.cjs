'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const AUTO_LOGIN_TOKEN_FILE = 'auto-login-token.json';
const DEFAULT_AUTO_LOGIN_TOKEN_TTL_MS = 60_000;

function resolveAutoLoginDataDir(env = process.env, cwd = process.cwd()) {
  return path.resolve(env.MISSION_CONTROL_DATA_DIR || path.join(cwd, '.data'));
}

function normalizeTokenPath(value) {
  const raw = String(value || '/');
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  try {
    const resolved = new URL(raw, 'http://127.0.0.1');
    if (resolved.origin !== 'http://127.0.0.1') return '/';
    return raw;
  } catch {
    return '/';
  }
}

function isLoopbackBaseUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true;
    const octets = hostname.split('.');
    return octets.length === 4
      && octets[0] === '127'
      && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
  } catch {
    return false;
  }
}

function ensureSafeFileMode(filePath) {
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
}

function writeAutoLoginToken(options = {}) {
  const dataDir = path.resolve(options.dataDir || resolveAutoLoginDataDir());
  const ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs > 0
    ? Math.min(options.ttlMs, 5 * 60_000)
    : DEFAULT_AUTO_LOGIN_TOKEN_TTL_MS;
  const now = options.now ?? Date.now();
  const token = options.token || crypto.randomBytes(32).toString('base64url');
  const filePath = path.join(dataDir, AUTO_LOGIN_TOKEN_FILE);
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const record = JSON.stringify({ token, expiresAt: now + ttlMs }) + '\n';

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(tempPath, record, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    ensureSafeFileMode(tempPath);
    fs.renameSync(tempPath, filePath);
    ensureSafeFileMode(filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  return { token, expiresAt: now + ttlMs, filePath };
}

function autoLoginUrl(baseUrl, token, nextPath = '/') {
  if (!isLoopbackBaseUrl(baseUrl)) {
    throw new Error('Auto-login can only target a loopback Mission Control URL');
  }
  const url = new URL('/api/auth/auto-login', baseUrl);
  url.searchParams.set('t', token);
  url.searchParams.set('next', normalizeTokenPath(nextPath));
  return url.toString();
}

function openInBrowser(url, options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  let command;
  let args;

  if (platform === 'win32') {
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => {
      child.unref();
      resolve(undefined);
    });
    child.once('error', reject);
  });
}

module.exports = {
  AUTO_LOGIN_TOKEN_FILE,
  DEFAULT_AUTO_LOGIN_TOKEN_TTL_MS,
  autoLoginUrl,
  isLoopbackBaseUrl,
  normalizeTokenPath,
  openInBrowser,
  resolveAutoLoginDataDir,
  writeAutoLoginToken,
};
