import assert from 'node:assert/strict';

import { parseShareClaimImageRequest, shareClaimImageBadRequestResponse } from './share-claim-image-request.js';

{
  const parsed = parseShareClaimImageRequest('https://hachozeh.com/share/claims/win.png?claim=realization_abc-123');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'claim');
  assert.equal(parsed.claimId, 'realization_abc-123');
  assert.equal(parsed.rateLimit.bucket, 'share-claim-image');
  assert.equal(parsed.rateLimit.maxPerWindow, 40);
}

{
  const parsed = parseShareClaimImageRequest('https://hachozeh.com/share/claims/win.png?claim=realization_abc&title=%D7%A9%D7%95%D7%A7&amountLabel=V%E2%82%AA%2012');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'legacy');
  assert.equal(parsed.legacy.title, 'שוק');
  assert.equal(parsed.rateLimit.bucket, 'share-claim-image-legacy');
  assert.equal(parsed.rateLimit.maxPerWindow, 10);
}

{
  const parsed = parseShareClaimImageRequest('https://hachozeh.com/share/claims/win.png?title=x&evil=1');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
}

{
  const parsed = parseShareClaimImageRequest('https://hachozeh.com/share/claims/win.png?claim=realization_abc&claim=realization_def');
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /duplicate claim/);
}

{
  const tooLongTitle = 'x'.repeat(161);
  const parsed = parseShareClaimImageRequest(`https://hachozeh.com/share/claims/win.png?title=${tooLongTitle}`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /title/);
}

{
  const parsed = parseShareClaimImageRequest('https://hachozeh.com/share/claims/win.png?claim=../../secret');
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /invalid claim id/);
}

{
  const res = shareClaimImageBadRequestResponse('bad card');
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('cache-control'), 'no-store');
}

console.log('share-claim-image-request: all assertions passed');
