import * as THREE from 'three';
import { createWorld } from './world.js?v=51';
import { Player } from './player.js?v=49';
import { InteractionSystem } from './interactions.js?v=49';
import { sounds } from './sounds.js?v=49';

const SETTINGS_KEY = 'my-room.settings.v1';
const LOCKED_FOV = 72;
const QUALITY_PROFILES = {
    performance: { pixelRatio: 0.72 },
    balanced: { pixelRatio: 1.0 },
    quality: { pixelRatio: 1.25 }
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
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
function applyRenderScale() {
    const profile = QUALITY_PROFILES[settings.quality] || QUALITY_PROFILES.performance;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
}
applyRenderScale();
renderer.shadowMap.enabled = false;
document.getElementById('game-container').appendChild(renderer.domElement);

// Setup Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.05);

const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, settings.drawDistance);
const cullFrustum = new THREE.Frustum();
const cullMatrix = new THREE.Matrix4();
const cullSphere = new THREE.Sphere();
const cullCenter = new THREE.Vector3();
const cameraWorldPos = new THREE.Vector3();
let cullTimer = 0;

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
    player.yawObject.position.set(-2.75, 1.5, 2.65);
    player.yawObject.rotation.y = -0.78;
    player.pitchObject.rotation.x = -Math.PI / 2;
    player.allowLook = false;
    isWakingUp = true;
    if (sfx) sfx.play('wake', false, 0.55);
    showMessage(message);
    window.setTimeout(() => {
        chaosActive = false;
        player.lock();
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
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    applyCameraSettings();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyRenderScale();
});

// Pointer Lock Controls
document.addEventListener('pointerlockchange', () => {
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

pauseOverlay.addEventListener('click', () => {
    player.lock();
});

function clearMovementInput() {
    player.moveForward = false;
    player.moveBackward = false;
    player.moveLeft = false;
    player.moveRight = false;
    chairPushLeft = false;
    chairPushRight = false;
}

window.addEventListener('bedroom-pc-open', () => {
    pcReturnPending = false;
    pauseOverlay.classList.add('hidden');
    clearMovementInput();
});

window.addEventListener('bedroom-pc-close', () => {
    pcReturnPending = true;
    pauseOverlay.classList.add('hidden');
    clearMovementInput();
});

window.addEventListener('bedroom-pc-hidden', () => {
    if (!pcReturnPending) return;
    pcReturnPending = false;
    updateVisibilityCulling(true);
    if (hasStarted) player.lock();
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

function startHang(fanGroup, bladeGroup) {
    if (isHanging || isSitting) return;
    if (sfx) sfx.play('hang');
    isHanging = true;
    hangAnimPhase = 'grabbing';
    hangAnimTime = 0;
    hangMaxSpeedTime = 0;
    preHangPos.copy(player.yawObject.position);
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
        player.yawObject.position.x = preHangPos.x + (0 - preHangPos.x) * ease;
        player.yawObject.position.z = preHangPos.z + (0 - preHangPos.z) * ease;
        player.yawObject.position.y = preHangPos.y + (3.0 - preHangPos.y) * ease;
        if (t >= 1) {
            hangAnimPhase = 'hanging';
        }
    } else if (hangAnimPhase === 'hanging') {
        // Spin with the fan blades
        const fanAngle = worldData.bladeGroup.rotation.y;
        const radius = 0.8;
        player.yawObject.position.x = Math.sin(fanAngle) * radius;
        player.yawObject.position.z = Math.cos(fanAngle) * radius;
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

// Key handler for special states
document.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('pc-open')) return;
    if (isSitting && sitSpinGroup && sitAnimPhase === 'seated') {
        if (e.code === 'ArrowLeft') chairPushLeft = true;
        if (e.code === 'ArrowRight') chairPushRight = true;
    }

    if (e.code === 'Space') {
        if (isSitting && sitAnimPhase === 'seated') {
            if (isSittingPiano) reportPianoSitSpam();
            if (sfx) sfx.play('sit');
            sitAnimPhase = 'standingUp';
            sitAnimTime = 0;
            interactions.disableE = false;
        }
    } else if (isSittingPiano && sitAnimPhase === 'seated') {
        if (e.repeat) return; // Fix piano key spamming
        const keyMap = worldData && worldData.pianoKeyMap ? worldData.pianoKeyMap : {};
        if (keyMap[e.code] && worldData && worldData.playPianoKey) {
            worldData.playPianoKey(keyMap[e.code]);
        }
    } else if (e.code === 'KeyE') {
        if (isHanging && hangAnimPhase === 'hanging') {
            if (sfx) sfx.play('drop');
            hangAnimPhase = 'lettingGo';
            hangAnimTime = 0;
        }
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
    applySettings();
    interactions = new InteractionSystem(camera, worldData.interactables, promptEl, handleSpecialAction);
    updateVisibilityCulling(true);

    fadeOverlay.classList.add('blackout');
    startScreen.classList.add('hidden');

    player.pitchObject.rotation.x = -Math.PI / 2;
    player.allowLook = false;
    isWakingUp = true;
    if (sfx) sfx.play('wake', false, 0.5);

    player.lock();

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
        reportPianoSitSpam();
        startSit(interactable.pianoWorldPos, interactable.pianoLookAt, 1.48, -0.03);
        isSittingPiano = true;
        window.isSittingPiano = true;
        interactions.disableE = true;
        return true;
    } else if (interactable.action === 'hangFan') {
        startHang(interactable.fanGroup, interactable.bladeGroup);
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
    if (!force && cullTimer < 0.08) return;
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

    if ((player.isLocked || isSitting || isHanging) && interactions) {
        interactions.update();
    }

    if (worldData) {
        for (const u of worldData.updatables) {
            u.update(dt);
        }
    }

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
    stepGame(Math.min(clock.getDelta(), 0.05));
}

animate();
