const MAX_QUERY_LENGTH = 900;
const CLAIM_ID_MAX = 160;
const LEGACY_LIMIT = 10;
const CLAIM_LIMIT = 40;

const CLAIM_PARAM = 'claim';
const LEGACY_PARAM_LIMITS = new Map([
  ['market', 160],
  ['title', 160],
  ['outcome', 80],
  ['amount', 40],
  ['amountLabel', 40],
]);
const ALLOWED_PARAMS = new Set([CLAIM_PARAM, ...LEGACY_PARAM_LIMITS.keys()]);

function compactText(value, fallback = '') {
  return String(value || fallback || '').replace(/\s+/g, ' ').trim();
}

function reject(message) {
  return { ok: false, status: 400, message };
}

function singleParam(params, key) {
  const values = params.getAll(key);
  if (values.length > 1) return { ok: false, message: `duplicate ${key} query parameter` };
  return { ok: true, value: compactText(values[0] || '') };
}

export function parseShareClaimImageRequest(url) {
  const input = typeof url === 'string' ? new URL(url, 'https://hachozeh.com') : url;
  const params = input?.searchParams;
  if (!params) return reject('invalid share image request');
  if (input.search.length > MAX_QUERY_LENGTH) return reject('share image query is too long');

  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return reject(`unsupported share image query parameter: ${key}`);
  }

  const claimParam = singleParam(params, CLAIM_PARAM);
  if (!claimParam.ok) return reject(claimParam.message);
  const claimId = claimParam.value;
  if (claimId && !/^[A-Za-z0-9:_-]+$/.test(claimId)) return reject('invalid claim id');
  if (claimId.length > CLAIM_ID_MAX) return reject('claim id is too long');

  const legacy = {};
  let hasLegacyParams = false;
  for (const [key, maxLength] of LEGACY_PARAM_LIMITS) {
    const parsed = singleParam(params, key);
    if (!parsed.ok) return reject(parsed.message);
    const value = parsed.value;
    if (value.length > maxLength) return reject(`${key} query parameter is too long`);
    if (value) hasLegacyParams = true;
    legacy[key] = value;
  }

  return {
    ok: true,
    claimId,
    legacy,
    mode: claimId && !hasLegacyParams ? 'claim' : 'legacy',
    rateLimit: {
      bucket: claimId && !hasLegacyParams ? 'share-claim-image' : 'share-claim-image-legacy',
      maxPerWindow: claimId && !hasLegacyParams ? CLAIM_LIMIT : LEGACY_LIMIT,
    },
  };
}

export function shareClaimImageBadRequestResponse(message) {
  return new Response(message || 'invalid share image request', {
    status: 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
