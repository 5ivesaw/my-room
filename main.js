import * as THREE from 'three';
import { createWorld } from './world.js?v=68';
import { Player } from './player.js?v=65';
import { InteractionSystem } from './interactions.js?v=53';
import { sounds } from './sounds.js?v=49';
import { startKingdomPresence } from './kingdom-presence.js?v=2';

const SETTINGS_KEY = 'my-room.settings.v1';
const LOCKED_FOV = 72;
const QUALITY_PROFILES = {
    // Motion-aware resolution: movement stays light on older iGPUs, while the
    // renderer sharpens itself after the camera rests so signs and fine details
    // do not remain permanently smeared.
    performance: { movingPixelRatio: 0.52, idlePixelRatio: 0.74, minPixelRatio: 0.38 },
    balanced: { movingPixelRatio: 0.68, idlePixelRatio: 0.90, minPixelRatio: 0.48 },
    quality: { movingPixelRatio: 0.82, idlePixelRatio: 1.00, minPixelRatio: 0.62 }
};
const DEFAULT_SETTINGS = {
    quality: 'performance',
    drawDistance: 18,
    pcPreview: 'still',
    fov: LOCKED_FOV,
    reducedMotion: false
};

function sanitizeSettings(raw = {}) {
    const next = { ...DEFAULT_SETTINGS, ...raw };
    if (!QUALITY_PROFILES[next.quality]) next.quality = DEFAULT_SETTINGS.quality;
    if (![12, 18, 28].includes(Number(next.drawDistance))) next.drawDistance = DEFAULT_SETTINGS.drawDistance;
    else next.drawDistance = Number(next.drawDistance);
    if (!['still', 'slow', 'normal'].includes(next.pcPreview)) next.pcPreview = DEFAULT_SETTINGS.pcPreview;
    next.fov = LOCKED_FOV;
    next.reducedMotion = next.reducedMotion === true;
    return next;
}

function loadSettings() {
    try {
        return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Settings are optional; private browsing should not break the room.
    }
}

const settings = loadSettings();

// Setup Renderer
const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    precision: 'mediump',
    powerPreference: 'high-performance'
});
const gameContainer = document.getElementById('game-container');

function getViewportSize() {
    const rect = gameContainer?.getBoundingClientRect();
    const visual = window.visualViewport;
    const root = document.documentElement;
    return {
        width: Math.max(1, Math.round(rect?.width || visual?.width || root.clientWidth || window.innerWidth || 1)),
        height: Math.max(1, Math.round(rect?.height || visual?.height || root.clientHeight || window.innerHeight || 1))
    };
}

const initialViewport = getViewportSize();
renderer.setSize(initialViewport.width, initialViewport.height, false);
renderer.domElement.setAttribute('aria-label', 'Interactive kingdom view');
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
renderer.sortObjects = false;

let activePixelRatio = QUALITY_PROFILES[settings.quality].movingPixelRatio;
let adaptiveFrameMs = 16.7;
let adaptiveTimer = 0;
let adaptiveCooldown = 0;

let lastRenderMotionAt = performance.now();
const markRenderMotion = () => { lastRenderMotionAt = performance.now(); };
window.addEventListener('pointermove', markRenderMotion, { passive: true });
window.addEventListener('touchmove', markRenderMotion, { passive: true });
window.addEventListener('keydown', markRenderMotion, { passive: true });
window.addEventListener('wheel', markRenderMotion, { passive: true });

function targetPixelRatio() {
    const profile = QUALITY_PROFILES[settings.quality] || QUALITY_PROFILES.performance;
    const cameraIsResting = performance.now() - lastRenderMotionAt > 420;
    const desired = cameraIsResting ? profile.idlePixelRatio : profile.movingPixelRatio;
    return Math.min(window.devicePixelRatio || 1, desired);
}

function applyRenderScale(nextRatio = targetPixelRatio()) {
    const profile = QUALITY_PROFILES[settings.quality] || QUALITY_PROFILES.performance;
    activePixelRatio = Math.max(profile.minPixelRatio, Math.min(targetPixelRatio(), nextRatio));
    renderer.setPixelRatio(activePixelRatio);
    const viewport = getViewportSize();
    renderer.setSize(viewport.width, viewport.height, false);
}

function updateAdaptiveResolution(dt) {
    adaptiveFrameMs += ((dt * 1000) - adaptiveFrameMs) * 0.045;
    adaptiveTimer += dt;
    adaptiveCooldown = Math.max(0, adaptiveCooldown - dt);
    if (adaptiveTimer < 1.0 || adaptiveCooldown > 0) return;
    adaptiveTimer = 0;

    const profile = QUALITY_PROFILES[settings.quality] || QUALITY_PROFILES.performance;
    const maxRatio = targetPixelRatio();
    let next = activePixelRatio;
    if (activePixelRatio > maxRatio + 0.01) {
        // Drop immediately when movement resumes; this is where responsiveness matters.
        next = maxRatio;
    } else if (adaptiveFrameMs > 20.5 && activePixelRatio > profile.minPixelRatio + 0.01) {
        next = Math.max(profile.minPixelRatio, activePixelRatio - 0.10);
    } else if (adaptiveFrameMs < 17.4 && activePixelRatio < maxRatio - 0.01) {
        // Sharpen more quickly once the camera is still.
        next = Math.min(maxRatio, activePixelRatio + 0.055);
    }
    if (Math.abs(next - activePixelRatio) >= 0.01) {
        applyRenderScale(next);
        adaptiveCooldown = 2.4;
    }
}

applyRenderScale();
// Keep the WebGL surface physically below every HTML interface layer.
// Appending it after #ui-layer lets the canvas win the browser stacking order
// on some desktop/mobile engines, making the rendered room cover and intercept
// the launch menu.
const uiLayer = document.getElementById('ui-layer');
if (uiLayer) {
    gameContainer.insertBefore(renderer.domElement, uiLayer);
} else {
    gameContainer.prepend(renderer.domElement);
}

// Setup Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.05);

const camera = new THREE.PerspectiveCamera(settings.fov, initialViewport.width / initialViewport.height, 0.1, settings.drawDistance);
const cullFrustum = new THREE.Frustum();
const cullMatrix = new THREE.Matrix4();
const cullSphere = new THREE.Sphere();
const cullCenter = new THREE.Vector3();
const cameraWorldPos = new THREE.Vector3();
let cullTimer = 0;
let interactionTimer = 0;
let worldUpdateAccumulator = 0;

function applyCameraSettings() {
    camera.fov = settings.fov;
    camera.far = settings.drawDistance;
    camera.updateProjectionMatrix();
    scene.fog.density = settings.drawDistance <= 12 ? 0.08 : settings.drawDistance <= 18 ? 0.06 : 0.045;
}

applyCameraSettings();

