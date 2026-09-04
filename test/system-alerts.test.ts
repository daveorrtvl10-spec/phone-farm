import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chooseButton, isDestructive } from '../src/tiktok/system-alerts.js';

test('while scrolling, every permission is declined or deferred', () => {
    // All seen live on the reset phones, 2026-09-03/04.
    assert.equal(chooseButton(['Ask App Not to Track', 'Allow']), 'Ask App Not to Track');
    assert.equal(chooseButton(['Not Now', 'OK']), 'Not Now');
    assert.equal(chooseButton(["Don't Allow", 'OK']), "Don't Allow");
    assert.equal(chooseButton(['Turn On Siri', 'Not Now']), 'Not Now');
    assert.equal(chooseButton(['Limit Access…', 'Allow Full Access', "Don't Allow"]), "Don't Allow");
});

test('a grant policy is needed before the farm can reach the photo library', () => {
    assert.equal(chooseButton(['Limit Access…', 'Allow Full Access', "Don't Allow"], 'grant'), 'Allow Full Access');
    assert.equal(chooseButton(["Don't Allow", 'Allow'], 'grant'), 'Allow');
});

test('an unfamiliar two-button alert falls back to the trailing button', () => {
    assert.equal(chooseButton(['Nope', 'Sure']), 'Sure');
});

test('an unfamiliar long alert is left alone rather than guessed at', () => {
    assert.equal(chooseButton(['One', 'Two', 'Three', 'Four']), null);
    assert.equal(chooseButton([]), null);
});

test('destructive dialogs are recognised and never auto-accepted', () => {
    assert.equal(isDestructive('Delete this video?'), true);
    assert.equal(isDestructive('Erase All Content and Settings'), true);
    assert.equal(isDestructive('Sign Out of your account?'), true);
    assert.equal(isDestructive('Allow TikTok to track your activity?'), false);
});
