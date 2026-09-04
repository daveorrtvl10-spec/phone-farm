/**
 * Element-level device access via WebDriverAgent.
 *
 * Reading the whole accessibility tree crashes WDA on TikTok's feed (the
 * hierarchy is far deeper than the default snapshot limit), so everything here
 * is scoped: a depth-capped snapshot plus class-chain queries that return only
 * the elements we asked for. Elements are then acted on by their WDA id, which
 * removes coordinate guessing from every flow that uses this.
 */

export interface UiElement {
    id: string;
    label: string;
    type: string;
    rect: { x: number; y: number; width: number; height: number } | null;
}

export interface UiSession {
    base: string;
    sessionId: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(
    base: string,
    path: string,
    init?: { method?: string; body?: unknown },
): Promise<{ status: number; value: unknown }> {
    const res = await fetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers: init?.body ? JSON_HEADERS : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    try {
        return { status: res.status, value: (JSON.parse(text) as { value?: unknown }).value };
    } catch {
        return { status: res.status, value: text };
    }
}

/** Open a bare WDA session and cap snapshot depth so queries stay survivable. */
export async function openUiSession(base: string, snapshotMaxDepth = 16): Promise<UiSession> {
    const created = await call(base, '/session', {
        method: 'POST',
        body: { capabilities: { alwaysMatch: {} } },
    });
    const sessionId = (created.value as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) throw new Error(`WDA refused a session (status ${created.status})`);
    const session = { base, sessionId };
    await call(base, `/session/${sessionId}/appium/settings`, {
        method: 'POST',
        body: { settings: { snapshotMaxDepth, customSnapshotTimeout: 15 } },
    }).catch(() => undefined);
    return session;
}

export async function closeUiSession(session: UiSession): Promise<void> {
    await call(session.base, `/session/${session.sessionId}`, { method: 'DELETE' }).catch(() => undefined);
}

/** Modal alert text, or null when no alert is open (WDA answers 404). */
export async function alertText(session: UiSession): Promise<string | null> {
    const res = await call(session.base, `/session/${session.sessionId}/alert/text`);
    if (res.status === 404) return null;
    return String(res.value ?? '').replace(/\s+/g, ' ').trim();
}

export async function alertButtons(session: UiSession): Promise<string[]> {
    const res = await call(session.base, `/session/${session.sessionId}/wda/alert/buttons`);
    if (res.status !== 200 || !Array.isArray(res.value)) return [];
    return (res.value as unknown[]).map((v) => String(v));
}

export async function acceptAlertButton(session: UiSession, name: string): Promise<boolean> {
    const res = await call(session.base, `/session/${session.sessionId}/alert/accept`, {
        method: 'POST',
        body: { name },
    });
    return res.status === 200;
}

/**
 * Elements matching a class chain, with labels and rects resolved.
 * `**\/XCUIElementTypeButton` is the usual query for "what can I press here".
 */
export async function findElements(session: UiSession, classChain: string, limit = 40): Promise<UiElement[]> {
    const res = await call(session.base, `/session/${session.sessionId}/elements`, {
        method: 'POST',
        body: { using: 'class chain', value: classChain },
    });
    if (res.status !== 200 || !Array.isArray(res.value)) return [];
    const raw = (res.value as Array<Record<string, string>>).slice(0, limit);
    const out: UiElement[] = [];
    for (const entry of raw) {
        const id = entry.ELEMENT ?? entry['element-6066-11e4-a52e-4f735466cecf'];
        if (!id) continue;
        const [label, name, rect] = await Promise.all([
            call(session.base, `/session/${session.sessionId}/element/${id}/attribute/label`),
            call(session.base, `/session/${session.sessionId}/element/${id}/attribute/name`),
            call(session.base, `/session/${session.sessionId}/element/${id}/rect`),
        ]);
        const text = String(label.value ?? '') || String(name.value ?? '');
        out.push({
            id,
            label: text.replace(/\s+/g, ' ').trim(),
            type: 'Button',
            rect: (rect.value as UiElement['rect']) ?? null,
        });
    }
    return out;
}

/** Press an element by its WDA id. No coordinates involved. */
export async function clickElement(session: UiSession, elementId: string): Promise<boolean> {
    const res = await call(session.base, `/session/${session.sessionId}/element/${elementId}/click`, {
        method: 'POST',
        body: {},
    });
    return res.status === 200;
}

export async function activeBundleId(session: UiSession): Promise<string | null> {
    const res = await call(session.base, `/session/${session.sessionId}/wda/activeAppInfo`);
    if (res.status !== 200) return null;
    return (res.value as { bundleId?: string } | undefined)?.bundleId ?? null;
}
