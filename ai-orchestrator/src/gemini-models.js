// src/gemini-models.js
// Helper utilities to select a Gemini model that supports generateContent.

const MODEL_LIST_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL_PREFERENCES = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.0-pro',
];

let cachedModelId = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeModelName(name) {
  return (name || '').replace(/^models\//, '').trim();
}

function supportsGenerateContent(model) {
  const methods = model?.supportedGenerationMethods || [];
  return methods.includes('generateContent');
}

function pickPreferredModel(models, preferred) {
  const preferredNormalized = normalizeModelName(preferred);
  if (preferredNormalized) {
    const direct = models.find((model) => {
      const normalizedName = normalizeModelName(model.name);
      return normalizedName === preferredNormalized || model.baseModelId === preferredNormalized;
    });
    if (direct) return normalizeModelName(direct.name || direct.baseModelId);
  }

  for (const prefix of DEFAULT_MODEL_PREFERENCES) {
    const match = models.find((model) => normalizeModelName(model.name).startsWith(prefix));
    if (match) return normalizeModelName(match.name || match.baseModelId);
  }

  const fallback = models[0];
  return normalizeModelName(fallback?.name || fallback?.baseModelId);
}

async function listGeminiModels(apiKey) {
  const url = new URL(MODEL_LIST_URL);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Gemini listModels failed: ${response.status} ${details || response.statusText}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.models) ? payload.models : [];
}

async function resolveGeminiModel({ apiKey, preferredModel }) {
  if (!apiKey) {
    throw new Error('Gemini API key not configured.');
  }

  const now = Date.now();
  if (cachedModelId && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedModelId;
  }

  try {
    const models = await listGeminiModels(apiKey);
    const eligible = models.filter(supportsGenerateContent);
    if (!eligible.length) {
      const fallback = normalizeModelName(preferredModel);
      if (fallback) return fallback;
      throw new Error('No Gemini models support generateContent.');
    }

    const selected = pickPreferredModel(eligible, preferredModel);
    if (!selected) {
      throw new Error('Failed to select a Gemini model.');
    }

    cachedModelId = selected;
    cachedAtMs = now;
    return selected;
  } catch (err) {
    const fallback = normalizeModelName(preferredModel);
    if (fallback) return fallback;
    throw err;
  }
}

module.exports = { resolveGeminiModel, listGeminiModels };
