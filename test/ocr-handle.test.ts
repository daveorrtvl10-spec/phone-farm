import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findHandleMatch, handleEditTolerance, type OcrWord } from '../src/tiktok/ocr.js';

const word = (text: string): OcrWord => ({ text, x: 0, y: 0, width: 10, height: 10, confidence: 50 });

test('exact handle match wins', () => {
    assert.equal(findHandleMatch([word('@other'), word('@danieuam4s5')], '@danieuam4s5')?.text, '@danieuam4s5');
});

test('one confusable glyph in a long handle still matches', () => {
    // Seen live on an Xs Max profile page: u read as v.
    assert.equal(findHandleMatch([word('Following'), word('@danievam4s5')], '@danieuam4s5')?.text, '@danievam4s5');
});

test('short handles get no edit tolerance', () => {
    assert.equal(handleEditTolerance('abcde'), 0);
    assert.equal(findHandleMatch([word('@abcdf')], '@abcde'), undefined);
});

test('a different handle of the same length does not match', () => {
    assert.equal(findHandleMatch([word('@danieuam4s9x')], '@danieuam4s5'), undefined);
});
