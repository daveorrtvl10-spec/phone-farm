import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BlockerProbe } from '../src/tiktok/blocker-probe.js';
import { clearBlockers, clearOneBlocker } from '../src/tiktok/blockers.js';

/** A scripted device: each screen is consumed as it is cleared. */
function fakeProbe(screens: Array<{ alert?: { text: string; buttons: string[] }; buttons?: string[] }>): {
    probe: BlockerProbe;
    pressed: string[];
} {
    const pressed: string[] = [];
    let index = 0;
    const current = () => screens[index] ?? {};
    const probe: BlockerProbe = {
        async alertText() {
            return current().alert?.text ?? null;
        },
        async alertButtons() {
            return current().alert?.buttons ?? [];
        },
        async pressAlertButton(name) {
            pressed.push(name);
            index += 1;
            return true;
        },
        async buttons() {
            return (current().buttons ?? []).map((label) => ({
                label,
                press: async () => {
                    pressed.push(label);
                    index += 1;
                    return true;
                },
            }));
        },
    };
    return { probe, pressed };
}

test('declines a tracking prompt without granting anything', async () => {
    const { probe, pressed } = fakeProbe([
        { alert: { text: 'Allow TikTok to track your activity?', buttons: ['Ask App Not to Track', 'Allow'] } },
    ]);
    const outcome = await clearOneBlocker(probe);
    assert.equal(outcome.kind, 'alert');
    assert.deepEqual(pressed, ['Ask App Not to Track']);
});

test('clears a stack of blockers in one pass', async () => {
    const { probe, pressed } = fakeProbe([
        { alert: { text: 'Finish Setting Up Your iPhone', buttons: ['Continue', 'Not Now'] } },
        { buttons: ['Home', 'ic party close'] },
        { buttons: ['Home', 'Friends', 'Create'] },
    ]);
    const history = await clearBlockers(probe);
    assert.deepEqual(pressed, ['Not Now', 'ic party close']);
    assert.deepEqual(history.map((h) => h.kind), ['alert', 'overlay']);
});

test('stops at a destructive dialog and presses nothing', async () => {
    const { probe, pressed } = fakeProbe([
        { alert: { text: 'Delete this account permanently?', buttons: ['Delete', 'Cancel'] } },
    ]);
    const history = await clearBlockers(probe);
    assert.deepEqual(pressed, []);
    assert.equal(history[0]?.kind, 'unhandled');
});

test('reports a clean screen without pressing anything', async () => {
    const { probe, pressed } = fakeProbe([{ buttons: ['Home', 'Friends', 'Create', 'Inbox', 'Profile'] }]);
    const history = await clearBlockers(probe);
    assert.deepEqual(history, []);
    assert.deepEqual(pressed, []);
});

test('grants photo access only under the grant policy', async () => {
    const screen = [{ alert: { text: 'TikTok would like to access your photos', buttons: ['Allow Full Access', "Don't Allow"] } }];
    const deferred = fakeProbe(screen);
    await clearOneBlocker(deferred.probe, 'defer');
    assert.deepEqual(deferred.pressed, ["Don't Allow"]);

    const granted = fakeProbe(screen);
    await clearOneBlocker(granted.probe, 'grant');
    assert.deepEqual(granted.pressed, ['Allow Full Access']);
});

test('gives up rather than looping forever on a blocker it cannot clear', async () => {
    const probe: BlockerProbe = {
        async alertText() { return null; },
        async alertButtons() { return []; },
        async pressAlertButton() { return false; },
        async buttons() { return [{ label: 'Not Now', press: async () => false }]; },
    };
    const history = await clearBlockers(probe, 'defer', 6);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.kind, 'unhandled');
});