// UI Elements
const startScreen = document.getElementById('start-screen');
const enterBtn = document.getElementById('enter-btn');
const qualitySelect = document.getElementById('graphics-quality');
const drawDistanceSelect = document.getElementById('draw-distance');
const pcPreviewSelect = document.getElementById('pc-preview');
const reducedMotionInput = document.getElementById('reduced-motion');
const hud = document.getElementById('hud');
const fadeOverlay = document.getElementById('fade-overlay');
const messageOverlay = document.getElementById('message-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const mobileControls = document.getElementById('mobile-controls');
const mobileStick = document.getElementById('mobile-stick');
const mobileStickKnob = document.getElementById('mobile-stick-knob');
const mobileLookZone = document.querySelector('.mobile-look-zone');
const mobileInteractBtn = document.getElementById('mobile-interact');
const mobileSecondaryBtn = document.getElementById('mobile-secondary');
const mobileFullscreenBtn = document.getElementById('mobile-fullscreen');
const mobilePiano = document.getElementById('mobile-piano');
const audiencePanel = document.getElementById('audience-panel');
const audienceClose = document.getElementById('audience-close');
const audienceStatus = document.getElementById('audience-status');
const audienceDecree = document.getElementById('audience-decree');
const audienceForm = document.getElementById('audience-form');
const audienceMessage = document.getElementById('audience-message');
const audienceFile = document.getElementById('audience-file');
const audienceSend = document.getElementById('audience-send');
const audienceFormNote = document.getElementById('audience-form-note');
const royalMailToggle = document.getElementById('royal-mail-toggle');
const royalMailPanel = document.getElementById('royal-mail-panel');
const royalMailClose = document.getElementById('royal-mail-close');
const royalMailCount = document.getElementById('royal-mail-count');
const royalMailList = document.getElementById('royal-mail-list');
const visitorDisplayNameInput = document.getElementById('visitor-display-name');
const visitorCodeEl = document.getElementById('visitor-code');
const copyVisitorCodeBtn = document.getElementById('copy-visitor-code');
const openVeilChatBtn = document.getElementById('open-veil-chat');
const AUDIENCE_QUEUE_KEY = 'my-room.audiencePetitions.v1';
const AUDIENCE_LAST_SENT_KEY = 'my-room.audiencePetition.lastSentAt';
const AUDIENCE_COOLDOWN_MS = 60000;
const AUDIENCE_MAX_FILE_BYTES = 480000;
let currentPresence = { status: 'offline', online: false, message: '' };
let audienceSubmitBusy = false;
let audienceFirebasePromise = null;
let visitorIdentity = { uid: '', code: '', displayName: '', messages: [] };
let stopRoyalMail = null;
let royalMailHeartbeat = null;
let royalMailExpiryTimer = null;
const VISITOR_NAME_KEY = 'veil.displayName.v1';
const VISITOR_AVATAR_KEY = 'veil.avatar.v1';
const LORD_MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function applyKingdomPresence(presence = {}) {
    const online = presence.online === true;
    const status = String(presence.status || 'offline');
    currentPresence = { ...presence, online, status };
    audiencePanel?.classList.toggle('online', online);
    if (audienceStatus) audienceStatus.textContent = status;
    if (audienceDecree) audienceDecree.textContent = presence.message || (online ? 'My Lord is watching from the throne.' : 'The bone throne keeps watch in my Lord\'s absence.');
    worldData?.setKingPresence?.(presence);
}

async function fileToAudienceAttachment(file) {
    if (!file) return null;
    if (file.size > AUDIENCE_MAX_FILE_BYTES) {
        throw new Error('That offering is too large for the throne. Keep it under 480 KB.');
    }
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('The offering could not be read.'));
        reader.readAsDataURL(file);
    });
    return {
        name: String(file.name || 'offering').slice(0, 80),
        type: String(file.type || 'application/octet-stream').slice(0, 80),
        size: file.size,
        dataUrl
    };
}

function rememberLocalPetition(payload) {
    try {
        const queue = JSON.parse(localStorage.getItem(AUDIENCE_QUEUE_KEY) || '[]');
        queue.unshift(payload);
        localStorage.setItem(AUDIENCE_QUEUE_KEY, JSON.stringify(queue.slice(0, 25)));
    } catch {
        // Local petition storage is best effort.
    }
}

async function getAudienceFirebase() {
    if (audienceFirebasePromise) return audienceFirebasePromise;
    audienceFirebasePromise = (async () => {
        const config = window.VEIL_FIREBASE_CONFIG;
        if (!config?.apiKey) throw new Error('Firebase audience is not configured.');
        const [
            { initializeApp, getApps },
            { getAuth, signInAnonymously, setPersistence, browserLocalPersistence },
            {
                getFirestore,
                collection,
                addDoc,
                setDoc,
                doc,
                onSnapshot,
                query,
                orderBy,
                limit,
                serverTimestamp,
                deleteDoc
            }
        ] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
            import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
        ]);
        const app = getApps().length ? getApps()[0] : initializeApp(config);
        const auth = getAuth(app);
        await setPersistence(auth, browserLocalPersistence).catch(() => {});
        if (!auth.currentUser) await signInAnonymously(auth);
        return {
            auth,
            db: getFirestore(app),
            collection,
            addDoc,
            setDoc,
            doc,
            onSnapshot,
            query,
            orderBy,
            limit,
            serverTimestamp,
            deleteDoc
        };
    })();
    return audienceFirebasePromise;
}

function escapeRoyalHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function normalizeVisitorName(value, uid = '') {
    const cleaned = String(value || '')
        .replace(/[^A-Za-z0-9 _.-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 24);
    if (cleaned.length >= 2) return cleaned;
    const suffix = String(uid || '0000').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || '0000';
    return `Friend-${suffix}`;
}

function activeLordMessages() {
    const now = Date.now();
    return visitorIdentity.messages.filter((message) => {
        const expiresMs = Number(message.expiresMs || 0);
        return expiresMs > now && expiresMs - Number(message.createdMs || 0) <= LORD_MESSAGE_MAX_AGE_MS;
    });
}

function renderRoyalMail() {
    const active = activeLordMessages();
    if (royalMailCount) royalMailCount.textContent = String(active.length);
    royalMailToggle?.classList.toggle('has-mail', active.length > 0);
    if (!royalMailList) return;
    if (!active.length) {
        royalMailList.innerHTML = '<p class="royal-empty">No active message from the throne.</p>';
        return;
    }
    const now = Date.now();
    royalMailList.innerHTML = active.map((message) => {
        const remainingSeconds = Math.max(1, Math.ceil((Number(message.expiresMs) - now) / 1000));
        const preview = String(message.text || '').slice(0, 180);
        return `<article class="royal-message">
            <time>From the sovereign</time>
            <p>${escapeRoyalHtml(preview)}${String(message.text || '').length > 180 ? '…' : ''}</p>
            <small>Disappears in ${remainingSeconds}s. Open Veil Chat for the full audience.</small>
        </article>`;
    }).join('');
}

async function syncVisitorProfile() {
    const firebase = await getAudienceFirebase();
    const uid = firebase.auth.currentUser?.uid;
    if (!uid) return;
    const displayName = normalizeVisitorName(
        visitorDisplayNameInput?.value || localStorage.getItem(VISITOR_NAME_KEY),
        uid
    );
    const avatar = String(localStorage.getItem(VISITOR_AVATAR_KEY) || '0'.repeat(64)).replace(/[^0-7]/g, '').slice(0, 64).padEnd(64, '0');
    visitorIdentity.uid = uid;
    visitorIdentity.code = uid;
    visitorIdentity.displayName = displayName;
    localStorage.setItem(VISITOR_NAME_KEY, displayName);
    if (visitorDisplayNameInput) visitorDisplayNameInput.value = displayName;
    if (visitorCodeEl) visitorCodeEl.textContent = uid;
    await firebase.setDoc(firebase.doc(firebase.db, 'users', uid), {
        uid,
        publicCode: uid,
        displayName,
        avatar,
        lastSeenMs: Date.now(),
        lastSeenAt: firebase.serverTimestamp()
    }, { merge: true });
}

async function startRoyalMail() {
    try {
        const firebase = await getAudienceFirebase();
        await syncVisitorProfile();
        royalMailToggle?.classList.remove('hidden');

        if (stopRoyalMail) stopRoyalMail();
        const messageQuery = firebase.query(
            firebase.collection(firebase.db, 'users', visitorIdentity.uid, 'lordMessages'),
            firebase.orderBy('createdMs', 'desc'),
            firebase.limit(12)
        );
        let firstSnapshot = true;
        stopRoyalMail = firebase.onSnapshot(messageQuery, (snapshot) => {
            const now = Date.now();
            visitorIdentity.messages = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
            for (const message of visitorIdentity.messages) {
                if (Number(message.expiresMs || 0) <= now) {
                    firebase.deleteDoc(firebase.doc(firebase.db, 'users', visitorIdentity.uid, 'lordMessages', message.id)).catch(() => {});
                }
            }
            renderRoyalMail();
            if (!firstSnapshot) {
                const newest = snapshot.docChanges().find((change) => change.type === 'added')?.doc?.data();
                if (newest && Number(newest.expiresMs || 0) > now) {
                    showMessage('A temporary message from the sovereign arrived in Royal Mail.');
                    royalMailToggle?.classList.remove('hidden');
                }
            }
            firstSnapshot = false;
        }, (error) => {
            console.warn('Royal Mail unavailable:', error.message);
        });

        clearInterval(royalMailHeartbeat);
        royalMailHeartbeat = setInterval(() => syncVisitorProfile().catch(() => {}), 30000);
        clearInterval(royalMailExpiryTimer);
        royalMailExpiryTimer = setInterval(renderRoyalMail, 1000);
    } catch (error) {
        console.warn('Visitor identity unavailable:', error.message);
    }
}

async function sendRemotePetition(payload) {
    const { auth, db, collection, addDoc, serverTimestamp } = await getAudienceFirebase();
    await addDoc(collection(db, 'kingdom', 'audienceMessages', 'items'), {
        text: payload.text,
        attachment: payload.attachment ? {
            name: payload.attachment.name,
            type: payload.attachment.type,
            size: payload.attachment.size,
            dataUrl: payload.attachment.dataUrl
        } : null,
        statusAtSubmission: payload.statusAtSubmission,
        senderUid: auth.currentUser?.uid || 'anonymous',
        displayName: normalizeVisitorName(visitorIdentity.displayName, auth.currentUser?.uid || ''),
        publicCode: auth.currentUser?.uid || '',
        createdAt: serverTimestamp(),
        createdMs: Date.now()
    });
}

async function submitAudiencePetition(event) {
    event.preventDefault();
    if (audienceSubmitBusy) return;
    const now = Date.now();
    const lastSent = Number(localStorage.getItem(AUDIENCE_LAST_SENT_KEY) || 0);
    const remaining = AUDIENCE_COOLDOWN_MS - (now - lastSent);
    if (remaining > 0) {
        showMessage(`The throne accepts one petition every ${Math.ceil(remaining / 1000)} seconds.`);
        return;
    }

    const rawText = String(audienceMessage?.value || '').trim();
    if (!rawText) return;
    const text = /^my lord\b/i.test(rawText) ? rawText.slice(0, 900) : `My Lord, ${rawText}`.slice(0, 900);
    audienceSubmitBusy = true;
    if (audienceSend) audienceSend.disabled = true;
    if (audienceFormNote) audienceFormNote.textContent = 'Sealing petition...';

    try {
        const attachment = await fileToAudienceAttachment(audienceFile?.files?.[0] || null);
        const payload = {
            text,
            attachment,
            statusAtSubmission: currentPresence.status || 'offline',
            createdAt: new Date().toISOString()
        };
        rememberLocalPetition(payload);
        try {
            await sendRemotePetition(payload);
        } catch (error) {
            console.warn('Audience petition saved locally; remote delivery unavailable.', error);
        }
        localStorage.setItem(AUDIENCE_LAST_SENT_KEY, String(now));
        audienceForm?.reset();
        if (audienceFormNote) audienceFormNote.textContent = 'Petition sealed inside the audience chamber.';
        showMessage('Your petition has been placed before the throne.');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The petition failed.';
        if (audienceFormNote) audienceFormNote.textContent = message;
        showMessage(message);
    } finally {
        audienceSubmitBusy = false;
        if (audienceSend) audienceSend.disabled = false;
    }
}

function openAudiencePanel() {
    audiencePanel?.classList.remove('hidden');
    document.body.classList.add('audience-open');
    if (!mobileInput.enabled && document.pointerLockElement) document.exitPointerLock?.();
}

function closeAudiencePanel() {
    audiencePanel?.classList.add('hidden');
    document.body.classList.remove('audience-open');
    if (interactions) interactions.disableE = false;
    if (hasStarted) requestControlLock();
}

audienceClose?.addEventListener('click', closeAudiencePanel);
audienceForm?.addEventListener('submit', submitAudiencePetition);

royalMailToggle?.addEventListener('click', () => {
    const opening = royalMailPanel?.classList.contains('hidden');
    royalMailPanel?.classList.toggle('hidden', !opening);
    royalMailToggle?.setAttribute('aria-expanded', String(Boolean(opening)));
    if (opening && document.pointerLockElement) document.exitPointerLock?.();
});
royalMailClose?.addEventListener('click', () => {
    royalMailPanel?.classList.add('hidden');
    royalMailToggle?.setAttribute('aria-expanded', 'false');
    if (hasStarted) requestControlLock();
});
visitorDisplayNameInput?.addEventListener('change', () => {
    visitorDisplayNameInput.value = normalizeVisitorName(visitorDisplayNameInput.value, visitorIdentity.uid);
    syncVisitorProfile().catch((error) => showMessage(`Name update failed: ${error.message}`));
});
copyVisitorCodeBtn?.addEventListener('click', async () => {
    if (!visitorIdentity.code) return;
    try {
        await navigator.clipboard.writeText(visitorIdentity.code);
        showMessage('Permanent Veil code copied.');
    } catch {
        showMessage(visitorIdentity.code);
    }
});
openVeilChatBtn?.addEventListener('click', () => {
    location.assign('veil-chat/?royal=1');
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncVisitorProfile().catch(() => {});
});
startRoyalMail();

function shouldUseMobileInput() {
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || window.innerWidth <= 900;
}

const mobileInput = {
    enabled: shouldUseMobileInput(),
    stickPointer: null,
    lookPointer: null,
    stickStartX: 0,
    stickStartY: 0,
    lookX: 0,
    lookY: 0,
    moveX: 0,
    moveZ: 0
};

document.body.classList.toggle('mobile-input', mobileInput.enabled);

document.addEventListener('gesturestart', (event) => event.preventDefault?.(), { passive: false });
document.addEventListener('touchmove', (event) => {
    if (mobileInput.enabled && hasStarted && !document.body.classList.contains('pc-open')) event.preventDefault();
}, { passive: false });


function syncSettingsUi() {
    if (qualitySelect) qualitySelect.value = settings.quality;
    if (drawDistanceSelect) drawDistanceSelect.value = String(settings.drawDistance);
    if (pcPreviewSelect) pcPreviewSelect.value = settings.pcPreview;
    if (reducedMotionInput) reducedMotionInput.checked = settings.reducedMotion;
    document.body.classList.toggle('menu-reduced-motion', settings.reducedMotion);
}

function applySettings() {
    applyRenderScale();
    applyCameraSettings();
    syncSettingsUi();
    if (worldData && worldData.setPerformanceOptions) {
        worldData.setPerformanceOptions({
            quality: settings.quality,
            pcPreview: settings.pcPreview
        });
    }
}

function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
}

syncSettingsUi();

qualitySelect?.addEventListener('change', () => updateSetting('quality', qualitySelect.value));
drawDistanceSelect?.addEventListener('change', () => updateSetting('drawDistance', Number(drawDistanceSelect.value)));
pcPreviewSelect?.addEventListener('change', () => updateSetting('pcPreview', pcPreviewSelect.value));
reducedMotionInput?.addEventListener('change', () => updateSetting('reducedMotion', reducedMotionInput.checked));

let messageTimeout = null;
function showMessage(text) {
    messageOverlay.textContent = text;
    messageOverlay.classList.add('visible');
    if (messageTimeout) clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => {
        messageOverlay.classList.remove('visible');
    }, 3000);
}

// Audio context (created on user click)
let audioCtx = null;
let audioBuffers = {};

const sfx = {
    play: (name, loop=false, volume=1.0) => {
        const bufferName = audioBuffers[name] ? name : (name === 'drop' && audioBuffers.hang ? 'hang' : null);
        if (!audioCtx || !bufferName) return null;
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffers[bufferName];
        source.loop = loop;
        const gain = audioCtx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(audioCtx.destination);
        source.start();
        return { source, gain };
    }
};

let worldData = null;
let chaosActive = false;
const spamEvents = { consume: [], rgb: [], window: [] };
const spamLimits = {
    consume: { count: 3, ms: 5200 },
    rgb: { count: 7, ms: 4200 },
    window: { count: 6, ms: 5200 }
};
const pianoSitSpam = [];

