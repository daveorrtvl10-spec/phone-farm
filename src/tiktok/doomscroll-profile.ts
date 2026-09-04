export type Personality = 'skimmer' | 'casual' | 'engaged';

export interface ProfileConfig {
    watchMinMs: number;
    watchMaxMs: number;
    /** Share of posts that get a glance rather than a watch. */
    skipShare: number;
    likeChance: number;
    saveChance: number;
    lingerChance: number;
    lingerMinMs: number;
    lingerMaxMs: number;
}

export const PROFILES: Record<Personality, ProfileConfig> = {
    skimmer: {
        watchMinMs: 1500, watchMaxMs: 4000, skipShare: 0.70,
        likeChance: 0.08, saveChance: 0.02,
        lingerChance: 0.05, lingerMinMs: 4000, lingerMaxMs: 8000,
    },
    casual: {
        watchMinMs: 4000, watchMaxMs: 9000, skipShare: 0.55,
        likeChance: 0.18, saveChance: 0.06,
        lingerChance: 0.10, lingerMinMs: 8000, lingerMaxMs: 15000,
    },
    engaged: {
        watchMinMs: 8000, watchMaxMs: 18000, skipShare: 0.35,
        likeChance: 0.35, saveChance: 0.15,
        lingerChance: 0.20, lingerMinMs: 15000, lingerMaxMs: 30000,
    },
};

export function isPersonality(value: string): value is Personality {
    return value === 'skimmer' || value === 'casual' || value === 'engaged';
}

function between(min: number, max: number, random: () => number): number {
    return Math.round(min + random() * (max - min));
}

/**
 * How long a post is watched.
 *
 * A uniform draw between a floor and a ceiling gives every post roughly the same
 * dwell, which is not how anyone scrolls — and it was the shape of this farm's
 * traffic for its first three days. Driving a session by hand on 2026-09-04, most
 * posts got a glance of a second or two and just a few held attention. So: mostly
 * skips, a middling band, and a small tail where something actually landed.
 */
export function pickWatchDurationMs(profile: ProfileConfig, random: () => number = Math.random): number {
    const roll = random();
    const span = profile.watchMaxMs - profile.watchMinMs;
    if (roll < profile.skipShare) {
        // A glance: barely long enough to decide it is not for you.
        return between(profile.watchMinMs, profile.watchMinMs + span * 0.35, random);
    }
    if (roll > 0.9) {
        // Something caught them — past the usual ceiling.
        return between(profile.watchMaxMs, profile.watchMaxMs * 2, random);
    }
    return between(profile.watchMinMs + span * 0.35, profile.watchMaxMs, random);
}

export interface SwipeShape {
    startY: number;
    endY: number;
    durationMs: number;
}

/**
 * No two flicks are identical. The farm sent one fixed vector every time, which
 * is a mechanical signature on its own.
 */
export function pickSwipe(base: SwipeShape, random: () => number = Math.random): SwipeShape {
    return {
        startY: Math.round(base.startY + (random() - 0.5) * 60),
        endY: Math.round(base.endY + (random() - 0.5) * 80),
        durationMs: Math.round(base.durationMs * (0.75 + random() * 0.6)),
    };
}

export interface LingerDecision {
    linger: boolean;
    extraMs: number;
}

// Consumes one random() draw against lingerChance, and — only when lingering —
// a second draw to size the extra wait. Callers that need a fixed random-call
// count regardless of outcome should not rely on this function.
export function decideLinger(profile: ProfileConfig, random: () => number = Math.random): LingerDecision {
    const linger = random() < profile.lingerChance;
    return { linger, extraMs: linger ? between(profile.lingerMinMs, profile.lingerMaxMs, random) : 0 };
}

export function decideLike(profile: ProfileConfig, random: () => number = Math.random): boolean {
    return random() < profile.likeChance;
}

export function decideSave(profile: ProfileConfig, random: () => number = Math.random): boolean {
    return random() < profile.saveChance;
}

export function clampToDeadline(nowMs: number, deadlineMs: number, desiredMs: number): number {
    return Math.max(0, Math.min(desiredMs, deadlineMs - nowMs));
}

export function hasTimeRemaining(nowMs: number, deadlineMs: number): boolean {
    return nowMs < deadlineMs;
}
