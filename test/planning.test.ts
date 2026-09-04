import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountPhase, type Account } from '../src/planning/roster.js';
import { GOLDEN_WINDOWS, mulberry32, planDay, PHASE_SHAPES } from '../src/planning/plan.js';

const base: Account = {
    handle: '@a', device: 'DEV-A', deviceName: 'A', niche: 'x', owner: 'claude',
    createdAt: '2026-09-02T00:00:00Z', warmupHours: 48, lurkerHours: 24,
    seedTerms: ['one', 'two'], posts: [],
};
const at = (iso: string) => Date.parse(iso);

test('phase is derived from age, then from the health post', () => {
    assert.equal(accountPhase(base, at('2026-09-02T06:00:00Z')), 'lurker');
    assert.equal(accountPhase(base, at('2026-09-03T06:00:00Z')), 'training');
    assert.equal(accountPhase(base, at('2026-09-04T06:00:00Z')), 'health-test');

    const posted = (views: number | null): Account => ({
        ...base, posts: [{ postedAt: '2026-09-04T01:00:00Z', kind: 'health-test', views24h: views, views48h: null }],
    });
    const later = at('2026-09-05T06:00:00Z');
    assert.equal(accountPhase(posted(null), later), 'health-test', 'unread post stays in testing');
    assert.equal(accountPhase(posted(120), later), 'blocked', 'under 300 is a compromised account');
    assert.equal(accountPhase(posted(500), later), 'health-test', '300-700 is inconclusive');
    assert.equal(accountPhase(posted(1500), later), 'posting', '700+ clears the account');
    assert.equal(accountPhase({ ...base, parked: true }, later), 'blocked');
});

test('a day is planned inside the golden windows only', () => {
    const sessions = planDay([base], { date: '2026-09-10', tzOffsetHours: -5, now: at('2026-09-09T12:00:00Z') });
    assert.equal(sessions.length, PHASE_SHAPES['health-test'].sessions);
    for (const s of sessions) {
        const localHour = (new Date(s.runAt).getUTCHours() + 24 - 5) % 24;
        const end = localHour + s.durationMinutes / 60;
        assert.ok(
            GOLDEN_WINDOWS.some(([from, to]) => localHour >= from && end <= to),
            `${s.runAt} (local ${localHour}) is outside the golden windows`,
        );
    }
});

test('two accounts on one phone never overlap', () => {
    const a = { ...base, handle: '@a' };
    const b = { ...base, handle: '@b' };
    const sessions = planDay([a, b], { date: '2026-09-10', tzOffsetHours: -5, now: at('2026-09-09T12:00:00Z') });
    const spans = sessions
        .map((s) => [Date.parse(s.runAt), Date.parse(s.runAt) + s.durationMinutes * 60_000] as const)
        .sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i += 1) {
        assert.ok(spans[i]![0] >= spans[i - 1]![1], `sessions overlap on one device: ${sessions[i]?.runAt}`);
    }
});

test('planning is deterministic for a seed and varies by day', () => {
    const opts = { tzOffsetHours: -5, now: at('2026-09-09T12:00:00Z') };
    const one = planDay([base], { ...opts, date: '2026-09-10', random: mulberry32(7) });
    const two = planDay([base], { ...opts, date: '2026-09-10', random: mulberry32(7) });
    assert.deepEqual(one, two);
    const other = planDay([base], { ...opts, date: '2026-09-11' });
    assert.notDeepEqual(one.map((s) => s.runAt.slice(11)), other.map((s) => s.runAt.slice(11)));
});

test('lurkers do not search or follow; training does search', () => {
    const now = at('2026-09-02T06:00:00Z');
    const lurk = planDay([base], { date: '2026-09-02', tzOffsetHours: -5, now });
    assert.ok(lurk.every((s) => s.searchCount === 0 && s.followBudget === 0 && s.seedTerms.length === 0));
    assert.ok(lurk.every((s) => !s.saveEnabled), 'saves stay off while lurking');

    const train = planDay([base], { date: '2026-09-03', tzOffsetHours: -5, now: at('2026-09-03T06:00:00Z') });
    assert.ok(train.every((s) => s.searchCount >= 1 && s.seedTerms.length > 0));
    assert.ok(train.every((s) => s.followBudget === 0), 'follows stay off until the "+" is measured');
});

test('a blocked account is never booked, and past slots are skipped', () => {
    const parked = { ...base, parked: true };
    assert.equal(planDay([parked], { date: '2026-09-10', tzOffsetHours: -5, now: at('2026-09-09T12:00:00Z') }).length, 0);

    // Planning the same day at 18:00 local leaves only the evening window.
    const late = planDay([base], { date: '2026-09-10', tzOffsetHours: -5, now: at('2026-09-10T23:00:00Z') });
    assert.ok(late.every((s) => Date.parse(s.runAt) > at('2026-09-10T23:00:00Z')));
});
