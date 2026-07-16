'use strict';

const MAX_BASE_URL_LENGTH = 2048;

function normalizeMissionControlBaseUrl(value) {
  const input = String(value || '').trim();
  if (!input || input.length > MAX_BASE_URL_LENGTH || /[\u0000-\u001F\u007F]/.test(input)) {
    throw new Error('Mission Control URL is invalid');
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Mission Control URL must be an absolute HTTP(S) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Mission Control URL must use HTTP or HTTPS');
  }
  if (!parsed.hostname) {
    throw new Error('Mission Control URL must include a host');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Mission Control URL must not contain embedded credentials');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Mission Control URL must not contain a query string or fragment');
  }

  return parsed.toString().replace(/\/+$/, '');
}

module.exports = {
  MAX_BASE_URL_LENGTH,
  normalizeMissionControlBaseUrl,
};
