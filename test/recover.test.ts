import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sessionsToRecover, windowHasRoom, type ExecutionSummary } from '../src/planning/recover.js';

const TZ = -5;
const at = (iso: string) => Date.parse(iso);
// 11:00 phone local (UTC-5) sits inside the 10–12 golden window.
const MIDDAY = at('2026-09-04T16:00:00Z');

const missed = (over: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
    id: over.id ?? 'e1',
    deviceUdid: 'DEV-A',
    taskType: 'doomscroll',
    status: 'failed',
    error: 'Execution window expired: device is offline',
    scheduledFor: '2026-09-04T11:41:00Z', // 06:41 local, same day
    payload: { account: '@a', durationMinutes: 12, personality: 'casual' },
    ...over,
});

test('a session missed earlier today re-runs while a window is open', () => {
    const out = sessionsToRecover([missed()], { now: MIDDAY, tzOffsetHours: TZ });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.payload.account, '@a');
});

test('nothing re-runs outside the golden windows', () => {
    const late = at('2026-09-05T03:10:00Z'); // 22:10 local
    assert.equal(sessionsToRecover([missed()], { now: late, tzOffsetHours: TZ }).length, 0);
    assert.equal(windowHasRoom(late, TZ, 12), false);
    assert.equal(windowHasRoom(MIDDAY, TZ, 12), true);
    // A session too long to finish before the window shuts is not started.
    assert.equal(windowHasRoom(at('2026-09-04T16:55:00Z'), TZ, 12), false, '11:55 local leaves no room for 12 min');
});

test('an account that just ran is left alone', () => {
    const justRan: ExecutionSummary = { ...missed({ id: 'ok' }), status: 'succeeded', error: null, startedAt: '2026-09-04T15:30:00Z' };
    const out = sessionsToRecover([missed(), justRan], { now: MIDDAY, tzOffsetHours: TZ });
    assert.equal(out.length, 0, 'ran 30 min ago, inside the 75 min gap');
});

test('a long outage cannot cause a burst', () => {
    const many = [missed({ id: 'a' }), missed({ id: 'b' }), missed({ id: 'c' }), missed({ id: 'd' })];
    const out = sessionsToRecover(many, { now: MIDDAY, tzOffsetHours: TZ, minGapMinutes: 0 });
    assert.equal(out.length, 2, 'capped at two recoveries per account per day');
});

test('only today, only offline failures', () => {
    const yesterday = missed({ id: 'old', scheduledFor: '2026-09-03T11:41:00Z' });
    const otherError = missed({ id: 'bug', error: 'Plugin process exited with 1' });
    const succeeded = missed({ id: 'fine', status: 'succeeded', error: null });
    const out = sessionsToRecover([yesterday, otherError, succeeded], { now: MIDDAY, tzOffsetHours: TZ });
    assert.equal(out.length, 0);
});

test('two accounts on one phone each get their own recovery', () => {
    const a = missed({ id: 'a', payload: { account: '@a', durationMinutes: 12 } });
    const b = missed({ id: 'b', payload: { account: '@b', durationMinutes: 12 } });
    const out = sessionsToRecover([a, b], { now: MIDDAY, tzOffsetHours: TZ });
    assert.deepEqual(out.map((e) => e.payload.account), ['@a', '@b']);
});

test('a disconnected phone is never recovered onto', () => {
    const one = missed({ id: 'a', deviceUdid: 'DEV-A' });
    const two = missed({ id: 'b', deviceUdid: 'DEV-B', payload: { account: '@b', durationMinutes: 12 } });
    const out = sessionsToRecover([one, two], {
        now: MIDDAY, tzOffsetHours: TZ, readyDevices: new Set(['DEV-B']),
    });
    assert.deepEqual(out.map((e) => e.deviceUdid), ['DEV-B'], 'only the connected phone is recovered');
    // Skipping a dead phone must not consume its budget either.
    assert.equal(sessionsToRecover([one], { now: MIDDAY, tzOffsetHours: TZ, readyDevices: new Set() }).length, 0);
});
