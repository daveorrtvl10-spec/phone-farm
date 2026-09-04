import sharp from 'sharp';

import { recognizeWords } from '../tiktok/ocr.js';
import type { PostRecord } from './roster.js';

/**
 * Reads the play counts off a TikTok profile grid screenshot.
 *
 * The count is small white text over the thumbnail, which plain OCR cannot read
 * (verified 2026-09-03: a full-frame pass and a wide zoomed band both returned
 * nothing). Cropping the tile's bottom-left corner, flattening to greyscale and
 * thresholding to near-white does read it.
 */
export interface TileGeometry {
    /** Device pixels, not points. Measured on the Xs Max profile grid. */
    gridTopPx: number;
    tileWidthPx: number;
    tileHeightPx: number;
    /** The count badge, relative to the tile's bottom-left corner. */
    badgeLeftPx: number;
    badgeWidthPx: number;
    badgeHeightPx: number;
}

export const XS_MAX_GRID: TileGeometry = {
    gridTopPx: 1290, tileWidthPx: 414, tileHeightPx: 610,
    badgeLeftPx: 20, badgeWidthPx: 140, badgeHeightPx: 78,
};

/** "0" | "1.2K" | "161.8K" | "1.2M" → a number, or null if it isn't a count. */
export function parseCount(text: string): number | null {
    const match = /^([0-9]+(?:[.,][0-9]+)?)\s*([KMkm]?)$/.exec(text.trim());
    if (!match) return null;
    const value = Number(match[1]!.replace(',', '.'));
    if (!Number.isFinite(value)) return null;
    const suffix = match[2]?.toUpperCase();
    if (suffix === 'K') return Math.round(value * 1_000);
    if (suffix === 'M') return Math.round(value * 1_000_000);
    return Math.round(value);
}

async function readBadge(screenshot: Buffer, box: { left: number; top: number; width: number; height: number }): Promise<number | null> {
    const prepared = await sharp(screenshot)
        .extract(box)
        .greyscale()
        .normalise()
        .resize(box.width * 6)
        .threshold(170)
        .png()
        .toBuffer();
    const words = await recognizeWords(prepared);
    for (const word of words) {
        const count = parseCount(word.text);
        if (count !== null) return count;
    }
    return null;
}

/** Play counts for the first `tiles` posts, newest first. null where unreadable. */
export async function readGridViews(
    screenshot: Buffer, tiles = 3, geometry: TileGeometry = XS_MAX_GRID,
): Promise<Array<number | null>> {
    const meta = await sharp(screenshot).metadata();
    const imageWidth = meta.width ?? 0;
    const imageHeight = meta.height ?? 0;
    const results: Array<number | null> = [];
    for (let index = 0; index < tiles; index += 1) {
        const row = Math.floor(index / 3);
        const column = index % 3;
        const left = column * geometry.tileWidthPx + geometry.badgeLeftPx;
        const top = geometry.gridTopPx + row * geometry.tileHeightPx + geometry.tileHeightPx - geometry.badgeHeightPx;
        if (left + geometry.badgeWidthPx > imageWidth || top + geometry.badgeHeightPx > imageHeight) {
            results.push(null);
            continue;
        }
        results.push(await readBadge(screenshot, { left, top, width: geometry.badgeWidthPx, height: geometry.badgeHeightPx }));
    }
    return results;
}

export interface TileResolution {
    ok: boolean;
    index: number;
    reason: string;
}

/**
 * Which grid tile holds the health-test post.
 *
 * The grid is newest-first, so with a single post the answer is tile 0. Past that
 * it is a guess: TikTok reorders the grid when a post is pinned, so chronological
 * position stops matching grid position. Since this number decides whether an
 * account is used or reset, guessing is not acceptable — ask for the tile instead.
 */
export function resolveHealthTile(posts: PostRecord[], explicitTile?: number): TileResolution {
    if (explicitTile !== undefined) {
        if (!Number.isInteger(explicitTile) || explicitTile < 0) {
            return { ok: false, index: -1, reason: `--tile must be a non-negative integer, got ${explicitTile}` };
        }
        return { ok: true, index: explicitTile, reason: 'tile given explicitly' };
    }
    const health = posts.filter((post) => post.kind === 'health-test');
    if (health.length === 0) return { ok: false, index: -1, reason: 'no health-test post recorded' };
    if (posts.length === 1) return { ok: true, index: 0, reason: 'only one post, so it is the newest tile' };
    return {
        ok: false,
        index: -1,
        reason: `${posts.length} posts on the profile — grid order is not reliable once TikTok can pin or reorder, so pass --tile <index> (0 is newest)`,
    };
}
