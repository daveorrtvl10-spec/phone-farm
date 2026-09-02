import { recognize } from 'node-native-ocr';
import sharp from 'sharp';

// node-native-ocr@0.4.18 ships a stale .d.ts declaring an `output` option,
// but the installed runtime (src/index.js) actually reads `format` — confirmed
// by reading the package source directly and testing both against a real
// image. Recast the call to the option name that's actually honored.
type RealRecognizeOptions = { lang?: string; format?: 'txt' | 'tsv' };
const recognizeRaw = recognize as unknown as (image: Buffer, options?: RealRecognizeOptions) => Promise<string>;

export interface OcrWord {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

const MIN_CONFIDENCE = 40;

// Tesseract TSV: level, page_num, block_num, par_num, line_num, word_num,
// left, top, width, height, conf, text. Only level 5 rows are individual
// words; levels 1-4 are page/block/paragraph/line aggregates with conf -1.
export function parseTsv(tsv: string): OcrWord[] {
    const words: OcrWord[] = [];
    for (const line of tsv.split('\n')) {
        if (!line.trim()) continue;
        const columns = line.split('\t');
        if (columns.length < 12 || columns[0] !== '5') continue;
        const confidence = Number(columns[10]);
        const text = columns[11].trim();
        if (!text || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;
        words.push({
            text,
            x: Number(columns[6]),
            y: Number(columns[7]),
            width: Number(columns[8]),
            height: Number(columns[9]),
            confidence,
        });
    }
    return words;
}

export async function recognizeWords(image: Buffer): Promise<OcrWord[]> {
    const tsv = await recognizeRaw(image, { format: 'tsv' });
    return parseTsv(tsv);
}

/**
 * OCR a fraction of the screenshot at 2x. Small grey UI text (the @handle
 * under a TikTok display name) is routinely skipped by a full-frame pass but
 * reads cleanly when the region is cropped and upscaled (verified on two real
 * Xs Max captures, 2026-09-02). Word boxes are mapped back to full-frame
 * device pixels so pointFromWord() still works.
 */
export async function recognizeRegionZoomed(
    image: Buffer, region: { left: number; top: number; width: number; height: number }, factor = 2,
): Promise<OcrWord[]> {
    const meta = await sharp(image).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const box = {
        left: Math.round(width * region.left), top: Math.round(height * region.top),
        width: Math.round(width * region.width), height: Math.round(height * region.height),
    };
    const zoomed = await sharp(image).extract(box).resize({ width: box.width * factor }).png().toBuffer();
    const words = await recognizeWords(zoomed);
    return words.map((word) => ({
        ...word,
        x: box.left + word.x / factor, y: box.top + word.y / factor,
        width: word.width / factor, height: word.height / factor,
    }));
}

/** The TikTok profile header: display name, @handle, stats row. */
export const PROFILE_HEADER_REGION = { left: 0, top: 0.08, width: 0.7, height: 0.14 };

function normalizeHandle(handle: string): string {
    return handle.trim().toLowerCase().replace(/^@/, '');
}

// Exact match first; substring containment as a fuzzy fallback for OCR
// noise. The fallback is logged because it can false-positive between
// similar handles (e.g. "@jenny.doe" is a substring of "@jenny.doe2"). A
// length-ratio guard keeps it from also matching short garbage tokens
// (misread icons/glyphs, e.g. a lone "o") against any longer target — every
// short string is trivially a substring of a long one.
function editDistance(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let diagonal = previous[0]!;
        previous[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const temp = previous[j]!;
            previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = temp;
        }
    }
    return previous[b.length]!;
}

// Handles of 6+ chars tolerate one substituted/dropped/inserted character per
// 6 characters of length. Small-font grey handles routinely come back with a
// single confusable glyph (seen live: "@danieuam4s5" read as "@danievam4s5").
export function handleEditTolerance(target: string): number {
    return target.length >= 6 ? Math.floor(target.length / 6) : 0;
}

export function findHandleMatch(words: OcrWord[], targetHandle: string): OcrWord | undefined {
    const target = normalizeHandle(targetHandle);
    if (!target) return undefined;
    const exact = words.find((word) => normalizeHandle(word.text) === target);
    if (exact) return exact;
    const tolerance = handleEditTolerance(target);
    const near = tolerance > 0
        ? words.find((word) => {
            const normalized = normalizeHandle(word.text);
            return Math.abs(normalized.length - target.length) <= tolerance && editDistance(normalized, target) <= tolerance;
        })
        : undefined;
    if (near) {
        console.log(`Account handle matched within ${tolerance} edit(s): OCR saw "${near.text}" for target "${targetHandle}"`);
        return near;
    }
    const fuzzy = words.find((word) => {
        const normalized = normalizeHandle(word.text);
        if (normalized.length < 4 || target.length < 4) return false;
        const [shorter, longer] = normalized.length <= target.length ? [normalized, target] : [target, normalized];
        return shorter.length / longer.length >= 0.5 && longer.includes(shorter);
    });
    if (fuzzy) {
        console.log(`Account handle matched fuzzily: OCR saw "${fuzzy.text}" for target "${targetHandle}"`);
    }
    return fuzzy;
}

// Screenshots are device-pixel resolution; WDA taps are point-space.
export function pointFromWord(word: OcrWord, scale: number): { x: number; y: number } {
    return {
        x: Math.round((word.x + word.width / 2) / scale),
        y: Math.round((word.y + word.height / 2) / scale),
    };
}
