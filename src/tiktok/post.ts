import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { remote, type Browser } from 'webdriverio';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import type { PostManifest } from './post-manifest.js';
import { type TikTokCoordinates } from './coordinates.js';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchTikTokAccount, swipeCoordinate, tapCoordinate } from './actions.js';
import { recentPickerTargets } from './post-layout.js';
import { isRedCheckboxChecked } from './pixel.js';
import { recognizeRegionZoomed, recognizeWords, type OcrWord } from './ocr.js';
import { awaitAssist } from './assist.js';

function positiveInteger(name: string, fallback: number): number {
    const raw = process.env[name] ?? String(fallback);
    const value = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
}

async function importMedia(manifest: PostManifest): Promise<number> {
    const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
    let assetCount = 0;
    // Photos Recents is newest-first. Reverse import makes cell 0 the user's first item.
    for (const [index, file] of [...manifest.files].reverse().entries()) {
        console.log(`Importing media ${manifest.files.length - index}/${manifest.files.length}: ${file.name}`);
        const data = await readFile(file.path);
        // WDA's /wda/import-media takes the whole file base64-encoded in a JSON
        // body. base64 is 4*ceil(n/3) chars and JSON.stringify allocates a
        // second copy; Node's max string length (~512 MiB) caps the input near
        // 384 MiB, so refuse well before that.
        if (data.length > 350 * 1024 * 1024) {
            throw new Error(`${file.name} is ${(data.length / 1_048_576).toFixed(0)} MB — the TikTok media import limit is 350 MB`);
        }
        const response = await fetch(`${wdaUrl}/wda/import-media`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: file.name, mimeType: file.mimeType, data: data.toString('base64') }),
        });
        const result = await response.json() as { value?: { error?: unknown; assetCount?: number } };
        if (!response.ok || (result.value && typeof result.value === 'object' && 'error' in result.value)) {
            throw new Error(`WDA could not import ${file.name}: ${JSON.stringify(result)}`);
        }
        assetCount = result.value?.assetCount ?? 0;
    }
    if (!assetCount) throw new Error('WDA did not return the Photos asset count');
    return assetCount;
}

async function firstDisplayed(driver: Browser, selectors: string[]) {
    for (const selector of selectors) {
        const candidate = await driver.$(selector);
        if (await candidate.isExisting() && await candidate.isDisplayed()) return candidate;
    }
    return undefined;
}

async function clickOne(driver: Browser, label: string, selectors: string[]): Promise<void> {
    const element = await firstDisplayed(driver, selectors);
    if (!element) throw new Error(`TikTok control not found: ${label}`);
    await element.click();
    console.log(`Tapped ${label}`);
}

async function openComposer(
    driver: Browser,
    coordinates: TikTokCoordinates['tiktok'],
    musicUrl?: string,
): Promise<void> {
    if (musicUrl) {
        console.log(`Opening music URL: ${musicUrl}`);
        await driver.execute('mobile: deepLink', { url: musicUrl });
        await driver.pause(4000);
        await clickOne(driver, 'Use this sound', [
            '~Use this sound', '~Use sound', '-ios predicate string:(label CONTAINS[c] "Use this sound") OR (name CONTAINS[c] "Use this sound")',
        ]);
    } else {
        await driver.activateApp(process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically');
        await driver.pause(2500);
        // TikTok's live feed can make accessibility queries hang. The center
        // bottom navigation button is stable on the configured device layout.
        await tapCoordinate(
            driver,
            coordinates.create.x,
            coordinates.create.y,
            'Create',
        );
    }
    await driver.pause(2500);
    await tapCoordinate(driver, coordinates.upload.x, coordinates.upload.y, 'Upload');
    await driver.pause(2500);
}

// activateApp right after terminateApp can silently not take (seen live: the
// phone stayed on Springboard, and the Profile-tab coordinate opened Apple
// Music from the dock). Ask XCUITest which app is in front rather than
// guessing from OCR — a full-screen TikTok promo has none of the tab words.
async function requireTikTokInFront(driver: Browser, bundleId: string): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const state = await driver.queryAppState(bundleId);
        if (state === 4) return; // RUNNING_IN_FOREGROUND
        console.log(`TikTok app state ${state} (attempt ${attempt}); re-activating`);
        await driver.activateApp(bundleId);
        await driver.pause(5000);
    }
    throw new Error('TikTok did not come to the foreground after activateApp');
}

const UPLOAD_ATTEMPTS = 4;

