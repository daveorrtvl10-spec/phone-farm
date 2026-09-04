/**
 * iOS system dialogs, handled through WebDriverAgent's native alert API rather
 * than OCR and coordinate taps.
 *
 * A factory-reset phone queues these up — tracking permission, "Finish Setting
 * Up iPhone", Siri, contacts — and each one blocks every gesture underneath it.
 * A run behind one looks perfectly healthy in the logs while the phone sits
 * frozen, which is exactly how a warm-up trains TikTok that it is a bot.
 *
 * WDA answers `no such alert` cleanly when none is open, so this is a reliable
 * check rather than a guess about pixels.
 */
export interface SystemAlert {
    text: string;
    buttons: string[];
}

/** Buttons that decline or defer, best first. Never taps a consent we don't want. */
const DEFER_FIRST = [
    /^ask app not to track$/i,
    /^not now$/i,
    /^later$/i,
    /^don'?t allow$/i,
    /^cancel$/i,
    /^skip$/i,
    /^close$/i,
    /^dismiss$/i,
    /^no thanks$/i,
    /^ok$/i,
];

/** Permissions the farm genuinely needs; only ever granted deliberately. */
const GRANT_FIRST = [
    /^allow full access$/i,
    /^allow$/i,
    /^ok$/i,
];

export type AlertPolicy = 'defer' | 'grant';

/**
 * Which button to press. `defer` declines or postpones everything, which is the
 * right default while scrolling. `grant` is used only where the farm needs the
 * permission, e.g. photo access before a post.
 */
export function chooseButton(buttons: string[], policy: AlertPolicy = 'defer'): string | null {
    const order = policy === 'grant' ? GRANT_FIRST : DEFER_FIRST;
    for (const pattern of order) {
        const match = buttons.find((button) => pattern.test(button.trim()));
        if (match) return match;
    }
    // An unrecognised dialog: the last button is conventionally the safe default
    // on iOS two-button alerts, but say nothing rather than guess on a long list.
    return buttons.length > 0 && buttons.length <= 2 ? buttons[buttons.length - 1]! : null;
}

/** Alerts that must never be auto-accepted even under a `grant` policy. */
export function isDestructive(text: string): boolean {
    return /delete|erase|reset|remove|sign out|log out|unin?stall/i.test(text);
}