function reportPianoSitSpam() {
    const now = performance.now();
    pianoSitSpam.push(now);
    while (pianoSitSpam.length && now - pianoSitSpam[0] > 6800) pianoSitSpam.shift();
    if (pianoSitSpam.length < 6 || chaosActive) return;
    pianoSitSpam.length = 0;
    worldData?.triggerPianoScare?.();
    showMessage('The piano is done with the sit-spam.');
}

function ensureChaosOverlay() {
    let overlay = document.getElementById('chaos-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'chaos-overlay';
        overlay.setAttribute('aria-live', 'polite');
        document.body.appendChild(overlay);
    }
    return overlay;
}

function showChaosOverlay(kind, title, subtitle = '', duration = 1600) {
    const overlay = ensureChaosOverlay();
    overlay.className = `chaos-overlay ${kind}`;
    const isFall = kind === 'window-fall';
    const isFan = kind === 'fan-smash';
    const bitCount = isFall ? 92 : isFan ? 76 : 34;
    const bits = Array.from({ length: bitCount }, () => {
        const x = Math.round(Math.random() * 100);
        const y = Math.round(Math.random() * 100);
        const d = (Math.random() * 0.75).toFixed(2);
        const s = (0.65 + Math.random() * 1.65).toFixed(2);
        return `<i style="--x:${x}vw;--y:${y}vh;--d:${d}s;--s:${s}"></i>`;
    }).join('');
    const city = Array.from({ length: 14 }, (_, i) => `<span style="--i:${i}"></span>`).join('');
    overlay.innerHTML = `
        <div class="chaos-fall-scene" aria-hidden="true">
            <div class="chaos-skyline chaos-skyline-a">${city}</div>
            <div class="chaos-skyline chaos-skyline-b">${city}</div>
            <div class="chaos-street"></div>
        </div>
        <div class="chaos-wall-scene" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="chaos-speedlines" aria-hidden="true"></div>
        <div class="chaos-card">
            <strong>${title}</strong>
            ${subtitle ? `<em>${subtitle}</em>` : ''}
        </div>
        <div class="chaos-bits" aria-hidden="true">${bits}</div>
    `;
    overlay.classList.add('show');
    window.clearTimeout(overlay._hideTimer);
    overlay._hideTimer = window.setTimeout(() => overlay.classList.remove('show'), duration);
}

function unlockFromSpecialStates() {
    if (document.body.classList.contains('pc-open') && worldData?.closePCSession) worldData.closePCSession();
    clearMovementInput();
    isSitting = false;
    isSittingGamingChair = false;
    window.isSittingGamingChair = false;
    isSittingPiano = false;
    window.isSittingPiano = false;
    sitAnimPhase = '';
    sitSpinGroup = null;
    isHanging = false;
    hangAnimPhase = '';
    cinematicPhase = '';
    cinematicOnComplete = null;
    armGroup.position.set(0, -1.0, 0);
    if (interactions) interactions.disableE = false;
    worldData?.setCatTracking?.(false);
}

function wakeFromBed(message = 'You wake back up in bed.') {
    unlockFromSpecialStates();
    player.yawObject.position.set(-2.75, 1.5, -0.45);
    player.yawObject.rotation.y = 0.35;
    player.pitchObject.rotation.x = -Math.PI / 2;
    player.allowLook = false;
    isWakingUp = true;
    if (sfx) sfx.play('wake', false, 0.55);
    showMessage(message);
    window.setTimeout(() => {
        chaosActive = false;
        requestControlLock();
    }, 280);
}

function triggerSnackOverload() {
    if (chaosActive) return;
    chaosActive = true;
    clearMovementInput();
    player.allowLook = false;
    showChaosOverlay('snack-pop', 'SNACK OVERLOAD', 'too much fuel, emergency bed respawn', 1450);
    if (sfx) sfx.play('error', false, 0.7);
    window.setTimeout(() => wakeFromBed('Too many snacks too fast. You respawn in bed.'), 1150);
}

function triggerWindowYeet() {
    if (chaosActive) return;
    chaosActive = true;
    unlockFromSpecialStates();
    player.allowLook = false;
    clearMovementInput();
    showChaosOverlay('window-fall', 'WINDOW YEET', 'full falling cutscene engaged... brace for pixel impact', 5600);
    if (sfx) sfx.play('drop', false, 0.85);
    window.setTimeout(() => { if (sfx) sfx.play('error', false, 0.75); }, 4650);
    window.setTimeout(() => wakeFromBed('You got pavement-reset and wake back up in bed.'), 5350);
}

function triggerFanSmash() {
    if (chaosActive) return;
    chaosActive = true;
    unlockFromSpecialStates();
    player.allowLook = false;
    clearMovementInput();
    showChaosOverlay('fan-smash', 'FAN LAUNCH', 'max speed ceiling fan → wall bonk → pixel respawn', 3600);
    if (sfx) sfx.play('drop', false, 0.9);
    window.setTimeout(() => { if (sfx) sfx.play('error', false, 0.7); }, 2350);
    window.setTimeout(() => wakeFromBed('The fan invented fast travel. You wake back up in bed.'), 3350);
}

function triggerRgbOverload() {
    if (chaosActive) return;
    showChaosOverlay('rgb-pop', 'RGB OVERCLOCK', 'the PC throws a tiny tantrum, then fixes itself', 1350);
    worldData?.triggerPcBurst?.();
    if (sfx) sfx.play('error', false, 0.55);
}

window.reportRoomSpam = (type) => {
    const key = type === 'drink' || type === 'eat' || type === 'snack' ? 'consume' : type;
    const limit = spamLimits[key];
    if (!limit) return false;
    const now = performance.now();
    const bucket = spamEvents[key];
    bucket.push(now);
    while (bucket.length && now - bucket[0] > limit.ms) bucket.shift();
    if (bucket.length < limit.count) return false;
    bucket.length = 0;
    if (key === 'consume') triggerSnackOverload();
    else if (key === 'rgb') triggerRgbOverload();
    else if (key === 'window') triggerWindowYeet();
    return true;
};

// Create Player
const player = new Player(camera, document.body, sfx);
scene.add(player.yawObject);

// Create Interactions
const promptEl = document.getElementById('interaction-prompt');
let interactions = null;

let hasStarted = false;
let pcReturnPending = false;

// Handle Window Resize
function onResize() {
    const wasMobile = mobileInput.enabled;
    mobileInput.enabled = shouldUseMobileInput();
    document.body.classList.toggle('mobile-input', mobileInput.enabled);

    if (mobileInput.enabled) {
        player.isLocked = hasStarted && !document.body.classList.contains('pc-open');
        hud.classList.toggle('active', player.isLocked);
        pauseOverlay.classList.add('hidden');
    } else if (wasMobile) {
        clearMovementInput();
        player.isLocked = document.pointerLockElement === document.body;
    }

    const viewport = getViewportSize();
    camera.aspect = viewport.width / viewport.height;
    applyCameraSettings();
    applyRenderScale(activePixelRatio);
    updateMobileControls();
}

let resizeFrame = 0;
function requestResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(onResize);
}

window.addEventListener('resize', requestResize, { passive: true });
window.visualViewport?.addEventListener('resize', requestResize, { passive: true });
document.addEventListener('fullscreenchange', requestResize);

// Pointer Lock Controls
document.addEventListener('pointerlockchange', () => {
    if (mobileInput.enabled) {
        player.isLocked = hasStarted && !document.body.classList.contains('pc-open');
        hud.classList.toggle('active', player.isLocked);
        pauseOverlay.classList.add('hidden');
        return;
    }

    if (document.pointerLockElement === document.body) {
        player.isLocked = true;
        hud.classList.add('active');
        pauseOverlay.classList.add('hidden');
    } else {
        player.isLocked = false;
        hud.classList.remove('active');
        if (document.body.classList.contains('pc-open')) {
            pauseOverlay.classList.add('hidden');
            return;
        }
        if (hasStarted && !isSitting && !isHanging) {
            pauseOverlay.classList.remove('hidden');
        }
    }
});

