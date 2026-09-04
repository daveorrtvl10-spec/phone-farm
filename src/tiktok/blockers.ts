/**
 * Clearing whatever is sitting in front of the app.
 *
 * Two kinds of thing block a run, and they need different handling:
 *   - modal alerts (permission prompts, "Finish Setting Up"), which WDA exposes
 *     through a native alert API that answers definitively;
 *   - full-screen overlays (Siri setup, in-app promo sheets), which are not
 *     alerts at all and are only visible as elements in the view hierarchy.
 *
 * Both are handled by label, never by remembered coordinates, and anything that
 * does not match a known-safe dismissal is left alone for a human rather than
 * guessed at. A wrong press here is unrecoverable: it can grant a permission or
 * delete an account.
 */

import type { BlockerProbe } from './blocker-probe.js';
import { type AlertPolicy, chooseButton, isDestructive } from './system-alerts.js';

/** Labels that dismiss an overlay without agreeing to anything. */
const OVERLAY_DISMISS = [
    /^not now$/i,
    /^maybe later$/i,
    /^later$/i,
    /^skip$/i,
    /^skip for now$/i,
    /^no thanks$/i,
    /^close$/i,
    /^dismiss$/i,
    /^cancel$/i,
    /^done$/i,
    /^ask app not to track$/i,
    // In-feed promos label their dismiss control things like "ic party close".
    // Anchored to the end so TikTok's own "Close Friends" is never matched.
    /[\s_-]close$/i,
];

export interface BlockerOutcome {
    kind: 'none' | 'alert' | 'overlay' | 'unhandled';
    text?: string;
    pressed?: string;
    buttons?: string[];
}

export function findOverlayDismissal(labels: string[]): string | null {
    for (const pattern of OVERLAY_DISMISS) {
        const hit = labels.find((label) => pattern.test(label.trim()));
        if (hit) return hit.trim();
    }
    return null;
}

/**
 * Clear one blocker if present. Returns what happened so a caller can decide
 * whether to keep going, retry, or stop and raise assist.
 */
export async function clearOneBlocker(
    probe: BlockerProbe,
    policy: AlertPolicy = 'defer',
): Promise<BlockerOutcome> {
    const text = await probe.alertText();
    if (text !== null) {
        const buttons = await probe.alertButtons();
        if (isDestructive(text)) return { kind: 'unhandled', text, buttons };
        const choice = chooseButton(buttons, policy);
        if (!choice) return { kind: 'unhandled', text, buttons };
        const ok = await probe.pressAlertButton(choice);
        return ok ? { kind: 'alert', text, pressed: choice, buttons } : { kind: 'unhandled', text, buttons };
    }

    const buttons = await probe.buttons();
    const labels = buttons.map((b) => b.label).filter(Boolean);
    const dismissal = findOverlayDismissal(labels);
    if (!dismissal) return { kind: 'none' };
    const target = buttons.find((b) => b.label.trim() === dismissal);
    if (!target) return { kind: 'none' };
    const ok = await target.press();
    return ok ? { kind: 'overlay', pressed: dismissal, buttons: labels } : { kind: 'unhandled', buttons: labels };
}

/** Clear stacked blockers, stopping at the first thing we will not press. */
export async function clearBlockers(
    probe: BlockerProbe,
    policy: AlertPolicy = 'defer',
    maxRounds = 6,
): Promise<BlockerOutcome[]> {
    const history: BlockerOutcome[] = [];
    for (let round = 0; round < maxRounds; round += 1) {
        const outcome = await clearOneBlocker(probe, policy);
        if (outcome.kind === 'none') break;
        history.push(outcome);
        if (outcome.kind === 'unhandled') break;
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return history;
}
