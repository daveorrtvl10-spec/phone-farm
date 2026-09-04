import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveHealthTile } from '../src/planning/views.js';
import type { PostRecord } from '../src/planning/roster.js';

const post = (kind: PostRecord['kind']): PostRecord => ({
    postedAt: '2026-09-03T23:51:00Z', kind, views24h: null, views48h: null,
});

test('a single post is unambiguously the newest tile', () => {
    assert.deepEqual(resolveHealthTile([post('health-test')]), {
        ok: true, index: 0, reason: 'only one post, so it is the newest tile',
    });
});

test('it refuses to guess once the profile has more than one post', () => {
    // TikTok reorders the grid when a post is pinned, so chronological position
    // stops matching grid position — and this number decides reset vs proceed.
    const result = resolveHealthTile([post('health-test'), post('content')]);
    assert.equal(result.ok, false);
    assert.match(result.reason, /pass --tile/);
});

test('an explicit tile is always honoured, and validated', () => {
    assert.deepEqual(resolveHealthTile([post('health-test'), post('content')], 1), {
        ok: true, index: 1, reason: 'tile given explicitly',
    });
    assert.equal(resolveHealthTile([post('health-test')], -1).ok, false);
    assert.equal(resolveHealthTile([post('health-test')], 1.5).ok, false);
});

test('no health post means nothing to read', () => {
    assert.match(resolveHealthTile([]).reason, /no health-test post/);
    assert.match(resolveHealthTile([post('content')]).reason, /no health-test post/);
});