function requestControlLock() {
    if (mobileInput.enabled) {
        player.isLocked = true;
        hud.classList.add('active');
        pauseOverlay.classList.add('hidden');
        updateMobileControls();
        return;
    }

    player.lock();
}

pauseOverlay.addEventListener('click', () => {
    requestControlLock();
});

function clearMovementInput() {
    player.moveForward = false;
    player.moveBackward = false;
    player.moveLeft = false;
    player.moveRight = false;
    mobileInput.moveX = 0;
    mobileInput.moveZ = 0;
    if (mobileStickKnob) mobileStickKnob.style.transform = 'translate3d(0, 0, 0)';
    chairPushLeft = false;
    chairPushRight = false;
}

function updateMobileMoveState() {
    const x = mobileInput.moveX;
    const z = mobileInput.moveZ;
    player.moveForward = z < -0.22;
    player.moveBackward = z > 0.22;
    player.moveLeft = x < -0.22;
    player.moveRight = x > 0.22;
}

let lastMobileUiState = '';
function updateMobileControls(force = false) {
    if (!mobileInput.enabled || !mobileControls) return;
    const active = hasStarted && !document.body.classList.contains('pc-open');
    const special = active && ((isSitting && sitAnimPhase === 'seated') || (isHanging && hangAnimPhase === 'hanging'));
    const piano = active && isSittingPiano && sitAnimPhase === 'seated';
    const state = `${active ? 1 : 0}${special ? 1 : 0}${piano ? 1 : 0}`;
    if (!force && state === lastMobileUiState) return;
    lastMobileUiState = state;
    mobileControls.classList.toggle('hidden', !active);
    document.body.classList.toggle('mobile-special', special);
    document.body.classList.toggle('mobile-piano-mode', piano);
    if (mobilePiano) mobilePiano.classList.toggle('hidden', !piano);
}

function mobileScreenPoint(event) {
    const touch = event.touches?.[0] || event.changedTouches?.[0] || event;
    return { x: touch.clientX, y: touch.clientY };
}

function bindMobileControls() {
    if (!mobileControls) return;

    const stop = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    mobileStick?.addEventListener('pointerdown', (event) => {
        if (!mobileInput.enabled) return;
        stop(event);
        mobileInput.stickPointer = event.pointerId;
        mobileStick.setPointerCapture?.(event.pointerId);
        const rect = mobileStick.getBoundingClientRect();
        mobileInput.stickStartX = rect.left + rect.width / 2;
        mobileInput.stickStartY = rect.top + rect.height / 2;
    });

    mobileStick?.addEventListener('pointermove', (event) => {
        if (mobileInput.stickPointer !== event.pointerId) return;
        stop(event);
        const max = 42;
        const dx = Math.max(-max, Math.min(max, event.clientX - mobileInput.stickStartX));
        const dy = Math.max(-max, Math.min(max, event.clientY - mobileInput.stickStartY));
        const len = Math.hypot(dx, dy);
        const scale = len > max ? max / len : 1;
        const x = dx * scale;
        const y = dy * scale;
        mobileInput.moveX = x / max;
        mobileInput.moveZ = y / max;
        if (mobileStickKnob) mobileStickKnob.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        updateMobileMoveState();
    });

    const releaseStick = (event) => {
        if (mobileInput.stickPointer !== event.pointerId) return;
        stop(event);
        mobileInput.stickPointer = null;
        mobileInput.moveX = 0;
        mobileInput.moveZ = 0;
        updateMobileMoveState();
        if (mobileStickKnob) mobileStickKnob.style.transform = 'translate3d(0, 0, 0)';
    };

    mobileStick?.addEventListener('pointerup', releaseStick);
    mobileStick?.addEventListener('pointercancel', releaseStick);
    mobileStick?.addEventListener('lostpointercapture', () => {
        mobileInput.stickPointer = null;
        mobileInput.moveX = 0;
        mobileInput.moveZ = 0;
        updateMobileMoveState();
        if (mobileStickKnob) mobileStickKnob.style.transform = 'translate3d(0, 0, 0)';
    });

    mobileLookZone?.addEventListener('pointerdown', (event) => {
        if (!mobileInput.enabled) return;
        if (event.target.closest?.('button') || event.target.closest?.('#mobile-stick')) return;
        stop(event);
        mobileInput.lookPointer = event.pointerId;
        mobileInput.lookX = event.clientX;
        mobileInput.lookY = event.clientY;
        mobileLookZone.setPointerCapture?.(event.pointerId);
    });

    mobileLookZone?.addEventListener('pointermove', (event) => {
        if (mobileInput.lookPointer !== event.pointerId || !player.allowLook || document.body.classList.contains('pc-open')) return;
        stop(event);
        const dx = event.clientX - mobileInput.lookX;
        const dy = event.clientY - mobileInput.lookY;
        mobileInput.lookX = event.clientX;
        mobileInput.lookY = event.clientY;
        if (Math.abs(dx) > 90 || Math.abs(dy) > 90) return;
        player.yawObject.rotation.y -= dx * 0.0042;
        player.pitchObject.rotation.x -= dy * 0.0042;
        player.pitchObject.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitchObject.rotation.x));
    });

    const releaseLook = (event) => {
        if (mobileInput.lookPointer !== event.pointerId) return;
        stop(event);
        mobileInput.lookPointer = null;
    };
    mobileLookZone?.addEventListener('pointerup', releaseLook);
    mobileLookZone?.addEventListener('pointercancel', releaseLook);

    mobileInteractBtn?.addEventListener('pointerdown', (event) => {
        if (!mobileInput.enabled) return;
        stop(event);
        if (interactions?.currentHover) interactions.triggerInteraction('touch');
    });

    mobileSecondaryBtn?.addEventListener('pointerdown', (event) => {
        if (!mobileInput.enabled) return;
        stop(event);
        triggerSecondaryAction();
    });

    mobileFullscreenBtn?.addEventListener('pointerdown', async (event) => {
        if (!mobileInput.enabled) return;
        stop(event);
        try {
            if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
            else await document.exitFullscreen?.();
        } catch {
            showMessage('Fullscreen is blocked by this browser.');
        }
    });

    mobilePiano?.addEventListener('pointerdown', (event) => {
        const key = event.target.closest('[data-piano-code]');
        if (!key) return;
        stop(event);
        if (!isSittingPiano || sitAnimPhase !== 'seated') return;
        const code = key.dataset.pianoCode;
        const freq = worldData?.pianoKeyMap?.[code];
        if (freq && worldData?.playPianoKey) worldData.playPianoKey(freq);
    });

    window.addEventListener('orientationchange', () => setTimeout(() => {
        onResize();
        updateMobileControls();
    }, 250));

    updateMobileControls();
}


window.addEventListener('bedroom-pc-open', () => {
    pcReturnPending = false;
    pauseOverlay.classList.add('hidden');
    clearMovementInput();
    updateMobileControls();
});

window.addEventListener('bedroom-pc-close', () => {
    pcReturnPending = true;
    pauseOverlay.classList.add('hidden');
    clearMovementInput();
    updateMobileControls();
});

window.addEventListener('bedroom-pc-hidden', () => {
    if (!pcReturnPending) return;
    pcReturnPending = false;
    updateVisibilityCulling(true);
    if (hasStarted) requestControlLock();
    updateMobileControls();
});

window.addEventListener('blur', clearMovementInput);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearMovementInput();
});

// ============ SITTING SYSTEM ============
let isSitting = false;
let sitAnimPhase = ''; // 'movingToChair', 'sittingDown', 'seated', 'standingUp'
let sitTarget = null;
let sitLookTarget = null;
let isSittingPiano = false;
let isSittingGamingChair = false;
window.isSittingGamingChair = false;
let preSitPos = new THREE.Vector3();
let preSitRotY = 0;
let preSitPitchX = 0;
let sitAnimTime = 0;
let sitEyeHeight = 1.25;
let sitPitchTarget = 0.1;
let sitSpinGroup = null;
let sitExitPos = null;
let sitChairBaseYaw = 0;
let sitChairYaw = 0;
let sitChairSpinVelocity = 0;
let chairPushLeft = false;
let chairPushRight = false;

