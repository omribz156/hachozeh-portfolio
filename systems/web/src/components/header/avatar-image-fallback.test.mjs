import assert from 'node:assert/strict';

import { replaceBrokenAvatar } from './avatar-image-fallback.js';

const image = { src: '/api/uploads/avatars/avatar-missing.webp', dataset: {} };
replaceBrokenAvatar({ currentTarget: image }, '/assets/brand/default-avatar-96.webp');
assert.equal(image.src, '/assets/brand/default-avatar-96.webp');
assert.equal(image.dataset.defaultAvatar, 'true');

const defaultImage = { src: '/assets/brand/default-avatar-96.webp', dataset: { defaultAvatar: 'true' } };
replaceBrokenAvatar({ currentTarget: defaultImage }, '/different-fallback.webp');
assert.equal(defaultImage.src, '/assets/brand/default-avatar-96.webp');

console.log('ok - broken avatars fall back once');
