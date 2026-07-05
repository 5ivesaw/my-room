import * as THREE from 'three';
import { createWorld } from './world.js?v=42';
import { Player } from './player.js?v=42';
import { InteractionSystem } from './interactions.js?v=42';
import { sounds } from './sounds.js?v=42';

// Setup Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
function applyRenderScale() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
}
applyRenderScale();
renderer.shadowMap.enabled = false;
document.getElementById('game-container').appendChild(renderer.domElement);

// Setup Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.05);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);

// UI Elements
const startScreen = document.getElementById('start-screen');
const enterBtn = document.getElementById('enter-btn');
const hud = document.getElementById('hud');
const fadeOverlay = document.getElementById('fade-overlay');
const messageOverlay = document.getElementById('message-overlay');
const pauseOverlay = document.getElementById('pause-overlay');

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

// Create Player
const player = new Player(camera, document.body, sfx);
scene.add(player.yawObject);

// Create Interactions
const promptEl = document.getElementById('interaction-prompt');
let interactions = null;

let hasStarted = false;

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
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

window.addEventListener('bedroom-pc-close', () => {
    pauseOverlay.classList.add('hidden');
    player.moveForward = false;
    player.moveBackward = false;
    player.moveLeft = false;
    player.moveRight = false;
    chairPushLeft = false;
    chairPushRight = false;
    if (hasStarted) player.lock();
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
let preHangPos = new THREE.Vector3();

function startHang(fanGroup, bladeGroup) {
    if (isHanging || isSitting) return;
    if (sfx) sfx.play('hang');
    isHanging = true;
    hangAnimPhase = 'grabbing';
    hangAnimTime = 0;
    preHangPos.copy(player.yawObject.position);
    showMessage("WHEEE! Press E to let go.");
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
    } else if (hangAnimPhase === 'lettingGo') {
        const t = Math.min(hangAnimTime / 0.5, 1);
        const ease = t * t * (3 - 2 * t);
        // Drop back down
        player.yawObject.position.y = 3.0 + (1.5 - 3.0) * ease;
        if (t >= 1) {
            player.yawObject.position.y = 1.5;
            isHanging = false;
            hangAnimPhase = '';
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
    interactions = new InteractionSystem(camera, worldData.interactables, promptEl, handleSpecialAction);

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

function stepGame(dt) {
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
    stepGame(Math.min(clock.getDelta(), 0.1));
}

animate();
