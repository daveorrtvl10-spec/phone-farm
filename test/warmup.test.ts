import assert from 'node:assert/strict';
import { test } from 'node:test';
import { warmupRemainingMs, describeRemaining } from '../src/tiktok/warmup.js';

const started = '2026-09-02T10:00:00Z';
const data = { warmup: { '@Lucy': { startedAt: started } } };

test('warm-up blocks posting for 48h from startedAt, handle case-insensitive', () => {
    const t0 = Date.parse(started);
    assert.equal(warmupRemainingMs(data, '@lucy', t0 + 3_600_000), 47 * 3_600_000);
    assert.equal(warmupRemainingMs(data, 'lucy', t0 + 48 * 3_600_000), 0);
    assert.equal(warmupRemainingMs(data, '@other', t0), 0);
    assert.equal(warmupRemainingMs(undefined, '@lucy', t0), 0);
});

test('custom hours and description', () => {
    const t0 = Date.parse(started);
    assert.equal(warmupRemainingMs({ warmup: { '@lucy': { startedAt: started, hours: 24 } } }, '@lucy', t0), 24 * 3_600_000);
    assert.equal(describeRemaining(90 * 60_000), '1h 30m');
});
