/**
 * The device-access surface blocker clearing needs, so the same tested logic
 * can run against either a raw WDA session (tools, probes) or the Appium
 * session a live run already owns.
 *
 * A run must never open a second WDA session: WDA serves one session at a time,
 * so a parallel session would reset the state of the run holding the device.
 */
export interface BlockerProbe {
    /** Alert text, or null when no modal alert is open. */
    alertText(): Promise<string | null>;
    alertButtons(): Promise<string[]>;
    pressAlertButton(name: string): Promise<boolean>;
    /** Pressable elements currently on screen, labelled. */
    buttons(): Promise<Array<{ label: string; press: () => Promise<boolean> }>>;
}

interface AppiumLikeElement {
    getAttribute(name: string): Promise<string | null>;
    click(): Promise<void>;
}

interface AppiumLikeDriver {
    getAlertText(): Promise<string>;
    execute(script: string, args?: unknown): Promise<unknown>;
    /**
     * webdriverio's element-object query. Typed loosely because it returns a
     * chainable thenable rather than a plain promise; it is awaited and narrowed
     * at the call site.
     */
    $$(selector: string): unknown;
    updateSettings(settings: Record<string, unknown>): Promise<unknown>;
}

/**
 * Adapt a live Appium (XCUITest) session.
 *
 * Snapshot depth is capped to the measured ceiling for TikTok's feed: deeper
 * snapshots kill WDA outright, and the default is deeper than that.
 */
export function appiumProbe(driver: AppiumLikeDriver, snapshotMaxDepth = 16): BlockerProbe {
    let depthApplied = false;
    const applyDepth = async (): Promise<void> => {
        if (depthApplied) return;
        depthApplied = true;
        await driver.updateSettings({ snapshotMaxDepth, waitForIdleTimeout: 0 }).catch(() => undefined);
    };

    return {
        async alertText() {
            await applyDepth();
            try {
                const text = await driver.getAlertText();
                return String(text ?? '').replace(/\s+/g, ' ').trim();
            } catch {
                // XCUITest throws NoSuchAlertError when nothing is open.
                return null;
            }
        },
        async alertButtons() {
            try {
                const result = await driver.execute('mobile: alert', { action: 'getButtons' });
                return Array.isArray(result) ? result.map((v) => String(v)) : [];
            } catch {
                return [];
            }
        },
        async pressAlertButton(name: string) {
            try {
                await driver.execute('mobile: alert', { action: 'accept', buttonLabel: name });
                return true;
            } catch {
                return false;
            }
        },
        async buttons() {
            await applyDepth();
            let elements: AppiumLikeElement[] = [];
            try {
                elements = (await driver.$$('-ios class chain:**/XCUIElementTypeButton')) as AppiumLikeElement[];
            } catch {
                return [];
            }
            const out: Array<{ label: string; press: () => Promise<boolean> }> = [];
            for (const element of elements.slice(0, 30)) {
                const label = (await element.getAttribute('label').catch(() => null))
                    ?? (await element.getAttribute('name').catch(() => null));
                if (!label) continue;
                out.push({
                    label: String(label).replace(/\s+/g, ' ').trim(),
                    press: async () => {
                        try {
                            await element.click();
                            return true;
                        } catch {
                            return false;
                        }
                    },
                });
            }
            return out;
        },
    };
}
