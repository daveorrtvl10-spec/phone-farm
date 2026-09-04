import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROFILES, pickSwipe, pickWatchDurationMs } from '../src/tiktok/doomscroll-profile.js';
import { mulberry32 } from '../src/planning/plan.js';

function sample(personality: 'skimmer' | 'casual' | 'engaged', n = 4000): number[] {
    const random = mulberry32(42);
    return Array.from({ length: n }, () => pickWatchDurationMs(PROFILES[personality], random));
}

test('most posts get a glance, not a watch', () => {
    // The old uniform draw gave nearly every post the same dwell, which is the
    // shape this farm's traffic had for three days.
    const casual = sample('casual');
    const profile = PROFILES.casual;
    const glanceCeiling = profile.watchMinMs + (profile.watchMaxMs - profile.watchMinMs) * 0.35;
    const glances = casual.filter((ms) => ms <= glanceCeiling).length / casual.length;
    assert.ok(glances > 0.45 && glances < 0.65, `glance share ${glances.toFixed(2)} should be around the 0.55 skip share`);
});

test('the distribution is right-skewed, with a real tail', () => {
    const casual = [...sample('casual')].sort((a, b) => a - b);
    const median = casual[Math.floor(casual.length / 2)]!;
    const mean = casual.reduce((sum, ms) => sum + ms, 0) / casual.length;
    assert.ok(median < mean, `median ${median} should sit below mean ${Math.round(mean)}`);
    const longest = casual[casual.length - 1]!;
    assert.ok(longest > PROFILES.casual.watchMaxMs, 'some posts hold attention past the usual ceiling');
});

test('a skimmer skips more than an engaged viewer', () => {
    const shortFor = (p: 'skimmer' | 'engaged') => {
        const draws = sample(p);
        const profile = PROFILES[p];
        const ceiling = profile.watchMinMs + (profile.watchMaxMs - profile.watchMinMs) * 0.35;
        return draws.filter((ms) => ms <= ceiling).length / draws.length;
    };
    assert.ok(shortFor('skimmer') > shortFor('engaged'), 'skimmers glance more often');
});

test('every dwell is still a sane positive length', () => {
    for (const p of ['skimmer', 'casual', 'engaged'] as const) {
        for (const ms of sample(p, 500)) {
            assert.ok(ms >= PROFILES[p].watchMinMs, `${ms} under the floor`);
            assert.ok(ms <= PROFILES[p].watchMaxMs * 2, `${ms} beyond twice the ceiling`);
        }
    }
});

test('no two flicks are identical', () => {
    const base = { startY: 700, endY: 250, durationMs: 450 };
    const random = mulberry32(7);
    const swipes = Array.from({ length: 50 }, () => pickSwipe(base, random));
    assert.equal(new Set(swipes.map((s) => `${s.startY}:${s.endY}:${s.durationMs}`)).size > 40, true, 'vectors vary');
    for (const s of swipes) {
        assert.ok(s.startY > s.endY, 'still an upward flick');
        assert.ok(s.durationMs > 200 && s.durationMs < 700, `duration ${s.durationMs} stays plausible`);
    }
});
