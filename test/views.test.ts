import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCount } from '../src/planning/views.js';

test('play counts parse in every form TikTok renders', () => {
    assert.equal(parseCount('0'), 0);
    assert.equal(parseCount('742'), 742);
    assert.equal(parseCount('1.2K'), 1200);
    assert.equal(parseCount('161.8K'), 161800);
    assert.equal(parseCount('27.1k'), 27100);
    assert.equal(parseCount('1.2M'), 1_200_000);
    assert.equal(parseCount(' 3.4M '), 3_400_000);
    // Some locales render the decimal as a comma.
    assert.equal(parseCount('1,2K'), 1200);
});

test('OCR noise around the play triangle is rejected', () => {
    for (const junk of ['>', '|', '', 'views', '1.2.3', 'K', '12X', '-5']) {
        assert.equal(parseCount(junk), null, `${junk} should not parse as a count`);
    }
});
