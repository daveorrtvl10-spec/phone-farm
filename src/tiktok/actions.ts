import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'webdriverio';

import type { WdaRemoteControl } from '@git-agni/phone-farm-core';
import { findHandleMatch, pointFromWord, recognizeWords, type OcrWord } from './ocr.js';

export async function tapCoordinate(driver: Browser, x: number, y: number, label: string): Promise<void> {
    await driver.performActions([{
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerUp', button: 0 },
        ],
    }]);
    await driver.releaseActions();
    console.log(`Tapped ${label} at (${x}, ${y})`);
}

export interface AccountSwitchCoords {
    profileTabX: number;
    profileTabY: number;
    switcherTriggerX: number;
    switcherTriggerY: number;
}

// The profile header always carries the Following / Followers / Likes row.
export function profilePageIsOpen(words: OcrWord[]): boolean {
    const seen = new Set(words.map((word) => word.text.trim().toLowerCase()));
    return ['following', 'followers'].every((label) => seen.has(label));
}

function switcherIsOpen(words: OcrWord[]): boolean {
    return words.some((word) => word.text.trim().toLowerCase() === 'switch');
}

// Switches the open TikTok session to `targetHandle`. The switcher trigger
// tap is retried: a fresh app launch can show a transient tooltip over the
// profile header that swallows taps in that area (seen live, with
// different tooltip text each time — a dynamic OCR-located trigger tap was
// tried first and was NOT reliable enough to keep; this fixed,
// live-tap-calibrated coordinate plus retries is what held up under
// repeated real-device runs).
export async function switchTikTokAccount(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    targetHandle: string,
    coords: AccountSwitchCoords,
): Promise<void> {
    const { scale } = await remote.getScreenInfo(udid);
    // Reach the Profile page before anything else. A single tab tap is not
    // enough on a live feed: promos/overlays ("56.3B post views here — Explore
    // now", seen live) swallow the first tap, and the old flow then hammered
    // the account-switcher coordinate on the feed where it can never open.
    const MAX_PROFILE_TAB_ATTEMPTS = 3;
    let profileWords: OcrWord[] = [];
    let onProfile = false;
    for (let attempt = 1; attempt <= MAX_PROFILE_TAB_ATTEMPTS && !onProfile; attempt += 1) {
        await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, `Profile tab (attempt ${attempt})`);
        // Longer than the other settle pauses here: a fresh app launch can pop
        // up a transient tooltip/announcement bubble over the profile header
        // (seen live — different text each time, e.g. "What's good?", a
        // "Whisper" feature prompt), and it needs time to appear and, in some
        // cases, auto-dismiss before it stops intercepting taps in that area.
        await driver.pause(2000);
        profileWords = await recognizeWords(await remote.getScreenshot(udid));
        if (findHandleMatch(profileWords, targetHandle)) {
            console.log(`Already on TikTok account ${targetHandle}`);
            return;
        }
        onProfile = profilePageIsOpen(profileWords);
    }
    if (!onProfile) {
        const seen = profileWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not reach the TikTok Profile page after ${MAX_PROFILE_TAB_ATTEMPTS} taps. OCR saw: ${seen}`);
    }

    const MAX_SWITCHER_OPEN_ATTEMPTS = 4;
    let switcherWords: OcrWord[] = [];
    let opened = false;
    for (let attempt = 1; attempt <= MAX_SWITCHER_OPEN_ATTEMPTS && !opened; attempt += 1) {
        await tapCoordinate(driver, coords.switcherTriggerX, coords.switcherTriggerY, `Account switcher (attempt ${attempt})`);
        await driver.pause(1500);
        switcherWords = await recognizeWords(await remote.getScreenshot(udid));
        opened = switcherIsOpen(switcherWords);
    }
    if (!opened) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not open the TikTok account switcher after ${MAX_SWITCHER_OPEN_ATTEMPTS} attempts. OCR saw: ${seen}`);
    }

    const targetMatch = findHandleMatch(switcherWords, targetHandle);
    if (!targetMatch) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not find TikTok account "${targetHandle}" in the account switcher. OCR saw: ${seen}`);
    }
    const targetPoint = pointFromWord(targetMatch, scale);
    await tapCoordinate(driver, targetPoint.x, targetPoint.y, `Account row for ${targetHandle}`);
    // TikTok fully reloads app state after switching accounts.
    await driver.pause(4000);

    await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab (verify)');
    await driver.pause(1000);

    const verifyWords = await recognizeWords(await remote.getScreenshot(udid));
    if (!findHandleMatch(verifyWords, targetHandle)) {
        const screenshotPath = path.resolve('.wda', `account-switch-failed-${udid}.png`);
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await writeFile(screenshotPath, await remote.getScreenshot(udid));
        throw new Error(`Switched but could not confirm TikTok account "${targetHandle}" is active afterward. Screenshot saved to ${screenshotPath}`);
    }
    console.log(`Confirmed active TikTok account: ${targetHandle}`);
}