bindMobileControls();

function startSit(chairWorldPos, deskLookAt, eyeHeight = 1.25, pitchTarget = 0.1, options = {}) {
    if (isSitting || isHanging) return;
    if (sfx) sfx.play('sit');
    isSitting = true;
    sitAnimPhase = 'movingToChair';
    sitTarget = chairWorldPos.clone();
    sitLookTarget = deskLookAt.clone();
    sitEyeHeight = eyeHeight;
    sitPitchTarget = pitchTarget;
    sitSpinGroup = options.spinGroup || null;
    sitExitPos = options.exitPos ? options.exitPos.clone() : null;
    isSittingGamingChair = options.isGamingChair === true;
    window.isSittingGamingChair = false;
    sitChairSpinVelocity = 0;
    chairPushLeft = false;
    chairPushRight = false;
    
    // Fix spinning drill bug by normalizing the current rotation relative to target
    let currentY = player.yawObject.rotation.y;
    const targetRotY = Math.atan2(sitTarget.x - sitLookTarget.x, sitTarget.z - sitLookTarget.z);
    while (currentY - targetRotY > Math.PI) currentY -= Math.PI * 2;
    while (currentY - targetRotY < -Math.PI) currentY += Math.PI * 2;
    player.yawObject.rotation.y = currentY; // apply normalized rotation back
    preSitRotY = currentY;
    
    preSitPos.copy(player.yawObject.position);
    preSitPitchX = player.pitchObject.rotation.x;
    sitChairBaseYaw = Math.atan2(sitTarget.x - sitLookTarget.x, sitTarget.z - sitLookTarget.z);
    sitChairYaw = sitSpinGroup ? sitSpinGroup.rotation.y : sitChairBaseYaw;
    sitAnimTime = 0;
    showMessage("Press SPACE to stand up.");
}

function angleDiff(a, b) {
    let diff = a - b;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}

function updateChairSpin(dt) {
    if (!sitSpinGroup) return;

    if (chairPushLeft) sitChairSpinVelocity += 1.65 * dt;
    if (chairPushRight) sitChairSpinVelocity -= 1.65 * dt;

    const lookOffset = angleDiff(player.yawObject.rotation.y, sitChairYaw);
    const lean = Math.max(-1, Math.min(1, lookOffset / 1.05));
    sitChairSpinVelocity += lean * 0.32 * dt;

    sitChairSpinVelocity *= Math.pow(0.84, dt * 60);
    sitChairSpinVelocity = Math.max(-1.2, Math.min(1.2, sitChairSpinVelocity));
    const prevChairYaw = sitChairYaw;
    sitChairYaw += sitChairSpinVelocity * dt;
    const chairDelta = angleDiff(sitChairYaw, prevChairYaw);
    sitSpinGroup.rotation.y = sitChairYaw;
    player.yawObject.rotation.y += chairDelta;
}

function updateSitAnimation(dt) {
    sitAnimTime += dt;
    const t = Math.min(sitAnimTime / 0.6, 1);
    const ease = t * t * (3 - 2 * t);

    if (sitAnimPhase === 'movingToChair') {
        player.yawObject.position.x = preSitPos.x + (sitTarget.x - preSitPos.x) * ease;
        player.yawObject.position.z = preSitPos.z + (sitTarget.z - preSitPos.z) * ease;
        player.yawObject.position.y = 1.5 + (sitEyeHeight - 1.5) * ease;

        const targetRotY = Math.atan2(sitTarget.x - sitLookTarget.x, sitTarget.z - sitLookTarget.z);
        player.yawObject.rotation.y = preSitRotY + (targetRotY - preSitRotY) * ease;
        player.pitchObject.rotation.x = preSitPitchX + (sitPitchTarget - preSitPitchX) * ease;
        if (sitSpinGroup) {
            sitChairYaw = targetRotY;
            sitSpinGroup.rotation.y = sitChairYaw;
        }

        if (t >= 1) {
            sitAnimPhase = 'seated';
            window.isSittingGamingChair = isSittingGamingChair;
            showMessage("Press SPACE to stand up.");
        }
    } else if (sitAnimPhase === 'seated') {
        updateChairSpin(dt);
    } else if (sitAnimPhase === 'standingUp') {
        player.yawObject.position.y = sitEyeHeight + (1.5 - sitEyeHeight) * ease;
        if (sitSpinGroup) updateChairSpin(dt);
        if (t >= 1) {
            if (sitExitPos) {
                player.yawObject.position.copy(sitExitPos);
            } else {
                player.yawObject.position.y = 1.5;
            }
            isSitting = false;
            isSittingGamingChair = false;
            window.isSittingGamingChair = false;
            isSittingPiano = false;
            window.isSittingPiano = false;
            sitAnimPhase = '';
            sitSpinGroup = null;
            sitExitPos = null;
            sitChairSpinVelocity = 0;
            chairPushLeft = false;
            chairPushRight = false;
        }
    }
}

// ============ HANGING FROM FAN SYSTEM ============
let isHanging = false;
let hangAnimPhase = '';
let hangAnimTime = 0;
let hangMaxSpeedTime = 0;
let preHangPos = new THREE.Vector3();
let hangCenter = new THREE.Vector3(0, 3.0, 2.15);

function startHang(fanGroup, bladeGroup) {
    if (isHanging || isSitting) return;
    if (sfx) sfx.play('hang');
    isHanging = true;
    hangAnimPhase = 'grabbing';
    hangAnimTime = 0;
    hangMaxSpeedTime = 0;
    preHangPos.copy(player.yawObject.position);
    fanGroup?.getWorldPosition?.(hangCenter);
    hangCenter.y = 3.0;
    showMessage("WHEEE! Press E to let go. Max-speed fan is cursed.");
    // Cat starts curiously tracking the player
    if (worldData && worldData.setCatTracking) {
        worldData.setCatTracking(true, player.yawObject.position);
    }
}

function updateHangAnimation(dt, worldData) {
    hangAnimTime += dt;

    if (hangAnimPhase === 'grabbing') {
        const t = Math.min(hangAnimTime / 0.4, 1);
        const ease = t * t * (3 - 2 * t);
        // Move up to fan
        player.yawObject.position.x = preHangPos.x + (hangCenter.x - preHangPos.x) * ease;
        player.yawObject.position.z = preHangPos.z + (hangCenter.z - preHangPos.z) * ease;
        player.yawObject.position.y = preHangPos.y + (3.0 - preHangPos.y) * ease;
        if (t >= 1) {
            hangAnimPhase = 'hanging';
        }
    } else if (hangAnimPhase === 'hanging') {
        // Spin with the fan blades
        const fanAngle = worldData.bladeGroup.rotation.y;
        const radius = 0.8;
        player.yawObject.position.x = hangCenter.x + Math.sin(fanAngle) * radius;
        player.yawObject.position.z = hangCenter.z + Math.cos(fanAngle) * radius;
        player.yawObject.position.y = 3.0;
        // Spin the camera too for fun
        player.yawObject.rotation.y = -fanAngle;

        const speedLevel = typeof worldData.fanSpeed === 'function' ? worldData.fanSpeed() : 0;
        if (speedLevel >= 3) {
            hangMaxSpeedTime += dt;
            if (hangMaxSpeedTime > 1.15) {
                triggerFanSmash();
                return;
            }
        } else {
            hangMaxSpeedTime = 0;
        }
    } else if (hangAnimPhase === 'lettingGo') {
        const t = Math.min(hangAnimTime / 0.5, 1);
        const ease = t * t * (3 - 2 * t);
        // Drop back down
        player.yawObject.position.y = 3.0 + (1.5 - 3.0) * ease;
        if (t >= 1) {
            player.yawObject.position.y = 1.5;
            isHanging = false;
            hangAnimPhase = '';
            hangMaxSpeedTime = 0;
            // Cat stops tracking
            if (worldData && worldData.setCatTracking) {
                worldData.setCatTracking(false);
            }
        }
    }
}