// Close buttons render as a bare "X" glyph in the top strip of the screen;
// Skip/Cancel/Close/Later/Not now are word buttons. One tap, best effort.
async function dismissOverlay(driver: Browser, remote: WdaRemoteControl, udid: string): Promise<boolean> {
    const { scale } = await remote.getScreenInfo(udid);
    const words = await screenWords(remote, udid);
    const topStrip = 0.8 * 896 * scale; // promo/passkey sheets put their X as low as 2/3 down (seen live)
    const close = words.find((word) => /^[xX×]$/.test(word.text.trim()) && word.y < topStrip);
    const label = words.find((word) => /^(skip|cancel|close|later|dismiss)$/i.test(word.text.trim()))
        ?? words.find((word) => /^not$/i.test(word.text.trim()) && words.some((n) => /^now$/i.test(n.text.trim()) && Math.abs(n.y - word.y) < word.height));
    const target = close ?? label;
    if (!target) return false;
    const point = { x: Math.round((target.x + target.width / 2) / scale), y: Math.round((target.y + target.height / 2) / scale) };
    await tapCoordinate(driver, point.x, point.y, `dismiss "${target.text}"`);
    await driver.pause(1500);
    return true;
}

// On a cold start the camera can still be initialising when the first Upload
// tap lands (seen live: screen unchanged, still showing the mode strip). Read
// the screen and re-tap until the picker is up.
async function openPicker(
    driver: Browser, remote: WdaRemoteControl, udid: string, coordinates: TikTokCoordinates['tiktok'],
): Promise<void> {
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
        let words = await screenWords(remote, udid);
        let screen = identifyScreen(words);
        // A sheet mid-animation reads as nothing at all (seen live: the picker
        // was open a moment later). Never act on a blank read — look again.
        for (let reread = 0; reread < 2 && words.length < 3; reread += 1) {
            await driver.pause(2000);
            words = await screenWords(remote, udid);
            screen = identifyScreen(words);
        }
        if (screen === 'picker') return;
        if (screen !== 'camera') {
            // Not the camera: usually a promo or prompt over the feed/camera
            // (avatar promo with only an X — seen live). Dismiss it and re-tap
            // Create rather than tapping Upload into whatever this is.
            console.log(`Expected the camera after Create but saw ${screen}; dismissing and re-tapping Create`);
            await dismissOverlay(driver, remote, udid);
            await tapCoordinate(driver, coordinates.create.x, coordinates.create.y, 'Create (retry)');
            await driver.pause(3000);
            continue;
        }
        // TikTok's camera has two layouts (CAMERA-mode: thumbnail bottom-left;
        // POST-mode: bottom-right). Alternate between the two known spots.
        const target = attempt % 2 === 0 && coordinates.uploadAlt ? coordinates.uploadAlt : coordinates.upload;
        await tapCoordinate(driver, target.x, target.y, `Upload (retry ${attempt}${target === coordinates.uploadAlt ? ', alt layout' : ''})`);
        await driver.pause(3500);
    }
    await requireScreen(remote, udid, 'picker', 'Opening the photo picker');
}

const CHECKBOX_RETRY_ATTEMPTS = 3;

// TikTok's Photos picker checkboxes ("Select multiple", "Use layout") are
// persistent toggles, not one-time buttons — they can already be in the
// desired state from a previous picker session. A blind tap assuming a
// fixed starting state can flip a checkbox the WRONG way (e.g. turning off
// an already-on "Select multiple", silently dropping into single-select
// mode). Check the actual on-screen color before deciding whether to tap.
async function ensureCheckboxState(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    point: { x: number; y: number },
    label: string,
    desired: boolean,
): Promise<void> {
    const { scale } = await remote.getScreenInfo(udid);
    for (let attempt = 1; attempt <= CHECKBOX_RETRY_ATTEMPTS; attempt += 1) {
        const checked = await isRedCheckboxChecked(await remote.getScreenshot(udid), point, scale);
        if (checked === desired) {
            console.log(`"${label}" confirmed ${desired ? 'on' : 'off'}`);
            return;
        }
        await tapCoordinate(driver, point.x, point.y, `${label} (attempt ${attempt})`);
        await driver.pause(1000);
    }
    throw new Error(`Could not get "${label}" into the ${desired ? 'on' : 'off'} state after ${CHECKBOX_RETRY_ATTEMPTS} attempts`);
}

