import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'webdriverio';

import type { WdaRemoteControl } from '@git-agni/phone-farm-core';
import { findHandleMatch, pointFromWord, PROFILE_HEADER_REGION, recognizeRegionZoomed, recognizeWords, type OcrWord } from './ocr.js';

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
    /** Feed swipe vector, used to clear tap-swallowing overlays before retrying. */
    swipe: { x: number; startY: number; endY: number; durationMs: number };
}

export async function swipeCoordinate(
    driver: Browser, swipe: { x: number; startY: number; endY: number; durationMs: number }, label: string,
): Promise<void> {
    await driver.performActions([{
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
            { type: 'pointerMove', duration: 0, x: swipe.x, y: swipe.startY },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration: swipe.durationMs, x: swipe.x, y: swipe.endY },
            { type: 'pointerUp', button: 0 },
        ],
    }]);
    await driver.releaseActions();
    console.log(`Swiped ${label}`);
}

// Labels of buttons that dismiss the interstitials a fresh account keeps
// throwing up: iOS permission prompts, onboarding ("Select interests" →
// Skip), leftover pickers (Cancel), promos (Not now / Close). Seen live.
// Whole-button labels only. Partial words ("Not" from "Not now") matched Apple
// Music's "Not Playing" bar and tapped the phone out of TikTok (seen live).
const DISMISS_PATTERNS: RegExp[] = [/^skip$/i, /^cancel$/i, /^close$/i, /^later$/i, /^dismiss$/i];

function tiktokChromeVisible(words: OcrWord[]): boolean {
    const tabs = ['home', 'friends', 'inbox', 'profile'];
    return tabs.filter((tab) => words.some((word) => word.text.trim().toLowerCase() === tab)).length >= 2;
}

