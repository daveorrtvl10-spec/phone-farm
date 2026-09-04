import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type GreyBand, readDotRow, remainingSlides } from '../src/tiktok/slide-dots.js';

/** Paint a row of evenly spaced dots, one of them brighter. */
function band(dots: number, activeIndex: number, options?: { spacing?: number; width?: number; dotWidth?: number; dim?: number }): GreyBand {
    const width = options?.width ?? 414;
    const height = 12;
    const spacing = options?.spacing ?? 14;
    const dotWidth = options?.dotWidth ?? 6;
    const dim = options?.dim ?? 140;
    const data = new Uint8Array(width * height);
    const totalWidth = (dots - 1) * spacing;
    const startX = Math.round(width / 2 - totalWidth / 2);
    for (let i = 0; i < dots; i += 1) {
        const centre = startX + i * spacing;
        const brightness = i === activeIndex ? 250 : dim;
        for (let y = 4; y < 8; y += 1) {
            for (let x = centre - Math.floor(dotWidth / 2); x < centre + Math.ceil(dotWidth / 2); x += 1) {
                data[y * width + x] = brightness;
            }
        }
    }
    return { data, width, height };
}

test('reads how many slides a post has', () => {
    assert.equal(readDotRow(band(7, 0))?.total, 7);
});

test('reads which slide is showing', () => {
    assert.equal(readDotRow(band(7, 3))?.active, 3);
});

test('reports nothing on a band with no pagination', () => {
    assert.equal(readDotRow({ data: new Uint8Array(414 * 12), width: 414, height: 12 }), null);
});

test('does not mistake a caption for pagination', () => {
    // Wide, irregularly spaced bright runs: text, not dots.
    const width = 414;
    const data = new Uint8Array(width * 12);
    for (const [start, end] of [[10, 90], [96, 130], [180, 300]]) {
        for (let y = 4; y < 8; y += 1) for (let x = start; x < end; x += 1) data[y * width + x] = 220;
    }
    assert.equal(readDotRow({ data, width, height: 12 }), null);
});

test('counts remaining swipes before the post would be left', () => {
    assert.equal(remainingSlides(readDotRow(band(7, 0))), 6);
    assert.equal(remainingSlides(readDotRow(band(7, 6))), 0);
    assert.equal(remainingSlides(readDotRow(band(3, 1))), 1);
});

test('refuses to swipe when the dots could not be read', () => {
    assert.equal(remainingSlides(null), 0);
});

test('refuses to swipe when no dot is clearly the current one', () => {
    // Pagination without a distinct current dot is not pagination we can act on:
    // without knowing the position, any sideways swipe risks leaving the post.
    const uniform = readDotRow(band(5, -1));
    assert.equal(uniform, null);
    assert.equal(remainingSlides(uniform), 0);
});

test('reads a real 3x screenshot band, where dim dots are far darker than the current one', () => {
    // Geometry measured from an iPhone Xs Max feed screenshot: 1242px wide,
    // seven dots ~16px across, spaced 36px, dim dots at 82 and the current at 250.
    assert.deepEqual(readDotRow(band(7, 0, { width: 1242, spacing: 36, dotWidth: 16, dim: 82 })), {
        total: 7,
        active: 0,
    });
});

test('ignores a bright control far off to the side of the dot row', () => {
    const width = 1242;
    const height = 12;
    const data = new Uint8Array(width * height);
    const paint = (centre: number, halfWidth: number, brightness: number) => {
        for (let y = 4; y < 8; y += 1) {
            for (let x = centre - halfWidth; x < centre + halfWidth; x += 1) data[y * width + x] = brightness;
        }
    };
    [504, 540, 576, 612, 648, 686, 723].forEach((centre, index) => paint(centre, 8, index === 0 ? 250 : 82));
    paint(1137, 14, 182); // share count on the right rail
    assert.equal(readDotRow({ data, width, height })?.total, 7);
});
