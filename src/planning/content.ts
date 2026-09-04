import { accountPhase, type Account } from './roster.js';
import { GOLDEN_WINDOWS } from './plan.js';

/**
 * The contract between whoever makes the slides and the farm that posts them.
 *
 * Content is dropped as a folder per post; the farm picks the oldest ready one
 * for an account and posts it inside a golden window. Nothing about generation
 * lives here, so a separate session (or a person) can fill the folder without
 * knowing anything about phones.
 */
export interface PostManifest {
    caption: string;
    /** 'publish' goes public; 'draft' saves to TikTok drafts for review. */
    destination: 'publish' | 'draft';
    /** What this post is testing — the hook/format hypothesis. Free text. */
    hypothesis?: string;
    createdAt?: string;
}

export const MAX_SLIDES = 12;
export const MAX_CAPTION = 2200;
export const MAX_POSTS_PER_DAY = 2;
/** TikTok's picker takes one video or an all-image slideshow, never a mix. */
const IMAGE = /\.(jpe?g|png)$/i;

export interface Validation {
    ok: boolean;
    errors: string[];
}

export function validatePost(files: string[], manifest: Partial<PostManifest>): Validation {
    const errors: string[] = [];
    const slides = files.filter((file) => IMAGE.test(file)).sort();
    if (slides.length === 0) errors.push('no image slides found');
    if (slides.length > MAX_SLIDES) errors.push(`${slides.length} slides; the picker grid handles at most ${MAX_SLIDES}`);
    if (files.length !== slides.length) errors.push('folder contains non-image files; a post is images only');
    const caption = manifest.caption?.trim();
    if (!caption) errors.push('caption is empty');
    else if (caption.length > MAX_CAPTION) errors.push(`caption is ${caption.length} characters; TikTok allows ${MAX_CAPTION}`);
    if (manifest.destination !== 'publish' && manifest.destination !== 'draft') {
        errors.push("destination must be 'publish' or 'draft'");
    }
    return { ok: errors.length === 0, errors };
}

export interface GateInput {
    account: Account;
    now: number;
    tzOffsetHours: number;
    /** Posts already made by this account today. */
    postsToday: number;
    /** Minutes the post needs; keeps it from starting as a window shuts. */
    needMinutes?: number;
    /** Allow the health-test post before the account has cleared 700 views. */
    allowHealthTest?: boolean;
}

/** Whether this account may post right now, and if not, plainly why. */
export function postingAllowed(input: GateInput): { ok: boolean; reason: string } {
    const { account, now, tzOffsetHours, postsToday } = input;
    const need = input.needMinutes ?? 10;

    const created = Date.parse(account.createdAt);
    const ageHours = (now - created) / 3_600_000;
    if (ageHours < account.warmupHours) {
        const left = (account.warmupHours - ageHours).toFixed(1);
        return { ok: false, reason: `warming up — posting opens in ${left} h` };
    }

    const phase = accountPhase(account, now);
    if (phase === 'blocked') return { ok: false, reason: 'account is blocked (health post under 300 views, or parked)' };
    if (phase === 'health-test' && !input.allowHealthTest) {
        return { ok: false, reason: 'health test not cleared yet — only the health-test post may go out' };
    }

    if (postsToday >= MAX_POSTS_PER_DAY) {
        return { ok: false, reason: `already posted ${postsToday} times today (cap ${MAX_POSTS_PER_DAY})` };
    }

    const local = new Date(now + tzOffsetHours * 3_600_000);
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    const inWindow = GOLDEN_WINDOWS.some(([from, to]) => minute >= from * 60 && minute + need <= to * 60);
    if (!inWindow) return { ok: false, reason: 'outside the golden posting windows' };

    return { ok: true, reason: 'ok' };
}
