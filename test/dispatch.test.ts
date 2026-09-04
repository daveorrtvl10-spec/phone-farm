import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDone, remaining, toRequestBodies } from '../src/planning/dispatch.js';
import type { PlannedSession } from '../src/planning/plan.js';

const session = (over: Partial<PlannedSession> = {}): PlannedSession => ({
    handle: '@a', device: 'DEV', runAt: '2026-09-04T11:41:00Z', durationMinutes: 12,
    personality: 'casual', likeEnabled: true, saveEnabled: false, searchCount: 0,
    followBudget: 0, seedTerms: [], phase: 'training', ...over,
});

test('a lurker session carries only the basics', () => {
    const [request] = toRequestBodies([session()]);
    const form = new URLSearchParams(request!.body);
    assert.equal(request!.device, 'DEV');
    assert.equal(form.get('account'), '@a');
    assert.equal(form.get('personality'), 'casual');
    assert.equal(form.get('durationMinutes'), '12');
    assert.equal(form.get('likeEnabled'), 'on');
    // Absent rather than empty, so the API never sees a stray zero.
    assert.equal(form.get('saveEnabled'), null);
    assert.equal(form.get('searchCount'), null);
    assert.equal(form.get('seedTerms'), null);
    assert.equal(form.get('followBudget'), null);
});

test('a training session carries saves, searches and seed terms', () => {
    const [request] = toRequestBodies([session({ saveEnabled: true, searchCount: 2, seedTerms: ['a b', 'c'], followBudget: 1 })]);
    const form = new URLSearchParams(request!.body);
    assert.equal(form.get('saveEnabled'), 'on');
    assert.equal(form.get('searchCount'), '2');
    assert.equal(form.get('seedTerms'), 'a b,c', 'terms with spaces survive encoding');
    assert.equal(form.get('followBudget'), '1');
});

test('indexes are stable so a partial send can resume', () => {
    const requests = toRequestBodies([session({ handle: '@a' }), session({ handle: '@b' }), session({ handle: '@c' })]);
    assert.deepEqual(requests.map((r) => r.index), [0, 1, 2]);
    assert.deepEqual(remaining(requests, [0, 2]).map((r) => r.index), [1]);
    assert.equal(remaining(requests, []).length, 3);
    assert.equal(remaining(requests, [0, 1, 2]).length, 0);
});

test('the done-file survives blank lines and junk', () => {
    assert.deepEqual(parseDone('0\n\n2\n  3  \nnot-a-number\n'), [0, 2, 3]);
    assert.deepEqual(parseDone(''), []);
});