async function dismissInterstitial(driver: Browser, words: OcrWord[], scale: number): Promise<boolean> {
    // Two-word "Not now" / "Don't allow": accept only when both halves are on one line.
    const twoWord = words.find((word) => /^(not|don[’']t)$/i.test(word.text.trim())
        && words.some((next) => /^(now|allow)$/i.test(next.text.trim()) && Math.abs(next.y - word.y) < word.height && next.x > word.x && next.x - word.x < word.width * 4));
    if (twoWord) {
        const point = pointFromWord(twoWord, scale);
        await tapCoordinate(driver, point.x, point.y, `dismiss "${twoWord.text} …"`);
        return true;
    }
    for (const pattern of DISMISS_PATTERNS) {
        const match = words.find((word) => pattern.test(word.text.trim()));
        if (!match) continue;
        const point = pointFromWord(match, scale);
        await tapCoordinate(driver, point.x, point.y, `dismiss "${match.text}"`);
        return true;
    }
    return false;
}

async function saveFailureScreenshot(remote: WdaRemoteControl, udid: string, name: string): Promise<string> {
    const screenshotPath = path.resolve('.wda', `${name}-${udid}.png`);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, await remote.getScreenshot(udid));
    return screenshotPath;
}

// Full-frame OCR first, then a zoomed pass over the header — the small grey
// @handle is the thing the full pass keeps missing.
async function handleVisibleOnProfile(screenshot: Buffer, words: OcrWord[], targetHandle: string): Promise<boolean> {
    if (findHandleMatch(words, targetHandle)) return true;
    if (!profilePageIsOpen(words)) return false;
    const header = await recognizeRegionZoomed(screenshot, PROFILE_HEADER_REGION);
    return Boolean(findHandleMatch(header, targetHandle));
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
    const MAX_PROFILE_TAB_ATTEMPTS = 5;
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
        const shot = await remote.getScreenshot(udid);
        profileWords = await recognizeWords(shot);
        if (await handleVisibleOnProfile(shot, profileWords, targetHandle)) {
            console.log(`Already on TikTok account ${targetHandle}`);
            return;
        }
        onProfile = profilePageIsOpen(profileWords);
        if (!onProfile && attempt < MAX_PROFILE_TAB_ATTEMPTS) {
            // Interstitials first (permission prompts, onboarding, leftover
            // pickers); otherwise TikTok's first-run "Swipe up for more"
            // overlay and similar feed promos swallow tab-bar taps until the
            // user swipes. All seen live.
            if (!tiktokChromeVisible(profileWords) && !profilePageIsOpen(profileWords)) {
                // Not even TikTok's tab bar: a system prompt or another app.
                // Try a dismiss; never swipe or tap around in a foreign app.
                if (!(await dismissInterstitial(driver, profileWords, scale))) console.log('TikTok chrome not visible; retrying Profile tab');
            } else if (!(await dismissInterstitial(driver, profileWords, scale))) {
                await swipeCoordinate(driver, coords.swipe, 'feed to clear overlays');
            }
            await driver.pause(1500);
        }
    }
    if (!onProfile) {
        const screenshotPath = await saveFailureScreenshot(remote, udid, 'profile-unreachable');
        const seen = profileWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not reach the TikTok Profile page after ${MAX_PROFILE_TAB_ATTEMPTS} taps. Screenshot saved to ${screenshotPath}. OCR saw: ${seen}`);
    }

    const MAX_SWITCHER_OPEN_ATTEMPTS = 4;
    let switcherWords: OcrWord[] = [];
    let opened = false;
    for (let attempt = 1; attempt <= MAX_SWITCHER_OPEN_ATTEMPTS && !opened; attempt += 1) {
        await tapCoordinate(driver, coords.switcherTriggerX, coords.switcherTriggerY, `Account switcher (attempt ${attempt})`);
        await driver.pause(1500);
        switcherWords = await recognizeWords(await remote.getScreenshot(udid));
        opened = switcherIsOpen(switcherWords);
        // A header tooltip ("What's up?", "Coffee or tea?" — seen live) can
        // hide the handle from the first read and eat the switcher tap; once
        // it clears, the profile itself may already prove the account.
        if (!opened && profilePageIsOpen(switcherWords) && findHandleMatch(switcherWords, targetHandle)) {
            console.log(`Already on TikTok account ${targetHandle}`);
            return;
        }
        if (!opened) await dismissInterstitial(driver, switcherWords, scale);
    }
    if (!opened) {
        const screenshotPath = await saveFailureScreenshot(remote, udid, 'switcher-unopened');
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not open the TikTok account switcher after ${MAX_SWITCHER_OPEN_ATTEMPTS} attempts. Screenshot saved to ${screenshotPath}. OCR saw: ${seen}`);
    }

    const targetMatch = findHandleMatch(switcherWords, targetHandle);
    if (!targetMatch) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not find TikTok account "${targetHandle}" in the account switcher. OCR saw: ${seen}`);
    }
    const targetPoint = pointFromWord(targetMatch, scale);
    // Handles in the switcher sheet render as "@name". If the sheet lists only
    // the target, the phone is signed into exactly one account and the
    // post-switch profile reread (small grey text, often hidden by tooltips
    // such as "What's up?" — seen live) cannot tell us anything more.
    // OCR reads the status-bar battery glyph as "@)" — require a real handle shape.
    const listedHandles = switcherWords.filter((word) => /^@[\w.]{3,}$/.test(word.text.trim()));
    const soleAccount = listedHandles.length === 1 && listedHandles[0] === targetMatch;
    await tapCoordinate(driver, targetPoint.x, targetPoint.y, `Account row for ${targetHandle}`);
    // TikTok fully reloads app state after switching accounts.
    await driver.pause(4000);
    if (soleAccount) {
        await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab (verify)');
        await driver.pause(1000);
        console.log(`Confirmed active TikTok account: ${targetHandle} (only account on this device)`);
        return;
    }

    await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab (verify)');
    await driver.pause(2000);

    const verifyShot = await remote.getScreenshot(udid);
    const verifyWords = await recognizeWords(verifyShot);
    if (!(await handleVisibleOnProfile(verifyShot, verifyWords, targetHandle))) {
        const screenshotPath = path.resolve('.wda', `account-switch-failed-${udid}.png`);
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await writeFile(screenshotPath, await remote.getScreenshot(udid));
        throw new Error(`Switched but could not confirm TikTok account "${targetHandle}" is active afterward. Screenshot saved to ${screenshotPath}`);
    }
    console.log(`Confirmed active TikTok account: ${targetHandle}`);
}
