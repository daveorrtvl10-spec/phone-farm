/**
 * The account roster: one record per TikTok account the farm runs.
 *
 * Phase is DERIVED from timestamps and post history, never hand-set, so the
 * planner cannot drift out of step with reality (a hand-set phase was how a
 * day-1 account nearly got posting sessions booked).
 */
export type Phase = 'lurker' | 'training' | 'health-test' | 'posting' | 'blocked';

export interface PostRecord {
    postedAt: string;
    kind: 'health-test' | 'content';
    /** Views read 24 h and 48 h after posting; null until read. */
    views24h: number | null;
    views48h: number | null;
    note?: string;
}

export interface Account {
    handle: string;
    device: string;
    deviceName: string;
    niche: string;
    owner: string;
    createdAt: string;
    /** Hours of warm-up before posting is allowed. */
    warmupHours: number;
    /** Hours of pure lurking before niche training starts. */
    lurkerHours: number;
    seedTerms: string[];
    posts: PostRecord[];
    /** Set when an account is deliberately parked; overrides the derived phase. */
    parked?: boolean;
}

export interface Roster {
    accounts: Account[];
}

/** The playbook's 700-view health test. */
export const HEALTHY_VIEWS = 700;
export const COMPROMISED_VIEWS = 300;

export function healthTestPost(account: Account): PostRecord | undefined {
    return account.posts.find((post) => post.kind === 'health-test');
}

/** Best view figure we have for a post: the 48 h read if present, else 24 h. */
export function bestViews(post: PostRecord): number | null {
    return post.views48h ?? post.views24h;
}

export function accountPhase(account: Account, now = Date.now()): Phase {
    if (account.parked) return 'blocked';
    const created = Date.parse(account.createdAt);
    if (!Number.isFinite(created)) throw new Error(`${account.handle}: createdAt is not a date`);
    const ageHours = (now - created) / 3_600_000;
    if (ageHours < account.lurkerHours) return 'lurker';
    if (ageHours < account.warmupHours) return 'training';

    const health = healthTestPost(account);
    // Warm-up is done but the health post has not been made or not yet read:
    // keep training-shaped activity and let the post decide.
    if (!health) return 'health-test';
    const views = bestViews(health);
    if (views === null) return 'health-test';
    if (views < COMPROMISED_VIEWS) return 'blocked';
    if (views < HEALTHY_VIEWS) return 'health-test';
    return 'posting';
}

export function describePhase(account: Account, now = Date.now()): string {
    const phase = accountPhase(account, now);
    const created = Date.parse(account.createdAt);
    const ageHours = (now - created) / 3_600_000;
    const health = healthTestPost(account);
    const views = health ? bestViews(health) : null;
    const detail = phase === 'blocked' && views !== null ? ` (health post ${views} views)`
        : phase === 'health-test' && views !== null ? ` (health post ${views} views, inconclusive)`
            : phase === 'health-test' && health ? ' (health post awaiting view read)'
                : phase === 'health-test' ? ' (health post due)' : '';
    return `${account.handle}: ${phase}${detail}, ${ageHours.toFixed(1)} h old`;
}