async function chooseRecentMedia(
    driver: Browser, remote: WdaRemoteControl, udid: string, count: number, assetCount: number,
    coordinates: TikTokCoordinates['tiktok'],
): Promise<void> {
    const latestIndex = assetCount - 1;
    await openPicker(driver, remote, udid, coordinates);
    // The grid opens scrolled to the bottom (newest last) but remembers a
    // manual scroll; two upward flicks guarantee the bottom.
    for (let i = 0; i < 2; i += 1) {
        await swipeCoordinate(driver, { x: 207, startY: 780, endY: 300, durationMs: 300 }, 'picker grid to bottom');
        await driver.pause(600);
    }
    await driver.pause(800);
    if (count === 1) {
        // "Select multiple" persists between sessions; with it on, a single tap
        // only ticks the cell instead of opening the preview.
        await ensureCheckboxState(driver, remote, udid, {
            x: coordinates.selectMultiple.x,
            y: coordinates.selectMultiple.y,
        }, 'Select multiple', false);
    }
    if (count > 1) {
        await ensureCheckboxState(driver, remote, udid, {
            x: coordinates.selectMultiple.x,
            y: coordinates.selectMultiple.y,
        }, 'Select multiple', true);
        const targets = recentPickerTargets(assetCount, count, {
            circleX: coordinates.picker.circleX,
            columnStep: coordinates.picker.columnStep,
            firstY: coordinates.picker.firstY,
            trayY: coordinates.picker.trayY,
            rowStep: coordinates.picker.rowStep,
        });
        for (const [selection, { x, y }] of targets.entries()) {
            await tapCoordinate(driver, x, y, `media ${selection + 1}/${count}`);
            await driver.pause(600);
        }
        // "Use layout" only appears once 2+ items are ticked; it defaults off.
        if (has(await screenWords(remote, udid), /^layout$/i)) {
            await ensureCheckboxState(driver, remote, udid, {
                x: coordinates.useLayout.x,
                y: coordinates.useLayout.y,
            }, 'Use layout', false);
        } else {
            console.log('"Use layout" not shown; skipping');
        }
    } else {
        const column = latestIndex % 3;
        const x = coordinates.picker.cellX + (column * coordinates.picker.cellStep);
        await tapCoordinate(driver, x, coordinates.picker.cellY, 'media 1/1');
        await driver.pause(1000);
    }
    await advanceToCaptionScreen(driver, remote, udid, coordinates);
}

function wordIs(word: OcrWord, pattern: RegExp): boolean {
    return pattern.test(word.text.trim());
}
function has(words: OcrWord[], pattern: RegExp): boolean {
    return words.some((word) => wordIs(word, pattern));
}

// An iOS keyboard OCRs as a row of single letters.
function keyboardVisible(words: OcrWord[]): boolean {
    const letters = new Set(words.map((word) => word.text.trim()).filter((text) => /^[a-zA-Z]$/.test(text)).map((text) => text.toLowerCase()));
    return ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'].filter((key) => letters.has(key)).length >= 6;
}

// Screen signatures, from readable words only. OCR cannot read white-on-red
// buttons (Next, Post) or the icon+label Drafts button, so those are tapped at
// profile coordinates and the *screen* is identified by its other labels.
// Mapped live on an Xs Max, TikTok Sept 2026.
type PostScreen = 'camera' | 'picker' | 'preview' | 'editor' | 'form' | 'captionEditor' | 'unknown';
function identifyScreen(words: OcrWord[]): PostScreen {
    const location = has(words, /^location$/i);
    const share = has(words, /^share$/i);
    const catchy = has(words, /^catchy$/i) || has(words, /^description$/i);
    if (location && share) return 'form';                      // caption/post form
    if (catchy && has(words, /^\d+\/4000$/)) return 'captionEditor'; // full-screen text editor
    if (keyboardVisible(words)) return 'captionEditor';               // inline keyboard on the slideshow form
    if (has(words, /^recents$/i) || (has(words, /^select$/i) && has(words, /^multiple$/i))) return 'picker';
    if (has(words, /^autocut$/i)) return 'preview';             // single-photo full-screen preview
    // The camera also shows "Add sound"; its mode strip (CAMERA / PHOTO / CREATE
    // / POST) is what distinguishes it from the editor ("Your Story" + Next).
    // Camera labels, any of which may drop out of a given OCR pass on a live
    // viewfinder: mode strip (CAMERA/CREATE/POST), duration chips (PHOTO/60s/15s),
    // side tools (Timer/Ratio/Beauty). Checked before the editor because both
    // show "Add sound".
    // Bare "Create"/"Post" also appear on the profile (AI-self promo button) —
    // require a camera-only label, or the mode strip's two words together.
    if (has(words, /^(camera|photo|60s|15s)$/i) || has(words, /^(timer|ratio|beauty)$/i)
        || (has(words, /^post$/i) && has(words, /^create$/i))) return 'camera';
    if (has(words, /^story$/i) || has(words, /^sound$/i)) return 'editor';
    return 'unknown';
}

