import assert from 'node:assert/strict';

import { safeHttpsUrl } from './safe-url.js';

assert.equal(safeHttpsUrl('https://example.com/result'), 'https://example.com/result');
assert.equal(safeHttpsUrl(' https://example.com/result?q=1#source '), 'https://example.com/result?q=1#source');
assert.equal(safeHttpsUrl('http://example.com/result'), null);
assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
assert.equal(safeHttpsUrl('/relative/path'), null);
assert.equal(safeHttpsUrl(null), null);
