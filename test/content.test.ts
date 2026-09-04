import assert from 'node:assert/strict';
import { test } from 'node:test';

import { postingAllowed, validatePost, MAX_SLIDES } from '../src/planning/content.js';
import type { Account } from '../src/planning/roster.js';

const at = (iso: string) => Date.parse(iso);
const TZ = -5;
// 11:00 phone local sits inside the 10-12 golden window.
const MIDDAY = at('2026-09-10T16:00:00Z');

const account = (over: Partial<Account> = {}): Account => ({
    handle: '@a', device: 'DEV', deviceName: 'D', niche: 'n', owner: 'claude',
    createdAt: '2026-09-01T00:00:00Z', warmupHours: 48, lurkerHours: 24,
    seedTerms: [], posts: [{ postedAt: '2026-09-05T00:00:00Z', kind: 'health-test', views24h: 900, views48h: null }],
    ...over,
});

test('a well-formed post validates', () => {
    const v = validatePost(['01.jpg', '02.jpg'], { caption: 'hello', destination: 'publish' });
    assert.deepEqual(v, { ok: true, errors: [] });
});

test('validation catches the ways a folder goes wrong', () => {
    const many = Array.from({ length: MAX_SLIDES + 1 }, (_, i) => `${i}.jpg`);
    assert.match(validatePost(many, { caption: 'x', destination: 'draft' }).errors.join(), /at most 12/);
    assert.match(validatePost([], { caption: 'x', destination: 'draft' }).errors.join(), /no image slides/);
    assert.match(validatePost(['a.jpg', 'notes.txt'], { caption: 'x', destination: 'draft' }).errors.join(), /images only/);
    assert.match(validatePost(['a.jpg'], { caption: '  ', destination: 'draft' }).errors.join(), /caption is empty/);
    assert.match(validatePost(['a.jpg'], { caption: 'x'.repeat(2201), destination: 'draft' }).errors.join(), /2200/);
    assert.match(validatePost(['a.jpg'], { caption: 'x' } as never).errors.join(), /destination/);
});

test('an account still warming up cannot post', () => {
    const young = account({ createdAt: '2026-09-10T00:00:00Z' });
    const gate = postingAllowed({ account: young, now: MIDDAY, tzOffsetHours: TZ, postsToday: 0 });
    assert.equal(gate.ok, false);
    assert.match(gate.reason, /warming up/);
});

test('the health test gates ordinary content', () => {
    const untested = account({ posts: [] });
    assert.match(postingAllowed({ account: untested, now: MIDDAY, tzOffsetHours: TZ, postsToday: 0 }).reason, /health test not cleared/);
    // …but the health-test post itself is allowed through.
    assert.equal(postingAllowed({ account: untested, now: MIDDAY, tzOffsetHours: TZ, postsToday: 0, allowHealthTest: true }).ok, true);
});

test('a compromised account never posts again', () => {
    const dead = account({ posts: [{ postedAt: '2026-09-05T00:00:00Z', kind: 'health-test', views24h: 120, views48h: null }] });
    assert.match(postingAllowed({ account: dead, now: MIDDAY, tzOffsetHours: TZ, postsToday: 0, allowHealthTest: true }).reason, /blocked/);
});

test('daily cap and golden windows are enforced', () => {
    assert.match(postingAllowed({ account: account(), now: MIDDAY, tzOffsetHours: TZ, postsToday: 2 }).reason, /cap 2/);
    const midnight = at('2026-09-10T05:00:00Z'); // 00:00 local
    assert.match(postingAllowed({ account: account(), now: midnight, tzOffsetHours: TZ, postsToday: 0 }).reason, /outside the golden/);
});

test('a cleared account inside a window may post', () => {
    assert.deepEqual(postingAllowed({ account: account(), now: MIDDAY, tzOffsetHours: TZ, postsToday: 1 }), { ok: true, reason: 'ok' });
});
