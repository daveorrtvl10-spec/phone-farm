import { remote, type Browser } from 'webdriverio';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchTikTokAccount, tapCoordinate } from './actions.js';
import { recognizeRegionZoomed, recognizeWords } from './ocr.js';
import { awaitAssist } from './assist.js';
import { detectEngagementControls } from './engagement-controls.js';
import { looksLikeSlideshow, slideViewingPlan } from './feed-post.js';
import { readSlidePagination, remainingSlides } from './slide-dots.js';
import { appiumProbe } from './blocker-probe.js';
import { clearBlockers } from './blockers.js';
import {
    PROFILES,
    clampToDeadline,
    decideLike,
    decideLinger,
    decideSave,
    hasTimeRemaining,
    isPersonality,
    pickWatchDurationMs,
    pickSwipe,
} from './doomscroll-profile.js';

function positiveInteger(name: string, fallback: number): number {
    const rawValue = process.env[name] ?? String(fallback);
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer; received ${rawValue}`);
    }
    return value;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
    // min may be 0 (seeding budgets default to zero) — don't route through positiveInteger.
    const rawValue = process.env[name] ?? String(fallback);
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer; received ${rawValue}`);
    if (value < min || value > max) {
        throw new Error(`${name} must be between ${min} and ${max}; received ${value}`);
    }
    return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} must be 'true' or 'false'; received ${raw}`);
}

const udid = process.env.IOS_UDID;
if (!udid) {
    throw new Error('IOS_UDID is required. Copy .env.example to .env and set the connected device UDID.');
}

const personalityRaw = process.env.DOOMSCROLL_PERSONALITY ?? 'casual';
if (!isPersonality(personalityRaw)) {
    throw new Error(`DOOMSCROLL_PERSONALITY must be one of skimmer, casual, engaged; received ${personalityRaw}`);
}
const personality = personalityRaw;
const profile = PROFILES[personality];

const durationMinutes = boundedInteger('DOOMSCROLL_DURATION_MINUTES', 5, 1, 180);
const likeEnabled = booleanEnv('DOOMSCROLL_LIKE_ENABLED', true);
const saveEnabled = booleanEnv('DOOMSCROLL_SAVE_ENABLED', true);
const switchAccountName = process.env.TIKTOK_SWITCH_ACCOUNT?.trim() || undefined;
// Warm-up seeding (see docs/WARMUP.md). Follows: tap the "+" under the creator
// avatar after a video was watched all the way through, up to a budget.
// Searches: run niche searches at spaced points in the session (needs the
// results layout measured on device before it is enabled — see seedSearch).
const followBudget = boundedInteger('DOOMSCROLL_FOLLOW_BUDGET', 0, 0, 20);
const seedTerms = (process.env.DOOMSCROLL_SEED_TERMS ?? '').split(',').map((term) => term.trim()).filter(Boolean);
const searchCount = boundedInteger('DOOMSCROLL_SEARCH_COUNT', 0, 0, 5);
const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === udid);
const coordinates = resolveDeviceCoordinates(coordinateProfile(registeredDevice), registeredDevice?.coordinates);
const tiktokCoordinates = coordinates.tiktok;
const accountSwitchCoords = {
    profileTabX: tiktokCoordinates.profileTab.x,
    profileTabY: tiktokCoordinates.profileTab.y,
    switcherTriggerX: tiktokCoordinates.accountSwitcher.x,
    switcherTriggerY: tiktokCoordinates.accountSwitcher.y,
    swipe: tiktokCoordinates.swipe,
};
// switchTikTokAccount ends on the Profile tab (it re-checks there to verify
// the switch). The scroll loop below expects the Home feed, so only
// doomscroll needs to navigate back — tiktok-post.ts's Create button works
// from any bottom-nav tab.
const { x: homeTabX, y: homeTabY } = tiktokCoordinates.homeTab;

// Fail fast, before unlocking or launching TikTok, if the requested account
// isn't one this device is registered for.
const allowedAccounts = switchAccountName
    ? registeredAccounts(registeredDevice)
    : [];
if (switchAccountName && !allowedAccounts.includes(switchAccountName)) {
    throw new Error(`TikTok account "${switchAccountName}" is not listed in devices.json for device ${udid}`);
}
let { x: likeX, y: likeY } = tiktokCoordinates.like;
let { x: saveX, y: saveY } = tiktokCoordinates.save;
const { x: swipeX, startY: swipeStartY, endY: swipeEndY, durationMs: swipeDurationMs } = tiktokCoordinates.swipe;
const wdaUrl = process.env.WDA_URL;
const tiktokBundleId = process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically';

const capabilities: WebdriverIO.Capabilities & Record<string, unknown> = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': udid,
    'appium:bundleId': tiktokBundleId,
    'appium:noReset': true,
    'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true,
    'appium:newCommandTimeout': 120,
    'appium:wdaLaunchTimeout': 120000,
    'appium:wdaConnectionTimeout': 120000,
    // TikTok's video feed never becomes fully idle. Waiting for quiescence can
    // make otherwise-completed gestures block until the WDA proxy times out.
    'appium:waitForIdleTimeout': 0,
    'appium:showXcodeLog': process.env.SHOW_XCODE_LOG === 'true',
};

if (wdaUrl) {
    capabilities['appium:webDriverAgentUrl'] = wdaUrl;
    capabilities['appium:wdaRemotePort'] = positiveInteger('WDA_REMOTE_PORT', 8100);
} else if (process.env.XCODE_ORG_ID) {
    capabilities['appium:xcodeOrgId'] = process.env.XCODE_ORG_ID;
    capabilities['appium:xcodeSigningId'] = process.env.XCODE_SIGNING_ID ?? 'Apple Development';
}
if (!wdaUrl && process.env.WDA_BUNDLE_ID) {
    capabilities['appium:updatedWDABundleId'] = process.env.WDA_BUNDLE_ID;
}
if (!wdaUrl && process.env.ALLOW_PROVISIONING_DEVICE_REGISTRATION === 'true') {
    capabilities['appium:allowProvisioningDeviceRegistration'] = true;
}
if (!wdaUrl && process.env.WDA_BOOTSTRAP_PATH) {
    capabilities['appium:useXctestrunFile'] = true;
    capabilities['appium:bootstrapPath'] = process.env.WDA_BOOTSTRAP_PATH;
}

// Cooperative cancellation: a Stop request sends SIGTERM (see
// src/automations/runner.ts). Every wait below races against stopPromise so
// a stop interrupts immediately instead of waiting out the current sleep.
let stopRequested = false;
let resolveStop: () => void = () => {};
const stopPromise = new Promise<void>((resolve) => { resolveStop = resolve; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        stopRequested = true;
        resolveStop();
    });
}

function cancellableDelay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        void stopPromise.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function interactionPauseMs(): number {
    return Math.round(200 + Math.random() * 400);
}

let driver: Browser | undefined;
let videosViewed = 0;
let swipes = 0;
let likes = 0;
let saves = 0;
let follows = 0;
let searches = 0;
let slideshows = 0;
let slidesViewed = 0;
const runStartedAt = Date.now();

console.log(`Starting doomscroll: profile=${personality} requestedDurationMinutes=${durationMinutes} likeEnabled=${likeEnabled} saveEnabled=${saveEnabled}`);

const remoteControl = new WdaRemoteControl({
    deviceUdid: udid,
    wdaUrl,
    passcodeKeypadLayout: coordinates.passcodeKeypad,
});
try {
    console.log('Checking device lock state');
    await remoteControl.unlock(udid);

    console.log(`Opening TikTok on ${udid}`);
    driver = await remote({
        hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
        port: positiveInteger('APPIUM_PORT', 4725),
        path: '/',
        logLevel: 'info',
        connectionRetryCount: 0,
        connectionRetryTimeout: 180000,
        capabilities,
    });

    await driver.updateSettings({ defaultActiveApplication: tiktokBundleId });
    // Cold start: see post.ts — a resumed TikTok may be inside a modal with no
    // tab bar, and a torn-down session leaves the phone on the home screen.
    await driver.terminateApp(tiktokBundleId).catch(() => {});
    await driver.pause(1000);
    await driver.activateApp(tiktokBundleId);
    await driver.pause(5000);

    // A dialog in front of the app swallows every gesture underneath it, so the
    // run scrolls a screen that never moves while the logs look healthy. Clear
    // what is in the way before measuring or tapping anything.
    const blockerProbe = appiumProbe(driver);
    const openingBlockers = await clearBlockers(blockerProbe, 'defer').catch((error: unknown) => {
        console.log(`Blocker check failed at open: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    });
    for (const blocker of openingBlockers) {
        console.log(`Blocker at open: ${blocker.kind} ${blocker.text ?? ''} -> ${blocker.pressed ?? 'left alone'}`);
    }
    // Log what the hierarchy actually exposes, so "no blockers" is
    // distinguishable from "the probe saw nothing at all" in a later postmortem.
    const visibleControls = await blockerProbe.buttons().catch(() => []);
    console.log(`Controls visible at open (${visibleControls.length}): ${visibleControls.map((control) => control.label).join(' | ').slice(0, 200)}`);

    if (switchAccountName) {
        console.log(`Switching to TikTok account "${switchAccountName}"`);
        await switchTikTokAccount(driver, remoteControl, udid, switchAccountName, accountSwitchCoords);
        // switchTikTokAccount leaves the app on the Profile tab; the loop
        // below expects the Home feed.
        await tapCoordinate(driver, homeTabX, homeTabY, 'Home tab');
        await driver.pause(1500);
    }

    try {
        const [screenshot, screen] = await Promise.all([
            remoteControl.getScreenshot(udid),
            remoteControl.getScreenInfo(udid),
        ]);
        const detected = await detectEngagementControls(screenshot, screen.scale, saveY - likeY);
        if (detected) {
            ({ x: likeX, y: likeY } = detected.like);
            ({ x: saveX, y: saveY } = detected.save);
            console.log(`Detected TikTok engagement controls: like=(${likeX}, ${likeY}) save=(${saveX}, ${saveY}) confidence=${detected.confidence.toFixed(3)}`);
        } else {
            console.log(`Could not confidently detect TikTok engagement controls; using ${coordinateProfile(registeredDevice)} profile coordinates`);
        }
    } catch (error) {
        console.log(`Engagement control detection failed; using profile coordinates: ${error instanceof Error ? error.message : String(error)}`);
    }

    // The silent failure mode (seen live on both phones, 2026-09-02): a tap lands
    // on a creator's profile or a message composer and the loop keeps "liking"
    // and swiping there for minutes. Every few videos, and after any tap that can
    // navigate, prove we're still on the feed; otherwise back out or ask.
    async function onFeed(): Promise<{ ok: boolean; seen: string }> {
        const shot = await remoteControl.getScreenshot(udid as string);
        const [full, bottom] = await Promise.all([
            recognizeWords(shot),
            recognizeRegionZoomed(shot, { left: 0, top: 0.86, width: 1, height: 0.12 }),
        ]);
        const words = [...full, ...bottom].map((word) => word.text.trim().toLowerCase());
        const tabs = ['home', 'friends', 'inbox', 'profile'].filter((tab) => words.includes(tab)).length;
        // A real iOS keyboard renders the whole top row. Garbled OCR of a video
        // frame throws off stray single letters — 'q r t b a' from a feed frame
        // paused a healthy run on 2026-09-03 — so require most of the row.
        const keyboard = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'].filter((key) => words.includes(key)).length >= 7;
        const composer = words.some((word) => /^(message|send|comment)$/.test(word));
        const profilePage = words.includes('following') && words.includes('followers');
        return { ok: tabs >= 2 && !keyboard && !composer && !profilePage, seen: words.slice(0, 40).join(' ') };
    }
    async function ensureFeed(context: string): Promise<void> {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const { ok, seen } = await onFeed();
            if (ok) return;
            console.log(`Not on the feed after ${context} (attempt ${attempt}). OCR: ${seen.slice(0, 120)}`);
            // Ask the view hierarchy before touching coordinates. A dialog or an
            // in-feed promo reads as "off the feed" to OCR, and pressing it by
            // label clears it without guessing where its buttons are.
            const cleared = await clearBlockers(blockerProbe, 'defer').catch(() => []);
            for (const blocker of cleared) {
                console.log(`Blocker during ${context}: ${blocker.kind} ${blocker.text ?? ''} -> ${blocker.pressed ?? 'left alone'}`);
            }
            if (cleared.some((blocker) => blocker.kind === 'alert' || blocker.kind === 'overlay')) {
                await driver!.pause(1200);
                if ((await onFeed()).ok) return;
            }
            // First question: is TikTok even in front? Seen live: TikTok crashed to
            // Springboard mid-session and the "Home tab" coordinate opened the
            // Phone app from the dock. Never tap TikTok coordinates blind.
            const state = await driver!.queryAppState(tiktokBundleId);
            if (state !== 4) {
                console.log(`TikTok app state ${state}; relaunching`);
                await driver!.activateApp(tiktokBundleId);
                await driver!.pause(6000);
                continue;
            }
            // In TikTok but off the feed: back (<) first — it is the safe universal
            // exit (search, results, profiles, sheets). Only touch the tab bar when
            // the tab labels are actually visible; with a keyboard up that
            // coordinate is a key.
            await tapCoordinate(driver!, 22, 66, 'back (<)');
            await driver!.pause(1200);
            const after = await onFeed();
            if (after.ok) return;
            if (/\b(home|friends|inbox|profile)\b/.test(after.seen)) {
                await tapCoordinate(driver!, homeTabX, homeTabY, 'Home tab');
                await driver!.pause(1500);
            } else {
                await tapCoordinate(driver!, 384, 66, 'close (X)');
                await driver!.pause(900);
            }
        }
        const { ok, seen } = await onFeed();
        if (ok) return;
        await awaitAssist({ udid: udid as string, step: 'return to feed', reason: `left the For You feed after ${context} and could not get back — please open the For You feed and resume`, ocr: seen });
        const again = await onFeed();
        if (!again.ok) throw new Error('Still not on the feed after operator resume');
    }
    let sinceFeedCheck = 0;

    // Nobody scrolls for exactly the booked minutes: ±20% per session.
    const jitteredMinutes = durationMinutes * (0.8 + Math.random() * 0.4);
    console.log(`Session length ${jitteredMinutes.toFixed(1)} min (booked ${durationMinutes})`);
    const deadline = Date.now() + jitteredMinutes * 60_000;
    const sessionStart = Date.now();
    const seedOffset = Math.floor(Math.random() * Math.max(1, seedTerms.length));
    let followedLast = false;

    // Search seeding: search icon → type → keyboard Search → results. The
    // results grid has NOT been measured on device yet, so this only opens the
    // search, types, and returns to the feed; the watch-through of results is
    // gated behind DOOMSCROLL_SEARCH_RESULT_Y (set once measured).
    async function seedSearch(term: string): Promise<void> {
        const search = tiktokCoordinates.search;
        if (!search) { console.log('No search coordinates in profile; skipping seeding'); return; }
        await tapCoordinate(driver!, search.icon.x, search.icon.y, 'Search icon');
        await driver!.pause(2000);
        const response = await fetch(`http://${process.env.APPIUM_HOST ?? '127.0.0.1'}:${process.env.APPIUM_PORT ?? '4725'}/session/${driver!.sessionId}/keys`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: [term] }),
        });
        if (!response.ok) throw new Error(`Appium could not type the search term: ${await response.text()}`);
        await driver!.pause(800);
        await tapCoordinate(driver!, search.submit.x, search.submit.y, 'keyboard Search');
        await driver!.pause(3500);
        console.log(`Seeded search "${term}"`);
        const resultY = Number(process.env.DOOMSCROLL_SEARCH_RESULT_Y ?? 0);
        if (resultY > 0) {
            await tapCoordinate(driver!, search.firstResult.x, resultY, 'first result');
            await driver!.pause(1500);
            // Watch a handful of results like the feed, then come back.
            for (let i = 0; i < 4 && !stopRequested && hasTimeRemaining(Date.now(), deadline); i += 1) {
                await cancellableDelay(clampToDeadline(Date.now(), deadline, pickWatchDurationMs(profile) + 3000));
                const resultFlick = pickSwipe({ startY: swipeStartY, endY: swipeEndY, durationMs: swipeDurationMs });
                await driver!.performActions([{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [
                    { type: 'pointerMove', duration: 0, x: swipeX, y: resultFlick.startY }, { type: 'pointerDown', button: 0 },
                    { type: 'pointerMove', duration: resultFlick.durationMs, x: swipeX, y: resultFlick.endY }, { type: 'pointerUp', button: 0 } ] }]);
                await driver!.releaseActions();
            }
            await tapCoordinate(driver!, search.back.x, search.back.y, 'back from results');
            await driver!.pause(1200);
        }
        // Return to the feed by reading the screen, not by counting taps: results →
        // search screen → feed can take one to three backs, and with the keyboard
        // up the Home-tab coordinate lands on the emoji key (seen live 2026-09-03).
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            const { ok } = await onFeed();
            if (ok) { console.log('Back on the feed after search'); return; }
            await tapCoordinate(driver!, search.back.x, search.back.y, `back (${attempt})`);
            await driver!.pause(1500);
        }
        await ensureFeed('a seeded search');
    }

    while (!stopRequested && hasTimeRemaining(Date.now(), deadline)) {
        await cancellableDelay(clampToDeadline(Date.now(), deadline, pickWatchDurationMs(profile)));
        videosViewed += 1;
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        // Photo slideshows want swiping THROUGH, not past. Sitting on slide one and
        // flicking up is a distinctive non-human pattern (Josh spotted it live on
        // 2026-09-04), and slideshows are exactly what this farm posts. The caption
        // row is OCR'd on a fraction of posts to keep the cost down; a horizontal
        // swipe is only ever sent once "Photo" is actually seen, because on a video
        // that same gesture opens the creator's profile.
        if (Math.random() < 0.5) {
            try {
                const band = await recognizeRegionZoomed(
                    await remoteControl.getScreenshot(udid), { left: 0, top: 0.74, width: 1, height: 0.12 },
                );
                if (looksLikeSlideshow(band)) {
                    const plan = slideViewingPlan(Math.random);
                    slideshows += 1;
                    let swipedSlides = 0;
                    for (const dwell of plan.dwellMs) {
                        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
                        await cancellableDelay(clampToDeadline(Date.now(), deadline, dwell));
                        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
                        // One swipe past the last slide opens the creator's profile,
                        // and the run then engages there instead of on the feed — the
                        // off-feed drift seen on 2026-09-04. The dots say how many
                        // slides are actually left; when they cannot be read, stay put.
                        const pagination = await readSlidePagination(
                            await remoteControl.getScreenshot(udid),
                        ).catch(() => null);
                        if (remainingSlides(pagination) <= 0) {
                            console.log(
                                pagination
                                    ? `Last of ${pagination.total} slides; not swiping past it`
                                    : 'Could not read the slide dots; not swiping sideways',
                            );
                            break;
                        }
                        await driver.performActions([{
                            type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' },
                            actions: [
                                { type: 'pointerMove', duration: 0, x: 330, y: 430 },
                                { type: 'pointerDown', button: 0 },
                                { type: 'pointerMove', duration: 260, x: 90, y: 430 },
                                { type: 'pointerUp', button: 0 },
                            ],
                        }]);
                        await driver.releaseActions();
                        slidesViewed += 1;
                        swipedSlides += 1;
                    }
                    console.log(`Swiped through ${swipedSlides} slides of a photo post (planned up to ${plan.slides})`);
                    await ensureFeed('a slideshow');
                }
            } catch (error) {
                console.log(`Slideshow check skipped: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        if (likeEnabled && decideLike(profile)) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
            // Single tap on the heart button. A double tap here toggles the like
            // straight back off (verified on device 2026-09-02: 0 likes after a run).
            await tapCoordinate(driver, likeX, likeY, 'Like');
            likes += 1;
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        if (saveEnabled && decideSave(profile)) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
            await tapCoordinate(driver, saveX, saveY, 'Save');
            saves += 1;
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        const { linger, extraMs } = decideLinger(profile);
        if (linger) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, extraMs));
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        // A creator whose video was watched through is the natural follow. The
        // "+" sits 69pt above the heart on this layout (measured 2026-09-02);
        // never on the first three videos of a session, never twice in a row.
        if (linger && follows < followBudget && videosViewed > 3 && Math.random() < 0.5 && !followedLast) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
            await tapCoordinate(driver, likeX, likeY - 69, 'Follow');
            follows += 1;
            followedLast = true;
            await driver.pause(1200);
            await ensureFeed('a follow tap');
        } else {
            followedLast = false;
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        // Niche search seeding at spaced points in the session.
        if (searches < Math.min(searchCount, seedTerms.length)) {
            const due = Date.now() >= sessionStart + ((searches + 1) * (durationMinutes * 60_000)) / (Math.min(searchCount, seedTerms.length) + 1);
            if (due) {
                const term = seedTerms[(searches + seedOffset) % seedTerms.length]!;
                await seedSearch(term);
                searches += 1;
            }
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        // Coordinate actions bypass XCTest's expensive application-element
        // lookup, which can hang on TikTok's continuously updating feed.
        // Every flick is jittered: one fixed vector repeated is a signature.
        const flick = pickSwipe({ startY: swipeStartY, endY: swipeEndY, durationMs: swipeDurationMs });
        await driver.performActions([{
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x: swipeX, y: flick.startY },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 60 + Math.round(Math.random() * 90) },
                { type: 'pointerMove', duration: flick.durationMs, x: swipeX, y: flick.endY },
                { type: 'pointerUp', button: 0 },
            ],
        }]);
        await driver.releaseActions();
        swipes += 1;
        sinceFeedCheck += 1;
        if (sinceFeedCheck >= 6) {
            sinceFeedCheck = 0;
            await ensureFeed('scrolling');
        }
    }

    const elapsedMs = Date.now() - runStartedAt;
    const reason = stopRequested ? 'stopped' : 'completed';
    console.log(`Finished doomscroll: videosViewed=${videosViewed} swipes=${swipes} likes=${likes} saves=${saves} follows=${follows} searches=${searches} slideshows=${slideshows} slides=${slidesViewed} elapsedMs=${elapsedMs} reason=${reason}`);
} finally {
    if (driver) {
        // A person puts the phone down when they stop scrolling; don't leave
        // TikTok parked on the last video for minutes (seen live by Josh).
        await remoteControl.performAction(udid, { type: 'home' }).catch((error: unknown) => {
            console.log(`Could not press Home at session end: ${error instanceof Error ? error.message : String(error)}`);
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        // …and the screen goes dark, like a phone that was put down. No passcode,
        // so the next session's unlock is a wake + swipe.
        await remoteControl.performAction(udid, { type: 'lock' }).catch((error: unknown) => {
            console.log(`Could not lock at session end: ${error instanceof Error ? error.message : String(error)}`);
        });
        console.log('Session ended: Home + lock');
        await driver.deleteSession();
    }
}
