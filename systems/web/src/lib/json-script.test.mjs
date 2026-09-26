import assert from 'node:assert/strict';

import { serializeJsonForHtmlScript } from './json-script.js';

const payload = {
  title: '</script><script>alert(1)</script>',
  comparison: '<tag attr="x">&',
  lineSeparator: '\u2028',
  paragraphSeparator: '\u2029'
};

const serialized = serializeJsonForHtmlScript(payload);

assert.equal(serialized.includes('</script>'), false);
assert.equal(serialized.includes('<script>'), false);
assert.equal(serialized.includes('<'), false);
assert.equal(serialized.includes('>'), false);
assert.equal(serialized.includes('&'), false);
assert.match(serialized, /\\u003C\/script\\u003E/);
assert.match(serialized, /\\u0026/);
assert.match(serialized, /\\u2028/);
assert.match(serialized, /\\u2029/);
assert.deepEqual(JSON.parse(serialized), payload);
