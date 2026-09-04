import sharp from 'sharp';

/**
 * Reading a photo post's pagination dots.
 *
 * Swiping a slideshow sideways is what a real viewer does, but one swipe past
 * the last slide opens the creator's profile — which is how a warm-up run ends
 * up off the feed, engaging on a profile page for minutes. TikTok exposes no
 * page indicator in the accessibility hierarchy at any snapshot depth the feed
 * survives, so the dots are read off the screen instead.
 *
 * The active dot is drawn brighter than the rest, so one band gives both how
 * many slides exist and which one is showing.
 */

export interface DotRow {
    /** Total dots found, i.e. the number of slides. */
    total: number;
    /** Zero-based index of the brightest (current) dot, or null if ambiguous. */
    active: number | null;
}

export interface GreyBand {
    data: Uint8Array | Buffer;
    width: number;
    height: number;
}

interface Blob {
    start: number;
    end: number;
    peak: number;
}

/**
 * Measured on an iPhone Xs Max screenshot (1242px wide): the current dot peaks
 * at 250 and the rest at 82 against a near-black band, and each dot is about
 * 18px across. A brightness floor above 82 sees only the current dot, and a
 * width limit in points rejects every dot on a 3x screenshot, so the floor sits
 * below the dim dots and the width limit is relative to the image.
 */
const MIN_BRIGHTNESS = 70;
const MAX_DOT_WIDTH_FRACTION = 0.04;
const MIN_DOTS = 2;
const MAX_DOTS = 40;
/**
 * Pagination always shows exactly one current dot, brighter than the rest.
 * Requiring that signature is what separates the dot row from evenly spaced
 * bright runs elsewhere in the band, such as caption text.
 */
const ACTIVE_DOT_MARGIN = 60;

function blobsInRow(band: GreyBand, y: number): Blob[] {
    const blobs: Blob[] = [];
    let start = -1;
    let peak = 0;
    for (let x = 0; x < band.width; x += 1) {
        const value = band.data[y * band.width + x] ?? 0;
        if (value >= MIN_BRIGHTNESS) {
            if (start < 0) {
                start = x;
                peak = value;
            } else if (value > peak) peak = value;
        } else if (start >= 0) {
            blobs.push({ start, end: x - 1, peak });
            start = -1;
            peak = 0;
        }
    }
    if (start >= 0) blobs.push({ start, end: band.width - 1, peak });
    return blobs;
}

/**
 * The longest run of blobs that behaves like pagination: small, similar in
 * size, and evenly spaced.
 *
 * A run is searched for inside the row rather than demanding the whole row
 * qualify, because the right-hand rail (share counts, avatars) can sit at the
 * same height as the dots and would otherwise disqualify the row entirely.
 */
function longestDotRun(blobs: Blob[], bandWidth: number): Blob[] {
    const maxWidth = bandWidth * MAX_DOT_WIDTH_FRACTION;
    const candidates = blobs.filter((blob) => blob.end - blob.start + 1 <= maxWidth);
    let best: Blob[] = [];

    for (let start = 0; start < candidates.length; start += 1) {
        for (let end = start + MIN_DOTS - 1; end < candidates.length; end += 1) {
            const run = candidates.slice(start, end + 1);
            const widths = run.map((blob) => blob.end - blob.start + 1);
            if (Math.max(...widths) > Math.min(...widths) * 3) break;

            const centres = run.map((blob) => (blob.start + blob.end) / 2);
            const gaps: number[] = [];
            for (let i = 1; i < centres.length; i += 1) gaps.push(centres[i]! - centres[i - 1]!);
            if (Math.max(...gaps) > Math.min(...gaps) * 1.6) break;

            const peaks = run.map((blob) => blob.peak);
            const floor = Math.min(...peaks);
            const bright = peaks.filter((peak) => peak >= floor + ACTIVE_DOT_MARGIN);
            if (bright.length !== 1) continue;

            if (run.length > best.length) best = run;
        }
    }
    return best.length >= MIN_DOTS && best.length <= MAX_DOTS ? best : [];
}

/** Best dot row in a band, or null when the band holds no pagination. */
export function readDotRow(band: GreyBand): DotRow | null {
    let best: { blobs: Blob[]; spread: number } | null = null;
    for (let y = 0; y < band.height; y += 1) {
        const blobs = longestDotRun(blobsInRow(band, y), band.width);
        if (blobs.length === 0) continue;
        const peaks = blobs.map((blob) => blob.peak);
        const spread = Math.max(...peaks) - Math.min(...peaks);
        if (!best || blobs.length > best.blobs.length || (blobs.length === best.blobs.length && spread > best.spread)) {
            best = { blobs, spread };
        }
    }
    if (!best) return null;

    const peaks = best.blobs.map((blob) => blob.peak);
    return { total: best.blobs.length, active: peaks.indexOf(Math.max(...peaks)) };
}

/**
 * How many more sideways swipes this post can take before the next one leaves
 * it. Returns 0 when the count could not be read, so callers stay put rather
 * than swipe blind.
 */
export function remainingSlides(row: DotRow | null): number {
    if (!row || row.active === null) return 0;
    return Math.max(0, row.total - 1 - row.active);
}

/**
 * Read the pagination of the post currently on screen.
 *
 * The dots sit above the caption, whose height varies with the post, so a
 * generous band is scanned rather than a fixed line.
 */
export async function readSlidePagination(image: Buffer): Promise<DotRow | null> {
    const meta = await sharp(image).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return null;
    const top = Math.round(height * 0.7);
    const bandHeight = Math.round(height * 0.15);
    const { data, info } = await sharp(image)
        .extract({ left: 0, top, width, height: bandHeight })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return readDotRow({ data, width: info.width, height: info.height });
}
