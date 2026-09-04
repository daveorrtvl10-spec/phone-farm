import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findOverlayDismissal } from '../src/tiktok/blockers.js';

test('dismisses a full-screen setup overlay', () => {
    assert.equal(findOverlayDismissal(['Continue', 'Set Up Later in Settings', 'Not Now']), 'Not Now');
});

test('prefers declining over any affirmative action', () => {
    assert.equal(findOverlayDismissal(['Turn On', 'Skip']), 'Skip');
});

test('leaves a screen alone when nothing is a safe dismissal', () => {
    assert.equal(findOverlayDismissal(['Continue', 'Next', 'Get Started']), null);
});

test('does not treat a follow or post button as a dismissal', () => {
    assert.equal(findOverlayDismissal(['Follow', 'Post', 'Share']), null);
});

test('ignores surrounding whitespace on a label', () => {
    assert.equal(findOverlayDismissal(['  Maybe later ']), 'Maybe later');
});

test('never picks a destructive-sounding button', () => {
    assert.equal(findOverlayDismissal(['Delete Account', 'Log Out']), null);
});

test('dismisses an in-feed promo whose close control is oddly labelled', () => {
    assert.equal(findOverlayDismissal(['LIVE', 'Search', 'ic party close']), 'ic party close');
});

test('never mistakes Close Friends for a dismissal', () => {
    assert.equal(findOverlayDismissal(['Close Friends', 'Following', 'For You']), null);
});