// Full-frame OCR returns nothing at all on image-heavy screens (the picker
// grid full of faces, the editor — seen live, repeatedly). The chrome that
// identifies a screen lives in the top and bottom strips, which read reliably
// when cropped and upscaled, so always merge those in.
async function screenWords(remote: WdaRemoteControl, udid: string): Promise<OcrWord[]> {
    const shot = await remote.getScreenshot(udid);
    const [full, top, bottom] = await Promise.all([
        recognizeWords(shot),
        recognizeRegionZoomed(shot, { left: 0, top: 0.04, width: 1, height: 0.12 }),
        recognizeRegionZoomed(shot, { left: 0, top: 0.86, width: 1, height: 0.12 }),
    ]);
    return [...full, ...top, ...bottom];
}

async function saveShot(remote: WdaRemoteControl, udid: string, name: string): Promise<string> {
    const file = path.resolve('.wda', `${name}-${udid}.png`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await remote.getScreenshot(udid));
    return file;
}

const ADVANCE_ATTEMPTS = 8;

// Walk picker → (preview) → editor → form by reading the screen, not by
// counting taps. A single photo opens a full-screen preview first; multiple
// photos go straight to the editor. The old fixed picker-Next/editor-Next pair
// landed one screen early and its editor-Next coordinate sits on the form's
// Post button. Verified the hard way on 2026-09-02.
async function advanceToCaptionScreen(
    driver: Browser, remote: WdaRemoteControl, udid: string, coordinates: TikTokCoordinates['tiktok'],
): Promise<void> {
    let words: OcrWord[] = [];
    let screen: PostScreen = 'unknown';
    for (let attempt = 1; attempt <= ADVANCE_ATTEMPTS; attempt += 1) {
        words = await screenWords(remote, udid);
        screen = identifyScreen(words);
        if (screen === 'form') {
            console.log('Caption form reached');
            return;
        }
        if (screen === 'picker' || screen === 'preview') {
            await tapCoordinate(driver, coordinates.pickerNext.x, coordinates.pickerNext.y, `Next on ${screen}`);
            await driver.pause(3500);
        } else if (screen === 'editor') {
            await tapCoordinate(driver, coordinates.editorNext.x, coordinates.editorNext.y, 'Next on editor');
            await driver.pause(3500);
        } else {
            // Transition still rendering — look again before touching anything.
            console.log(`Screen not recognised yet (step ${attempt}); waiting`);
            await driver.pause(1500);
        }
    }
    const file = await saveShot(remote, udid, 'caption-form-unreached');
    const seen = words.map((word) => word.text).join(', ') || '(nothing recognized)';
    await assistThenRecheck(remote, udid, 'advance to caption form', 'form',
        `could not reach the caption form after ${ADVANCE_ATTEMPTS} steps (last screen: ${screen})`, file, seen);
    console.log('Caption form reached (after operator assist)');
}

// Ask the operator for help and wait. After a resume the caller re-reads the
// screen; the operator is expected to have put the phone on `expected`.
async function assistThenRecheck(
    remote: WdaRemoteControl, udid: string, step: string, expected: PostScreen | 'any', reason: string, file: string, seen: string,
): Promise<OcrWord[]> {
    await awaitAssist({ udid, step, reason: `${reason} — please bring TikTok to the ${expected} screen and resume`, screenshotPath: file, ocr: seen });
    const words = await screenWords(remote, udid);
    const screen = identifyScreen(words);
    if (expected !== 'any' && screen !== expected) {
        throw new Error(`${step}: after operator resume expected the ${expected} screen but saw ${screen}`);
    }
    return words;
}

async function requireScreen(remote: WdaRemoteControl, udid: string, expected: PostScreen, label: string): Promise<OcrWord[]> {
    const words = await screenWords(remote, udid);
    const screen = identifyScreen(words);
    if (screen !== expected) {
        const file = await saveShot(remote, udid, `expected-${expected}`);
        const seen = words.map((word) => word.text).join(', ') || '(nothing recognized)';
        return assistThenRecheck(remote, udid, label, expected, `expected the ${expected} screen but saw ${screen}`, file, seen);
    }
    return words;
}

