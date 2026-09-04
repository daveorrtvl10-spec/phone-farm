import type { OcrWord } from './ocr.js';

/**
 * Telling a photo slideshow apart from a video in the feed.
 *
 * TikTok badges image posts with "Photo" on the caption row. This matters
 * behaviourally: a person swipes horizontally through the slides, while sitting
 * on slide one and flicking up is a distinctive non-human pattern — and
 * slideshows are exactly what this farm posts.
 *
 * Direction matters too. A horizontal swipe advances a slideshow, but on a VIDEO
 * it opens the creator's profile, so this must never be guessed at.
 */
export function looksLikeSlideshow(captionBandWords: OcrWord[]): boolean {
    return captionBandWords.some((word) => /^photos?$/i.test(word.text.trim()));
}

/**
 * How many slides to move through, and how long to linger on each.
 * Nobody reads every slide of every post, and nobody reads none of them.
 */
export function slideViewingPlan(random: () => number): { slides: number; dwellMs: number[] } {
    // Most posts get a few slides; occasionally someone reads the whole thing.
    const slides = random() < 0.25 ? 2 + Math.floor(random() * 2) : 3 + Math.floor(random() * 4);
    const dwellMs = Array.from({ length: slides }, () => 900 + Math.floor(random() * 2200));
    return { slides, dwellMs };
}