function triggerSecondaryAction() {
    if (document.body.classList.contains('pc-open')) return false;

    if (isSitting && sitAnimPhase === 'seated') {
        if (isSittingPiano) reportPianoSitSpam();
        if (sfx) sfx.play('sit');
        sitAnimPhase = 'standingUp';
        sitAnimTime = 0;
        if (interactions) interactions.disableE = false;
        updateMobileControls();
        return true;
    }

    if (isHanging && hangAnimPhase === 'hanging') {
        if (sfx) sfx.play('drop');
        hangAnimPhase = 'lettingGo';
        hangAnimTime = 0;
        updateMobileControls();
        return true;
    }

    return false;
}

// Key handler for special states
document.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('pc-open')) return;
    if (isSitting && sitSpinGroup && sitAnimPhase === 'seated') {
        if (e.code === 'ArrowLeft') chairPushLeft = true;
        if (e.code === 'ArrowRight') chairPushRight = true;
    }

    if (e.code === 'Space') {
        if (triggerSecondaryAction()) e.preventDefault();
    } else if (isSittingPiano && sitAnimPhase === 'seated') {
        if (e.repeat) return; // Fix piano key spamming
        const keyMap = worldData && worldData.pianoKeyMap ? worldData.pianoKeyMap : {};
        if (keyMap[e.code] && worldData && worldData.playPianoKey) {
            worldData.playPianoKey(keyMap[e.code]);
        }
    } else if (e.code === 'KeyE') {
        triggerSecondaryAction();
    }
});

document.addEventListener('keyup', (e) => {
    if (document.body.classList.contains('pc-open')) return;
    if (e.code === 'ArrowLeft') chairPushLeft = false;
    if (e.code === 'ArrowRight') chairPushRight = false;
});

// Start button click
enterBtn.addEventListener('click', async () => {
    if (hasStarted) return;
    hasStarted = true;

    // Load Audio
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        try {
            await Promise.all(Object.entries(sounds).map(async ([key, b64]) => {
                const res = await fetch(b64);
                const arrayBuffer = await res.arrayBuffer();
                audioBuffers[key] = await audioCtx.decodeAudioData(arrayBuffer);
            }));
        } catch(e) {
            console.error("Audio decode error", e);
        }
    }

    worldData = createWorld(scene, showMessage, audioCtx, sfx);
    player.setCollisionBoxes(worldData.collisionBoxes || []);
    startKingdomPresence(applyKingdomPresence);
    applySettings();
    interactions = new InteractionSystem(camera, worldData.interactables, promptEl, handleSpecialAction);
    updateVisibilityCulling(true);

    fadeOverlay.classList.add('blackout');
    startScreen.classList.add('hidden');

    player.pitchObject.rotation.x = -Math.PI / 2;
    player.allowLook = false;
    isWakingUp = true;
    if (sfx) sfx.play('wake', false, 0.5);

    requestControlLock();

    setTimeout(() => {
        fadeOverlay.classList.remove('blackout');
    }, 100);
});

// Handle special interaction actions (sit, hang)
function handleSpecialAction(interactable) {
    if (interactable.action === 'sit') {
        startSit(interactable.chairWorldPos, interactable.deskLookAt, 1.25, 0.1, {
            spinGroup: interactable.chairSpinGroup || null,
            exitPos: interactable.chairExitPos || null,
            isGamingChair: true
        });
        return true;
    } else if (interactable.action === 'sitPiano') {
        if (typeof interactable.canInteract === 'function' && !interactable.canInteract()) {
            showMessage('The bone pianist is using the bench. Dismiss him first.');
            return true;
        }
        reportPianoSitSpam();
        startSit(interactable.pianoWorldPos, interactable.pianoLookAt, 1.48, -0.03);
        isSittingPiano = true;
        window.isSittingPiano = true;
        interactions.disableE = true;
        return true;
    } else if (interactable.action === 'hangFan') {
        startHang(interactable.fanGroup, interactable.bladeGroup);
        return true;
    } else if (interactable.action === 'kneelThrone') {
        startSit(interactable.kneelWorldPos, interactable.kneelLookAt, 0.66, 0.02, {
            exitPos: interactable.kneelExitPos || null,
            isGamingChair: false
        });
        if (interactions) interactions.disableE = true;
        showMessage('You kneel before the throne. Address him as My Lord.');
        window.setTimeout(openAudiencePanel, 1250);
        return true;
    }
    return false;
}

// Main Loop
const clock = new THREE.Clock();
// ============ CINEMATIC ENGINE ============
let cinematicPhase = ''; // 'movingIn', 'action', 'movingOut'
let cinematicTime = 0;
let cinematicType = '';
let cinematicTargetPos = null;
let cinematicTargetLookAt = null;
let cinematicPrePos = new THREE.Vector3();
let cinematicPreRotY = 0;
let cinematicPrePitchX = 0;
let cinematicOnComplete = null;

const armGroup = new THREE.Group();
player.pitchObject.add(armGroup); // Attach to camera view

const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdcb5, roughness: 0.6 });
const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5), skinMat);
forearm.rotation.x = Math.PI / 2;
forearm.position.set(0.3, -0.3, -0.25);
armGroup.add(forearm);

const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.12), skinMat);
palm.position.set(0.3, -0.3, -0.55);
armGroup.add(palm);

const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.1), skinMat);
fingers.position.set(0.3, -0.3, -0.65);
armGroup.add(fingers);

armGroup.position.set(0, -1.0, 0); // Hide offscreen by default

window.startCinematic = (type, targetPos, targetLookAt, onComplete) => {
    if (cinematicPhase !== '' || isSitting || isHanging) return false;
    cinematicType = type;
    cinematicTargetPos = targetPos.clone();
    cinematicTargetLookAt = targetLookAt.clone();
    cinematicOnComplete = onComplete;
    cinematicPhase = 'movingIn';
    cinematicTime = 0;
    
    cinematicPrePos.copy(player.yawObject.position);
    cinematicPreRotY = player.yawObject.rotation.y;
    cinematicPrePitchX = player.pitchObject.rotation.x;
    
    player.allowLook = false;
    player.moveForward = false;
    player.moveBackward = false;
    player.moveLeft = false;
    player.moveRight = false;

    return true;
};