async function addCaption(
    driver: Browser, remote: WdaRemoteControl, udid: string, coordinates: TikTokCoordinates['tiktok'], caption?: string,
): Promise<void> {
    if (!caption) return;
    // The description field sits mid-form on single-photo posts ("Writing a
    // long description…") and top-left on slideshows ("Add description…") —
    // two layouts, seen live. Find the word and tap it; profile point as fallback.
    const { scale } = await remote.getScreenInfo(udid);
    const shot = await remote.getScreenshot(udid);
    const formWords = await recognizeRegionZoomed(shot, { left: 0, top: 0.04, width: 1, height: 0.5 });
    const field = formWords.find((word) => /^description/i.test(word.text.trim()));
    if (field) {
        const x = Math.round((field.x + field.width / 2) / scale);
        const y = Math.round((field.y + field.height / 2) / scale);
        await tapCoordinate(driver, x, y, 'description field (OCR)');
    } else {
        await tapCoordinate(driver, coordinates.caption.x, coordinates.caption.y, 'description field (profile fallback)');
    }
    await driver.pause(1500);
    await requireScreen(remote, udid, 'captionEditor', 'Opening the description editor');
    const appiumHost = process.env.APPIUM_HOST ?? '127.0.0.1';
    const appiumPort = positiveInteger('APPIUM_PORT', 4725);
    const response = await fetch(`http://${appiumHost}:${appiumPort}/session/${driver.sessionId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [caption] }),
    });
    if (!response.ok) throw new Error(`Appium could not type the caption: ${await response.text()}`);
    await driver.pause(800);
    // Two layouts, both seen live:
    //  - full-screen text editor (single-photo form): its top-left back arrow
    //    returns to the form with the text kept; top-right there is Post.
    //  - inline keyboard on the form itself (slideshow form, "Location" row
    //    still visible above the keys): the top-left arrow here is the FORM's
    //    back and leaves it. A tap on the blank strip between the chips and
    //    the Location row drops the keyboard and keeps everything.
    const typed = await screenWords(remote, udid);
    if (has(typed, /^location$/i)) {
        await tapCoordinate(driver, 300, 330, 'blank strip (dismiss inline keyboard)');
    } else {
        await tapCoordinate(driver, coordinates.keyboardBack.x, coordinates.keyboardBack.y, 'editor back');
    }
    await driver.pause(1500);
    await requireScreen(remote, udid, 'form', 'Returning from the description editor');
    console.log('Caption added');
}

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('A post manifest path is required');
const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8')) as PostManifest;

const switchAccountName = manifest.account?.trim() || undefined;
const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === manifest.device.udid);
const coordinates = resolveDeviceCoordinates(coordinateProfile(registeredDevice), registeredDevice?.coordinates);
const tiktokCoordinates = coordinates.tiktok;
const accountSwitchCoords = {
    profileTabX: tiktokCoordinates.profileTab.x,
    profileTabY: tiktokCoordinates.profileTab.y,
    switcherTriggerX: tiktokCoordinates.accountSwitcher.x,
    switcherTriggerY: tiktokCoordinates.accountSwitcher.y,
    swipe: tiktokCoordinates.swipe,
};
// Fail fast, before unlocking or launching TikTok, if the requested account
// isn't one this device is registered for.
const allowedAccounts = switchAccountName
    ? registeredAccounts(registeredDevice)
    : [];
if (switchAccountName && !allowedAccounts.includes(switchAccountName)) {
    throw new Error(`TikTok account "${switchAccountName}" is not listed in devices.json for device ${manifest.device.udid}`);
}

const deviceRemote = new WdaRemoteControl({
    deviceUdid: manifest.device.udid,
    passcodeKeypadLayout: coordinates.passcodeKeypad,
});
console.log('Checking device lock state');
await deviceRemote.unlock(manifest.device.udid);

const assetCount = await importMedia(manifest);

const bundleId = process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically';
const capabilities: WebdriverIO.Capabilities & Record<string, unknown> = {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': manifest.device.udid,
    'appium:bundleId': bundleId, 'appium:noReset': true, 'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true, 'appium:newCommandTimeout': 180,
    'appium:waitForIdleTimeout': 0,
};
if (process.env.WDA_URL) {
    capabilities['appium:webDriverAgentUrl'] = process.env.WDA_URL;
    capabilities['appium:wdaRemotePort'] = positiveInteger('WDA_REMOTE_PORT', 8100);
}

// The composer/picker flow (up to the caption screen) is the fragile part —
// flaky picker checkboxes, transient tooltips, TikTok UI timing — so it gets
// retried with a fresh app relaunch on failure. Caption entry and the final
// Post/Drafts tap are NOT retried: retrying after that risks a duplicate
// post or draft, which is worse than a single clean failure.
const REACH_CAPTION_SCREEN_ATTEMPTS = 3;
let driver: Browser | undefined;
let reachedCaptionScreen = false;
let lastAttemptError: unknown;

for (let attempt = 1; attempt <= REACH_CAPTION_SCREEN_ATTEMPTS && !reachedCaptionScreen; attempt += 1) {
    if (attempt > 1) {
        console.log(`Retrying up to the caption screen (attempt ${attempt}/${REACH_CAPTION_SCREEN_ATTEMPTS})`);
    }
    try {
        driver = await remote({ hostname: process.env.APPIUM_HOST ?? '127.0.0.1', port: positiveInteger('APPIUM_PORT', 4725), path: '/', logLevel: 'info', connectionRetryCount: 0, connectionRetryTimeout: 180000, capabilities });
        await driver.updateSettings({ defaultActiveApplication: bundleId });
        // Cold-start TikTok so every run begins on the For You feed. Seen live:
        // ending a session leaves the phone on the iOS home screen (the Profile
        // tab coordinate then opens Apple Music from the dock), and an
        // activateApp alone resumes whatever modal TikTok was left in (a draft
        // form, a picker) where the tab bar does not exist.
        await driver.terminateApp(bundleId).catch(() => {});
        await driver.pause(2500);
        await driver.activateApp(bundleId);
        await driver.pause(6000);
        await requireTikTokInFront(driver, bundleId);
        if (switchAccountName) {
            console.log(`Switching to TikTok account "${switchAccountName}"`);
            await switchTikTokAccount(driver, deviceRemote, manifest.device.udid, switchAccountName, accountSwitchCoords);
        }
        await openComposer(driver, tiktokCoordinates, manifest.musicUrl);
        await chooseRecentMedia(driver, deviceRemote, manifest.device.udid, manifest.files.length, assetCount, tiktokCoordinates);
        reachedCaptionScreen = true;
    } catch (error) {
        lastAttemptError = error;
        console.error(`Attempt ${attempt}/${REACH_CAPTION_SCREEN_ATTEMPTS} failed before reaching the caption screen: ${error instanceof Error ? error.message : String(error)}`);
        if (driver) {
            await driver.deleteSession().catch(() => {});
            driver = undefined;
        }
    }
}

if (!reachedCaptionScreen || !driver) {
    throw lastAttemptError instanceof Error
        ? lastAttemptError
        : new Error(`Could not reach the TikTok caption screen after ${REACH_CAPTION_SCREEN_ATTEMPTS} attempts`);
}

try {
    await addCaption(driver, deviceRemote, manifest.device.udid, tiktokCoordinates, manifest.caption);
    await requireScreen(deviceRemote, manifest.device.udid, 'form', 'Before submitting');
    if (manifest.destination === 'publish') {
        await tapCoordinate(driver, tiktokCoordinates.finish.x, tiktokCoordinates.finish.y, 'Post');
        console.log('TikTok post submitted');
        // The upload to TikTok continues in the background after this tap —
        // tearing down the session too soon can interrupt it.
        await driver.pause(60_000);
    } else {
        await tapCoordinate(driver, tiktokCoordinates.draft.x, tiktokCoordinates.draft.y, 'Drafts');
        await driver.pause(3000);
        const after = identifyScreen(await screenWords(deviceRemote, manifest.device.udid));
        if (after === 'form' || after === 'captionEditor') {
            const file = await saveShot(deviceRemote, manifest.device.udid, 'draft-not-saved');
            await awaitAssist({ udid: manifest.device.udid, step: 'save draft', screenshotPath: file,
                reason: 'tapped Drafts but the post form is still open — please save the draft by hand and resume' });
            const again = identifyScreen(await screenWords(deviceRemote, manifest.device.udid));
            if (again === 'form' || again === 'captionEditor') throw new Error('Draft still not saved after operator resume');
        }
        console.log('TikTok draft saved');
    }
} finally {
    await driver.deleteSession();
}
