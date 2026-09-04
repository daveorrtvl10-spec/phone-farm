import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksLikeSlideshow, slideViewingPlan } from '../src/tiktok/feed-post.js';
import { mulberry32 } from '../src/planning/plan.js';
import type { OcrWord } from '../src/tiktok/ocr.js';

const word = (text: string): OcrWord => ({ text, x: 0, y: 0, width: 10, height: 10, confidence: 60 });

test('the Photo badge on the caption row marks a slideshow', () => {
    // Read live off a real feed post 2026-09-04: the badge sits beside the caption.
    assert.equal(looksLikeSlideshow([word('@'), word('Photo'), word('colorred>>>>')]), true);
    assert.equal(looksLikeSlideshow([word('Photos')]), true);
});

test('an ordinary video is not mistaken for a slideshow', () => {
    // Getting this wrong is costly: a horizontal swipe on a video opens the
    // creator profile instead of advancing a slide.
    assert.equal(looksLikeSlideshow([word('original'), word('sound'), word('8,494')]), false);
    assert.equal(looksLikeSlideshow([word('photography')]), false, 'substring must not match');
    assert.equal(looksLikeSlideshow([]), false);
});

test('slide viewing varies and always moves through some slides', () => {
    for (const seed of [1, 2, 3, 99]) {
        const plan = slideViewingPlan(mulberry32(seed));
        assert.ok(plan.slides >= 2 && plan.slides <= 6, `slides ${plan.slides} out of range`);
        assert.equal(plan.dwellMs.length, plan.slides);
        assert.ok(plan.dwellMs.every((ms) => ms >= 900 && ms <= 3100), 'dwell is human-paced');
    }
    const a = slideViewingPlan(mulberry32(7));
    const b = slideViewingPlan(mulberry32(8));
    assert.notDeepEqual(a, b, 'two posts are not watched identically');
});