function updateCinematic(dt) {
    if (cinematicPhase === '') return;
    cinematicTime += dt;
    
    if (cinematicPhase === 'movingIn') {
        const t = Math.min(cinematicTime / 0.8, 1);
        const ease = t * t * (3 - 2 * t);
        
        player.yawObject.position.x = cinematicPrePos.x + (cinematicTargetPos.x - cinematicPrePos.x) * ease;
        player.yawObject.position.z = cinematicPrePos.z + (cinematicTargetPos.z - cinematicPrePos.z) * ease;
        player.yawObject.position.y = cinematicPrePos.y + (cinematicTargetPos.y - cinematicPrePos.y) * ease;
        
        const targetRotY = Math.atan2(cinematicTargetPos.x - cinematicTargetLookAt.x, cinematicTargetPos.z - cinematicTargetLookAt.z);
        let diffY = targetRotY - cinematicPreRotY;
        while (diffY > Math.PI) diffY -= Math.PI * 2;
        while (diffY < -Math.PI) diffY += Math.PI * 2;
        player.yawObject.rotation.y = cinematicPreRotY + diffY * ease;
        
        const dx = cinematicTargetLookAt.x - cinematicTargetPos.x;
        const dz = cinematicTargetLookAt.z - cinematicTargetPos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        const targetPitchX = Math.atan2(cinematicTargetPos.y - cinematicTargetLookAt.y, dist);
        player.pitchObject.rotation.x = cinematicPrePitchX + (targetPitchX - cinematicPrePitchX) * ease;
        
        if (t >= 1) {
            cinematicPhase = 'action';
            cinematicTime = 0;
            if (sfx && cinematicType === 'pet') {
                sfx.play('pet', false, 0.65);
            }
            if (cinematicType === 'pet' && cinematicOnComplete) {
                cinematicOnComplete();
                cinematicOnComplete = null;
            }
        }
    } else if (cinematicPhase === 'action') {
        const duration = cinematicType === 'pet' ? 1.0 : 0.6;
        const t = Math.min(cinematicTime / duration, 1);
        
        if (t < 0.3) {
            const ease = t / 0.3;
            armGroup.position.y = -1.0 + 1.0 * ease;
            armGroup.position.z = -0.5 * ease;
        } else if (t < 0.7) {
            armGroup.position.y = 0;
            armGroup.position.z = -0.5;
            if (cinematicType === 'pet') {
                armGroup.position.x = Math.sin(cinematicTime * 20) * 0.05;
            }
            if (cinematicTime >= duration * 0.5 && cinematicOnComplete) {
                cinematicOnComplete();
                cinematicOnComplete = null;
            }
        } else {
            const ease = (t - 0.7) / 0.3;
            armGroup.position.x = 0;
            armGroup.position.y = 0 - 1.0 * ease;
            armGroup.position.z = -0.5 + 0.5 * ease;
        }
        
        if (t >= 1) {
            cinematicPhase = 'movingOut';
            cinematicTime = 0;
            armGroup.position.set(0, -1.0, 0);
        }
    } else if (cinematicPhase === 'movingOut') {
        const t = Math.min(cinematicTime / 0.8, 1);
        const ease = t * t * (3 - 2 * t);
        
        player.yawObject.position.x = cinematicTargetPos.x + (cinematicPrePos.x - cinematicTargetPos.x) * ease;
        player.yawObject.position.z = cinematicTargetPos.z + (cinematicPrePos.z - cinematicTargetPos.z) * ease;
        player.yawObject.position.y = cinematicTargetPos.y + (cinematicPrePos.y - cinematicTargetPos.y) * ease;
        
        const targetRotY = Math.atan2(cinematicTargetPos.x - cinematicTargetLookAt.x, cinematicTargetPos.z - cinematicTargetLookAt.z);
        let diffY = cinematicPreRotY - targetRotY;
        while (diffY > Math.PI) diffY -= Math.PI * 2;
        while (diffY < -Math.PI) diffY += Math.PI * 2;
        player.yawObject.rotation.y = targetRotY + diffY * ease;
        
        const dx = cinematicTargetLookAt.x - cinematicTargetPos.x;
        const dz = cinematicTargetLookAt.z - cinematicTargetPos.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        const targetPitchX = Math.atan2(cinematicTargetPos.y - cinematicTargetLookAt.y, dist);
        player.pitchObject.rotation.x = targetPitchX + (cinematicPrePitchX - targetPitchX) * ease;
        
        if (t >= 1) {
            cinematicPhase = '';
            player.allowLook = true;
        }
    }
}

let isWakingUp = false;

function getMode() {
    if (!hasStarted) return 'start';
    if (cinematicPhase) return `cinematic:${cinematicType}:${cinematicPhase}`;
    if (isSittingPiano) return `piano:${sitAnimPhase || 'seated'}`;
    if (isSitting) return `sitting:${sitAnimPhase || 'seated'}`;
    if (isHanging) return `hanging:${hangAnimPhase || 'hanging'}`;
    return 'playing';
}

function renderGameToText() {
    const hoverLabel = interactions && interactions.currentHover ? interactions.getLabel(interactions.currentHover) : '';
    const payload = {
        coordinateSystem: 'Three.js room coords; x left/right, y up, z forward/back from room center',
        mode: getMode(),
        player: {
            x: Number(player.yawObject.position.x.toFixed(2)),
            y: Number(player.yawObject.position.y.toFixed(2)),
            z: Number(player.yawObject.position.z.toFixed(2)),
            yaw: Number(player.yawObject.rotation.y.toFixed(2)),
            pitch: Number(player.pitchObject.rotation.x.toFixed(2)),
            locked: player.isLocked
        },
        interaction: {
            prompt: promptEl ? promptEl.textContent : '',
            hoverLabel,
            eDisabled: interactions ? interactions.disableE : false
        },
        world: worldData && worldData.getDebugState ? worldData.getDebugState() : null
    };
    return JSON.stringify(payload);
}

window.render_game_to_text = renderGameToText;

function updateVisibilityCulling(force = false) {
    if (!worldData || !worldData.cullables || !worldData.cullables.length) return;
    const cullInterval = settings.quality === 'performance' ? 0.34 : settings.quality === 'balanced' ? 0.24 : 0.18;
    if (!force && cullTimer < cullInterval) return;
    cullTimer = 0;

    camera.updateMatrixWorld();
    cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cullFrustum.setFromProjectionMatrix(cullMatrix);
    camera.getWorldPosition(cameraWorldPos);

    for (const item of worldData.cullables) {
        if (!item || !item.object) continue;
        const radius = item.radius || 1;
        item.object.getWorldPosition(cullCenter);
        const maxDistance = settings.drawDistance + radius;
        const nearEnough = cameraWorldPos.distanceToSquared(cullCenter) <= maxDistance * maxDistance;
        cullSphere.center.copy(cullCenter);
        cullSphere.radius = radius;
        item.object.visible = nearEnough && cullFrustum.intersectsSphere(cullSphere);
    }
}

function stepGame(dt) {
    if (!hasStarted) return;
    cullTimer += dt;
    interactionTimer += dt;
    updateAdaptiveResolution(dt);
    player.updateLook();

    if (document.body.classList.contains('pc-open')) {
        if (worldData && worldData.updatePC) worldData.updatePC(dt);
        return;
    }

    if (isWakingUp) {
        player.pitchObject.rotation.x += (0 - player.pitchObject.rotation.x) * 2 * dt;
        player.yawObject.position.x += (-0.4 - player.yawObject.position.x) * 2 * dt;

        if (Math.abs(player.pitchObject.rotation.x) < 0.05 && Math.abs(-0.4 - player.yawObject.position.x) < 0.05) {
            player.pitchObject.rotation.x = 0;
            player.yawObject.position.x = -0.4;
            isWakingUp = false;
            player.allowLook = true; // Restore mouse look
        }
    }

    // Sit animation
    if (isSitting) {
        updateSitAnimation(dt);
    }

    // Hang animation
    if (isHanging && worldData) {
        updateHangAnimation(dt, worldData);
    }
    
    updateCinematic(dt);

    // Normal player movement
    if (!isSitting && !isHanging && cinematicPhase === '') {
        player.update(dt);
    }

    updateVisibilityCulling();

    const interactionInterval = settings.quality === 'performance' ? 0.085 : 0.055;
    if ((player.isLocked || isSitting || isHanging) && interactions && interactionTimer >= interactionInterval) {
        interactionTimer = 0;
        interactions.update();
    }

    // Camera and player motion remain at display refresh rate. Decorative room
    // systems use a lower fixed cadence on Performance mode to reduce CPU work.
    if (worldData) {
        const worldHz = settings.quality === 'performance' ? 20 : settings.quality === 'balanced' ? 30 : 45;
        worldUpdateAccumulator += dt;
        if (worldUpdateAccumulator >= 1 / worldHz) {
            const worldDt = Math.min(worldUpdateAccumulator, 0.075);
            worldUpdateAccumulator = 0;
            for (const u of worldData.updatables) {
                u.update(worldDt);
            }
        }
    }

    updateMobileControls();
    renderer.render(scene, camera);
}

window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) {
        stepGame(1 / 60);
    }
};

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (document.hidden) return;
    stepGame(dt);
}

document.addEventListener('visibilitychange', () => {
    clock.getDelta();
    if (!document.hidden) {
        adaptiveFrameMs = 16.7;
        adaptiveTimer = 0;
        worldUpdateAccumulator = 0;
    }
});

animate();
