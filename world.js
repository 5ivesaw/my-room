import * as THREE from 'three';
import { createPCSystem } from './pc-os.js?v=54';

export function createWorld(scene, showMessage, audioCtx, sfx) {
    const interactables = [];
    const updatables = [];
    const cullables = [];
    const performanceOptions = { quality: 'performance', pcPreview: 'still' };
    const optionalLights = [];
    const ROOM_HALF_X = 6;
    const ROOM_FRONT_Z = 6;
    const ROOM_BACK_Z = -8;
    const ROOM_WIDTH = ROOM_HALF_X * 2;
    const ROOM_DEPTH = ROOM_FRONT_Z - ROOM_BACK_Z;
    const ROOM_CENTER_Z = (ROOM_FRONT_Z + ROOM_BACK_Z) / 2;

    // Deterministic 2D furniture layout solver. Every major floor object reserves
    // an axis-aligned footprint plus breathing room. New objects can be added to
    // this list without manually guessing whether they intersect another prop.
    const LAYOUT_GAP = 0.22;
    const layoutReservations = [
        // Keep the central approach to the throne clear.
        { id: 'royal-aisle', x: 0, z: 1.45, halfX: 1.28, halfZ: 4.18, fixed: true },
        // Actual throne footprint, including its front steps and skull mound.
        { id: 'throne', x: 0, z: -5.22, halfX: 3.22, halfZ: 2.18, fixed: true }
    ];

    const rectanglesOverlap = (a, b, gap = LAYOUT_GAP) =>
        Math.abs(a.x - b.x) < a.halfX + b.halfX + gap &&
        Math.abs(a.z - b.z) < a.halfZ + b.halfZ + gap;

    function solveFloorPlacement(id, preferredX, preferredZ, halfX, halfZ) {
        const edgePadding = 0.16;
        const minX = -ROOM_HALF_X + halfX + edgePadding;
        const maxX = ROOM_HALF_X - halfX - edgePadding;
        const minZ = ROOM_BACK_Z + halfZ + edgePadding;
        const maxZ = ROOM_FRONT_Z - halfZ - edgePadding;
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const baseX = clamp(preferredX, minX, maxX);
        const baseZ = clamp(preferredZ, minZ, maxZ);
        const step = 0.24;
        let best = null;

        // Search expanding square rings around the preferred location. The first
        // valid point is the closest deterministic non-overlapping placement.
        for (let ring = 0; ring <= 24 && !best; ring++) {
            for (let ix = -ring; ix <= ring && !best; ix++) {
                for (let iz = -ring; iz <= ring; iz++) {
                    if (ring > 0 && Math.abs(ix) !== ring && Math.abs(iz) !== ring) continue;
                    const candidate = {
                        id,
                        x: clamp(baseX + ix * step, minX, maxX),
                        z: clamp(baseZ + iz * step, minZ, maxZ),
                        halfX,
                        halfZ,
                        fixed: false
                    };
                    if (!layoutReservations.some((other) => rectanglesOverlap(candidate, other))) {
                        best = candidate;
                        break;
                    }
                }
            }
        }

        if (!best) {
            // A safe fallback is still clamped inside the room and reported.
            best = { id, x: baseX, z: baseZ, halfX, halfZ, fixed: false };
            console.warn(`[layout] No collision-free slot found for ${id}; using clamped preferred position.`);
        }
        layoutReservations.push(best);
        return best;
    }

    const floorLayout = {
        bed: solveFloorPlacement('bed', -4.72, -1.72, 1.18, 1.66),
        desk: solveFloorPlacement('desk', 4.18, 3.55, 1.68, 1.38),
        fridge: solveFloorPlacement('fridge', 5.22, 0.35, 0.54, 0.58),
        piano: solveFloorPlacement('piano', -4.34, 4.08, 0.72, 1.52)
    };

    function trackCullable(object, radius = 1.5) {
        cullables.push({ object, radius });
        return object;
    }

    function makeCanvasTexture(width, height, draw, repeatX = 1, repeatY = 1) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        draw(ctx, width, height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
        texture.anisotropy = 4;
        return texture;
    }

    const wallpaperTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#565263';
        ctx.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 32) {
            ctx.fillStyle = x % 64 === 0 ? '#605a70' : '#4b4857';
            ctx.fillRect(x, 0, 5, h);
            ctx.fillStyle = '#746f82';
            ctx.fillRect(x + 14, 0, 1, h);
        }
        ctx.strokeStyle = 'rgba(225,220,240,0.16)';
        ctx.lineWidth = 2;
        for (let y = 22; y < h; y += 52) {
            for (let x = 18; x < w; x += 52) {
                ctx.beginPath();
                ctx.moveTo(x, y - 8);
                ctx.lineTo(x + 8, y);
                ctx.lineTo(x, y + 8);
                ctx.lineTo(x - 8, y);
                ctx.closePath();
                ctx.stroke();
            }
        }
    }, 4, 2);

    const floorTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#24272b';
        ctx.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 64) {
            for (let x = 0; x < w; x += 64) {
                const shade = ((x / 64 + y / 64) % 2) ? '#2d3035' : '#202328';
                ctx.fillStyle = shade;
                ctx.fillRect(x + 2, y + 2, 60, 60);
                const grad = ctx.createLinearGradient(x, y, x + 64, y + 64);
                grad.addColorStop(0, 'rgba(255,255,255,0.16)');
                grad.addColorStop(0.4, 'rgba(255,255,255,0.03)');
                grad.addColorStop(1, 'rgba(0,0,0,0.18)');
                ctx.fillStyle = grad;
                ctx.fillRect(x + 2, y + 2, 60, 60);
            }
        }
        ctx.strokeStyle = '#111419';
        ctx.lineWidth = 3;
        for (let i = 0; i <= w; i += 64) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(w, i);
            ctx.stroke();
        }
    }, 4, 4);

    const ceilingTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#25232d';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#363342';
        ctx.lineWidth = 4;
        for (let x = 0; x <= w; x += 64) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y <= h; y += 64) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(18, 18, 28, 28);
        ctx.fillRect(146, 146, 28, 28);
    }, 4, 4);

    const woodTex = makeCanvasTexture(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#654632';
        ctx.fillRect(0, 0, w, h);
        for (let y = 8; y < h; y += 18) {
            ctx.strokeStyle = y % 36 === 8 ? '#7b563d' : '#4d3528';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 0; x < w; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.08 + y) * 4);
            ctx.stroke();
        }
    }, 2, 1);

    // Materials
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x777184, map: wallpaperTex, roughness: 0.78 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x5f5b70, map: ceilingTex, roughness: 0.7 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: floorTex, roughness: 0.18, metalness: 0.28 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTex, roughness: 0.55 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x263646, roughness: 0.72 });
    const blanketMat = new THREE.MeshStandardMaterial({ color: 0x516b88, roughness: 0.68 });
    const plasticMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
    const screenOffMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.1 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.7 });
    const catOrangeMat = new THREE.MeshStandardMaterial({ color: 0xe8873a, roughness: 0.9 });

    // ============ ROOM SHELL ============
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, ROOM_CENTER_Z);
    scene.add(floor);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 4, ROOM_CENTER_Z);
    scene.add(ceiling);

    const wallGeo = new THREE.PlaneGeometry(ROOM_WIDTH, 4);
    const wallBack = new THREE.Mesh(wallGeo, wallMat);
    wallBack.position.set(0, 2, ROOM_BACK_Z);
    scene.add(wallBack);

    const wallFront = new THREE.Mesh(wallGeo, wallMat);
    wallFront.position.set(0, 2, ROOM_FRONT_Z);
    wallFront.rotation.y = Math.PI;
    scene.add(wallFront);

    const wallRight = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, 4), wallMat);
    wallRight.position.set(ROOM_HALF_X, 2, ROOM_CENTER_Z);
    wallRight.rotation.y = -Math.PI / 2;
    scene.add(wallRight);

    const wallLeft = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, 4), wallMat);
    wallLeft.position.set(-ROOM_HALF_X, 2, ROOM_CENTER_Z);
    wallLeft.rotation.y = Math.PI / 2;
    scene.add(wallLeft);

    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2220, roughness: 0.45 });
    const addTrim = (mesh) => scene.add(mesh);
    const backBase = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.12, 0.08), trimMat);
    backBase.position.set(0, 0.08, ROOM_BACK_Z + 0.04);
    addTrim(backBase);
    const frontBase = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.12, 0.08), trimMat);
    frontBase.position.set(0, 0.08, ROOM_FRONT_Z - 0.04);
    addTrim(frontBase);
    const leftBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, ROOM_DEPTH), trimMat);
    leftBase.position.set(-ROOM_HALF_X + 0.04, 0.08, ROOM_CENTER_Z);
    addTrim(leftBase);
    const rightBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, ROOM_DEPTH), trimMat);
    rightBase.position.set(ROOM_HALF_X - 0.04, 0.08, ROOM_CENTER_Z);
    addTrim(rightBase);
    const backCrown = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.08, 0.08), trimMat);
    backCrown.position.set(0, 3.92, ROOM_BACK_Z + 0.04);
    addTrim(backCrown);
    const frontCrown = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.08, 0.08), trimMat);
    frontCrown.position.set(0, 3.92, ROOM_FRONT_Z - 0.04);
    addTrim(frontCrown);
    const leftCrown = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, ROOM_DEPTH), trimMat);
    leftCrown.position.set(-ROOM_HALF_X + 0.04, 3.92, ROOM_CENTER_Z);
    addTrim(leftCrown);
    const rightCrown = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, ROOM_DEPTH), trimMat);
    rightCrown.position.set(ROOM_HALF_X - 0.04, 3.92, ROOM_CENTER_Z);
    addTrim(rightCrown);

    const ceilingPanelMat = new THREE.MeshStandardMaterial({ color: 0xb7c6d6, emissive: 0x7ea8ff, emissiveIntensity: 0.18, roughness: 0.35 });
    for (const x of [-1.4, 1.4]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.035, 0.42), ceilingPanelMat);
        panel.position.set(x, 3.975, -0.35);
        scene.add(panel);
        const glow = new THREE.PointLight(0xbfd8ff, 0.55, 5.5, 2);
        optionalLights.push(glow);
        glow.position.set(x, 3.65, -0.35);
        scene.add(glow);
    }

    // ============ WALL SCONCE LIGHTS (Performance optimized) ============
    const allWallSconces = [];
    function createWallLight(x, y, z, rotY) {
        const sconce = new THREE.Group();
        sconce.position.set(x, y, z);
        sconce.rotation.y = rotY;

        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.1), metalMat);
        sconce.add(bracket);

        const shade = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.12, 0.15, 8),
            new THREE.MeshStandardMaterial({ color: 0xffeecc, emissive: 0xffddaa, emissiveIntensity: 0.8 })
        );
        shade.position.set(0, -0.1, 0.05);
        sconce.add(shade);
        
        allWallSconces.push({ shadeMat: shade.material });
        scene.add(sconce);
    }

    createWallLight(-5.9, 3, 4.0, Math.PI / 2);
    createWallLight(-5.9, 3, -3.4, Math.PI / 2);
    createWallLight(5.9, 3, 3.4, -Math.PI / 2);
    createWallLight(5.9, 3, -3.8, -Math.PI / 2);
    createWallLight(0, 3, -7.9, 0);

    // Single central room light instead of 4 separate point lights (Massive performance boost)
    const roomLight = new THREE.PointLight(0xffddaa, 3.2, 22, 1);
    roomLight.position.set(0, 3, 0);
    scene.add(roomLight);

    // ============ WALL SWITCHES ============
    const switchGroup = new THREE.Group();
    switchGroup.position.set(1.5, 1.4, ROOM_FRONT_Z - 0.07);
    
    // Panel (made brighter so it's visible)
    const switchPanel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.02), new THREE.MeshStandardMaterial({ color: 0xcccccc, emissive: 0x222222 }));
    switchGroup.add(switchPanel);
    
    // Light Switch (using basic material so it glows in the dark)
    const lightSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lightSwitch.position.set(-0.1, 0, 0.02);
    lightSwitch.rotation.x = -0.3; // start ON
    switchGroup.add(lightSwitch);
    
    // Fan Switch
    const fanSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    fanSwitch.position.set(0.1, 0, 0.02);
    fanSwitch.rotation.x = 0.3; // start OFF
    switchGroup.add(fanSwitch);
    
    scene.add(switchGroup);
    
    let lightsOn = true;
    let lightColorMode = 0; // 0=Warm, 1=Cool, 2=Party
    const lightColors = [0xffddaa, 0xaaddff, 0xff55aa];
    
    // Animation targets for switches
    let targetLightSwitchRot = -0.3;
    let targetFanSwitchRot = 0.3;

    updatables.push({
        update: (dt) => {
            lightSwitch.rotation.x += (targetLightSwitchRot - lightSwitch.rotation.x) * 15 * dt;
            fanSwitch.rotation.x += (targetFanSwitchRot - fanSwitch.rotation.x) * 15 * dt;
        }
    });

    interactables.push({
        mesh: lightSwitch,
        action: () => {
            if (sfx) sfx.play('switch');
            lightsOn = !lightsOn;
            if (lightsOn) {
                lightColorMode = (lightColorMode + 1) % 3;
                const col = lightColors[lightColorMode];
                roomLight.color.setHex(col);
                roomLight.intensity = 3.2;
                for (const wl of allWallSconces) wl.shadeMat.emissive.setHex(col);
                showMessage(lightColorMode === 0 ? "Warm lights." : lightColorMode === 1 ? "Cool lights." : "Party lights!");
                targetLightSwitchRot = -0.3;
            } else {
                roomLight.intensity = 0;
                for (const wl of allWallSconces) wl.shadeMat.emissive.setHex(0x000000);
                showMessage("Lights off.");
                targetLightSwitchRot = 0.3;
            }
        },
        label: "Toggle Room Lights"
    });
    
    let fanSpeed = 0;
    const fanSpeeds = [0, 1.5, 4, 10];
    let fanCurrentRPM = 0;

    interactables.push({
        mesh: fanSwitch,
        action: () => {
            if (sfx) sfx.play('switch');
            fanSpeed = (fanSpeed + 1) % 4;
            const labels = ["Fan off.", "Fan: slow.", "Fan: medium.", "Fan: fast!"];
            showMessage(labels[fanSpeed]);
            targetFanSwitchRot = (fanSpeed === 0) ? 0.3 : -0.3;
            updateFanHum();
        },
        label: "Toggle Ceiling Fan"
    });

    // ============ SOUND HELPERS ============
    let lastMeowTime = 0;
    function playCatSound() {
        const now = Date.now();
        if (now - lastMeowTime < 2000) return;
        lastMeowTime = now;
        const variants = ['meow1', 'meow2', 'meow3'];
        const m = variants[Math.floor(Math.random() * variants.length)];
        if (sfx) sfx.play(m);
    }

    let fanHumNode = null;
    function updateFanHum() {
        if (fanSpeed > 0 && !fanHumNode && sfx) {
            fanHumNode = sfx.play('fan', true, 0.15);
        } else if (fanSpeed === 0 && fanHumNode) {
            try { fanHumNode.source.stop(); } catch(e) {}
            fanHumNode = null;
        }
    }

    let rainAudioNode = null;
    let fadeOutTimeout = null;
    function toggleRainAudio(play) {
        if (!audioCtx) return;
        
        if (play && sfx) {
            if (fadeOutTimeout) {
                clearTimeout(fadeOutTimeout);
                fadeOutTimeout = null;
            }
            if (!rainAudioNode) {
                rainAudioNode = sfx.play('rain', true, 0); // Start at 0 volume
                if (rainAudioNode) {
                    rainAudioNode.gain.gain.setValueAtTime(0, audioCtx.currentTime);
                    rainAudioNode.gain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 2.0); // 2 sec fade in
                }
            } else {
                // If already playing, just ramp up again
                rainAudioNode.gain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 2.0);
            }
        } else if (rainAudioNode) {
            // Fade out
            rainAudioNode.gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.0); // 2 sec fade out
            
            fadeOutTimeout = setTimeout(() => {
                if (rainAudioNode) {
                    try { rainAudioNode.source.stop(); } catch(e) {}
                    rainAudioNode = null;
                }
            }, 2000);
        }
    }

    // ============ WINDOW RAIN SYSTEM ============
    const windowGroup = new THREE.Group();
    windowGroup.position.set(-5.93, 2.2, -2.1);
    windowGroup.rotation.y = Math.PI / 2;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5 });
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), frameMat);
    frameTop.position.y = 0.8;
    windowGroup.add(frameTop);
    const frameBot = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), frameMat);
    frameBot.position.y = -0.8;
    windowGroup.add(frameBot);
    const frameLeftW = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), frameMat);
    frameLeftW.position.x = -1.05;
    windowGroup.add(frameLeftW);
    const frameRightW = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), frameMat);
    frameRightW.position.x = 1.05;
    windowGroup.add(frameRightW);
    const frameMid = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.1), frameMat);
    windowGroup.add(frameMid);

    const glassMat = new THREE.MeshStandardMaterial({
        color: 0x2a3a5a,
        emissive: 0x2a3a5a,
        emissiveIntensity: 0.6,
        roughness: 0.05,
        metalness: 0.3,
        transparent: true,
        opacity: 0.85
    });
    const paneL = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.5), glassMat);
    paneL.position.set(-0.525, 0, 0.01);
    windowGroup.add(paneL);
    const paneR = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.5), glassMat);
    paneR.position.set(0.525, 0, 0.01);
    windowGroup.add(paneR);

    const curtainMat = new THREE.MeshStandardMaterial({ color: 0x182443, roughness: 0.86 });
    const curtainRod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.55, 16), metalMat);
    curtainRod.rotation.z = Math.PI / 2;
    curtainRod.position.set(0, 0.98, 0.08);
    windowGroup.add(curtainRod);
    for (const side of [-1, 1]) {
        const curtain = new THREE.Group();
        curtain.position.set(side * 0.88, 0.02, 0.09);
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.72, 0.045), curtainMat);
        curtain.add(cloth);
        for (let i = -1; i <= 1; i++) {
            const fold = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.74, 0.075), new THREE.MeshStandardMaterial({ color: i === 0 ? 0x23315a : 0x111a31, roughness: 0.9 }));
            fold.position.set(i * 0.1, 0, 0.02);
            curtain.add(fold);
        }
        windowGroup.add(curtain);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.12, 0.24), new THREE.MeshStandardMaterial({ color: 0x2e2a2b, roughness: 0.5 }));
    sill.position.set(0, -0.94, 0.08);
    windowGroup.add(sill);
    const blindCord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.15, 8), new THREE.MeshStandardMaterial({ color: 0xd8d2bc, roughness: 0.7 }));
    blindCord.position.set(1.22, 0.13, 0.1);
    windowGroup.add(blindCord);

    const streetGlow = new THREE.PointLight(0xffcc66, 1.5, 12);
    optionalLights.push(streetGlow);
    streetGlow.position.set(0, -0.5, 0.5);
    windowGroup.add(streetGlow);
    scene.add(windowGroup);
    trackCullable(windowGroup, 1.9);

    // Rain Particles
    const rainCount = 800;
    const rainGeo = new THREE.BufferGeometry();
    const rainPositions = new Float32Array(rainCount * 3);
    for(let i=0; i<rainCount; i++) {
        // Position outside the window on the expanded castle wall.
        rainPositions[i*3] = -6.2 - Math.random() * 4; // X from -6.2 to -10.2
        rainPositions[i*3+1] = Math.random() * 8; // Y from 0 to 8
        rainPositions[i*3+2] = -2.1 + (Math.random() - 0.5) * 6; // near the moved window
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rainMat = new THREE.PointsMaterial({ color: 0x99aaff, size: 0.03, transparent: true, opacity: 0.6 });
    const rainSystem = new THREE.Points(rainGeo, rainMat);
    rainSystem.visible = false;
    scene.add(rainSystem);

    let isRaining = false;
    function toggleRain() {
        if (window.reportRoomSpam?.('window')) return;
        isRaining = !isRaining;
        rainSystem.visible = isRaining;
        toggleRainAudio(isRaining);
        showMessage(isRaining ? "It started raining outside." : "The rain stopped.");
    }

    updatables.push({
        update: (dt) => {
            if (!isRaining || !windowGroup.visible) return;
            const pos = rainGeo.attributes.position.array;
            const step = performanceOptions.quality === 'performance' ? 2 : 1;
            for(let i=0; i<rainCount; i += step) {
                pos[i*3+1] -= 12 * dt; // fall down fast
                if (pos[i*3+1] < 0) {
                    pos[i*3+1] = 8;
                }
            }
            rainGeo.attributes.position.needsUpdate = true;
        }
    });

    interactables.push({ mesh: paneL, action: toggleRain, label: "Look Outside" });
    interactables.push({ mesh: paneR, action: toggleRain, label: "Look Outside" });

    // ============ BED ============
    const bedGroup = new THREE.Group();
    bedGroup.position.set(floorLayout.bed.x, 0, floorLayout.bed.z);

    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2, 0.45, 3), woodMat);
    bedFrame.position.y = 0.25;
    bedGroup.add(bedFrame);

    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.3, 2.88), bedMat);
    mattress.position.y = 0.65;
    bedGroup.add(mattress);

    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.22, 1.72), blanketMat);
    blanket.position.set(0, 0.84, 0.42);
    bedGroup.add(blanket);
    const blanketStripeMat = new THREE.MeshStandardMaterial({ color: 0x7dd6ff, emissive: 0x155d83, emissiveIntensity: 0.18, roughness: 0.45 });
    for (const x of [-0.58, 0, 0.58]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.025, 1.76), blanketStripeMat);
        stripe.position.set(x, 0.965, 0.42);
        bedGroup.add(stripe);
    }

    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.16, 0.52), new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.8 }));
    pillow.position.set(-0.42, 0.94, -1.0);
    bedGroup.add(pillow);
    const pillow2 = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.45), new THREE.MeshStandardMaterial({ color: 0xbfd6ea, roughness: 0.82 }));
    pillow2.position.set(0.45, 0.93, -1.03);
    bedGroup.add(pillow2);
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(2.08, 1.15, 0.16), new THREE.MeshStandardMaterial({ color: 0x221819, roughness: 0.48 }));
    headboard.position.set(0, 0.78, 1.43);
    bedGroup.add(headboard);
    const headGlow = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.035, 0.04), new THREE.MeshBasicMaterial({ color: 0x36d6ff }));
    headGlow.position.set(0, 1.2, 1.34);
    bedGroup.add(headGlow);
    const bedUnderglow = new THREE.PointLight(0x36d6ff, 0.65, 2.4, 2);
    optionalLights.push(bedUnderglow);
    bedUnderglow.position.set(0, 0.3, 0.3);
    bedGroup.add(bedUnderglow);
    for (const x of [-1.08, 1.08]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 3.05), new THREE.MeshStandardMaterial({ color: 0x2a1f20, roughness: 0.5 }));
        rail.position.set(x, 0.48, 0);
        bedGroup.add(rail);
    }

    scene.add(bedGroup);
    trackCullable(bedGroup, 2.6);

    // ============ PROCEDURAL RADIO ============
    const radioGroup = new THREE.Group();
    // On the gaming desk beside the PC tower, not beside the bed.
    // Fridge top is around y=1.40, so the radio sits above it without clipping.
    radioGroup.position.set(floorLayout.fridge.x, 1.56, floorLayout.fridge.z);
    radioGroup.rotation.y = 0;
    const radioBodyMat = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.42, metalness: 0.12 });
    const radioFaceMat = new THREE.MeshStandardMaterial({ color: 0x253044, roughness: 0.34, metalness: 0.18 });
    const radioGlowMat = new THREE.MeshBasicMaterial({ color: 0x36d6ff });
    const radioBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.32, 0.22), radioBodyMat);
    radioGroup.add(radioBody);
    const radioFace = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.21, 0.018), radioFaceMat);
    radioFace.position.z = -0.118;
    radioGroup.add(radioFace);
    for (const x of [-0.16, -0.08, 0, 0.08, 0.16]) {
        const grille = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.012), metalMat);
        grille.position.set(x, 0.005, -0.132);
        radioGroup.add(grille);
    }
    const radioDial = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.026, 18), radioGlowMat);
    radioDial.rotation.x = Math.PI / 2;
    radioDial.position.set(0.25, 0.05, -0.135);
    radioGroup.add(radioDial);
    const radioAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.48, 8), metalMat);
    radioAntenna.rotation.z = -0.55;
    radioAntenna.position.set(-0.27, 0.32, 0.02);
    radioGroup.add(radioAntenna);
    const radioLight = new THREE.PointLight(0x36d6ff, 0, 1.5, 2);
    optionalLights.push(radioLight);
    radioLight.position.set(0, 0.12, -0.18);
    radioGroup.add(radioLight);
    scene.add(radioGroup);
    trackCullable(radioGroup, 0.8);

    let radioStation = 0;
    let radioNodes = [];
    let radioTimer = null;
    const radioStations = ['off', 'lofi', 'synthwave', 'rain hum'];

    function stopRadio() {
        if (radioTimer) {
            clearInterval(radioTimer);
            radioTimer = null;
        }
        for (const node of radioNodes) {
            try { node.stop?.(); } catch {}
            try { node.disconnect?.(); } catch {}
        }
        radioNodes = [];
        radioLight.intensity = 0;
        radioGlowMat.color.setHex(0x36d6ff);
    }

    function makeNoiseSource(volume, filterFreq) {
        if (!audioCtx) return null;
        const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.36;
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        const gain = audioCtx.createGain();
        gain.gain.value = volume;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        source.start();
        radioNodes.push(source, filter, gain);
        return source;
    }

    function startRadioStation(index) {
        stopRadio();
        radioStation = index;
        const name = radioStations[radioStation];
        if (name === 'off') {
            showMessage('Radio off.');
            return;
        }
        if (!audioCtx) {
            showMessage('Radio needs audio unlocked first. Click Enter Room again if needed.');
            return;
        }
        const master = audioCtx.createGain();
        master.gain.value = name === 'rain hum' ? 0.16 : 0.075;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = name === 'synthwave' ? 1200 : 760;
        filter.connect(master);
        master.connect(audioCtx.destination);
        radioNodes.push(master, filter);
        if (name === 'rain hum') {
            makeNoiseSource(0.12, 1150);
            const hum = audioCtx.createOscillator();
            hum.type = 'sine';
            hum.frequency.value = 80;
            hum.connect(filter);
            hum.start();
            radioNodes.push(hum);
            radioGlowMat.color.setHex(0x76d8ff);
        } else {
            const chords = name === 'lofi'
                ? [[196, 246.94, 329.63], [174.61, 220, 293.66], [164.81, 207.65, 261.63], [185, 233.08, 311.13]]
                : [[110, 220, 277.18], [130.81, 261.63, 329.63], [98, 196, 246.94], [146.83, 293.66, 369.99]];
            const oscs = chords[0].map((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = name === 'lofi' ? 'sine' : (i === 0 ? 'sawtooth' : 'triangle');
                osc.frequency.value = freq;
                gain.gain.value = i === 0 ? 0.46 : 0.22;
                osc.connect(gain);
                gain.connect(filter);
                osc.start();
                radioNodes.push(osc, gain);
                return osc;
            });
            let chordIndex = 0;
            radioTimer = setInterval(() => {
                if (!audioCtx) return;
                chordIndex = (chordIndex + 1) % chords.length;
                const now = audioCtx.currentTime;
                for (let i = 0; i < oscs.length; i++) {
                    oscs[i].frequency.cancelScheduledValues(now);
                    oscs[i].frequency.setTargetAtTime(chords[chordIndex][i], now, 0.08);
                }
            }, name === 'lofi' ? 1800 : 950);
            radioGlowMat.color.setHex(name === 'lofi' ? 0xffd36e : 0xff4fd8);
        }
        radioLight.color.setHex(name === 'lofi' ? 0xffd36e : name === 'synthwave' ? 0xff4fd8 : 0x76d8ff);
        radioLight.intensity = 0.55;
        showMessage(`Radio: ${name}. Procedural local stream playing.`);
    }

    function toggleRadio() {
        if (sfx) sfx.play('switch');
        startRadioStation((radioStation + 1) % radioStations.length);
    }

    interactables.push({ mesh: radioBody, action: toggleRadio, label: 'Tune Radio' });
    interactables.push({ mesh: radioDial, action: toggleRadio, label: 'Tune Radio' });
    updatables.push({
        update: (dt) => {
            if (radioStation === 0 || !radioGroup.visible) return;
            radioDial.rotation.z += dt * 1.8;
            radioLight.intensity = 0.38 + Math.sin(performance.now() * 0.006) * 0.12;
        }
    });

    // ============ DESK ============
    const deskGroup = new THREE.Group();
    deskGroup.position.set(floorLayout.desk.x, 0, floorLayout.desk.z);

    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 1.5), woodMat);
    deskTop.position.y = 0.9;
    deskGroup.add(deskTop);

    const deskLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.3), woodMat);
    deskLeg1.position.set(-1.4, 0.45, 0);
    deskGroup.add(deskLeg1);

    const deskLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.3), woodMat);
    deskLeg2.position.set(1.4, 0.45, 0);
    deskGroup.add(deskLeg2);

    // Gaming PC Tower
    const pcGroup = new THREE.Group();
    pcGroup.position.set(-1.16, 1.24, 0.04);
    const pcCaseMat = new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.28, metalness: 0.25 });
    const pcFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.82), pcCaseMat);
    pcGroup.add(pcFrame);
    const glassSide = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.64),
        new THREE.MeshStandardMaterial({ color: 0x8adfff, roughness: 0.02, metalness: 0.15, transparent: true, opacity: 0.28 })
    );
    glassSide.position.set(0, 0, 0.416);
    pcGroup.add(glassSide);
    const pcTrimMat = new THREE.MeshBasicMaterial({ color: 0x36d6ff });
    const pcLedParts = [];
    for (const y of [-0.34, 0.34]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.018, 0.018), pcTrimMat.clone());
        strip.position.set(0, y, 0.43);
        pcGroup.add(strip);
        pcLedParts.push(strip);
    }
    for (const x of [-0.24, 0.24]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.68, 0.018), pcTrimMat.clone());
        strip.position.set(x, 0, 0.43);
        pcGroup.add(strip);
        pcLedParts.push(strip);
    }
    const pcFans = [];
    for (const y of [-0.17, 0.16]) {
        const fanGroup = new THREE.Group();
        fanGroup.position.set(-0.14, y, 0.435);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 8, 24), new THREE.MeshBasicMaterial({ color: 0x36d6ff }));
        fanGroup.add(ring);
        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.075, 0.01), new THREE.MeshBasicMaterial({ color: 0xb8f4ff }));
            blade.position.y = 0.035;
            const pivot = new THREE.Group();
            pivot.rotation.z = i * Math.PI * 2 / 3;
            pivot.add(blade);
            fanGroup.add(pivot);
        }
        pcGroup.add(fanGroup);
        pcFans.push(fanGroup);
    }
    const gpu = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.08, 0.18), new THREE.MeshStandardMaterial({ color: 0x202633, roughness: 0.35, metalness: 0.2 }));
    gpu.position.set(0.06, -0.09, 0.33);
    pcGroup.add(gpu);
    const gpuLight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.018, 0.02), new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
    gpuLight.position.set(0.06, -0.04, 0.425);
    pcGroup.add(gpuLight);
    pcLedParts.push(gpuLight);
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.6 });
    for (const x of [-0.06, 0.04, 0.14]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.42, 8), cableMat);
        cable.rotation.x = Math.PI / 2;
        cable.position.set(x, 0.16, 0.26);
        pcGroup.add(cable);
    }
    const pcRgbLight = new THREE.PointLight(0x36d6ff, 0.65, 2.2, 2);
    optionalLights.push(pcRgbLight);
    pcRgbLight.position.set(-0.1, 0, 0.5);
    pcGroup.add(pcRgbLight);
    let pcRgbOn = true;
    let pcBurstRecovering = false;
    function setPcRgb(on) {
        pcRgbOn = on;
        pcRgbLight.intensity = pcRgbOn ? 0.65 : 0;
        for (const part of pcLedParts) part.visible = pcRgbOn;
        for (const fan of pcFans) fan.visible = pcRgbOn;
    }
    deskGroup.add(pcGroup);

    const pcSystem = createPCSystem({ showMessage });
    pcSystem.setPreviewMode('still');
    const pcScreenTex = new THREE.CanvasTexture(pcSystem.previewCanvas);
    pcScreenTex.colorSpace = THREE.SRGBColorSpace;
    pcScreenTex.minFilter = THREE.LinearFilter;
    pcScreenTex.magFilter = THREE.LinearFilter;

    // Frameless AMOLED-style monitor
    const monitorGroup = new THREE.Group();
    monitorGroup.position.set(0, 1.3, -0.4);

    const monitorStand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.12), plasticMat);
    monitorStand.position.y = -0.15;
    monitorGroup.add(monitorStand);

    const monitorBase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 0.28), plasticMat);
    monitorBase.position.set(0, -0.35, 0.02);
    monitorGroup.add(monitorBase);

    const monitorScreen = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.74, 0.035), new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.08, metalness: 0.2 }));
    monitorScreen.position.z = 0.1; // move in front of stand
    monitorGroup.add(monitorScreen);

    const screenFront = new THREE.Mesh(
        new THREE.PlaneGeometry(1.22, 0.68),
        new THREE.MeshBasicMaterial({ map: pcScreenTex })
    );
    screenFront.position.z = 0.121; // move in front of screen body
    monitorGroup.add(screenFront);
    const monitorGlow = new THREE.PointLight(0x4aa3ff, 0.28, 2.4, 2);
    optionalLights.push(monitorGlow);
    monitorGlow.position.set(0, 0, 0.22);
    monitorGroup.add(monitorGlow);

    deskGroup.add(monitorGroup);

    const mousePad = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.014, 0.46), new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.55 }));
    mousePad.position.set(0.32, 0.962, 0.27);
    deskGroup.add(mousePad);
    const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.032, 0.24), new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.35 }));
    keyboard.position.set(0.02, 0.992, 0.17);
    deskGroup.add(keyboard);
    const keyGlowMat = new THREE.MeshBasicMaterial({ color: 0x36d6ff });
    const keyDarkMat = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.4 });
    for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 10; i++) {
            const mat = (i + row) % 4 === 0 ? keyGlowMat : keyDarkMat;
            const key = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.012, 0.032), mat);
            key.position.set(-0.31 + i * 0.062 + row * 0.012, 1.017, 0.075 + row * 0.052);
            deskGroup.add(key);
        }
    }
    const spacebar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.035), new THREE.MeshStandardMaterial({ color: 0x202633, roughness: 0.35 }));
    spacebar.position.set(0.0, 1.018, 0.25);
    deskGroup.add(spacebar);
    const keyboardCable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8), cableMat);
    keyboardCable.rotation.x = Math.PI / 2;
    keyboardCable.position.set(0.0, 1.005, -0.08);
    deskGroup.add(keyboardCable);

    const mouseGroup = new THREE.Group();
    mouseGroup.position.set(0.78, 1.012, 0.21);
    mouseGroup.rotation.y = -0.12;
    const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.055, 0.24), new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.25 }));
    mouseGroup.add(mouse);
    const mouseTop = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.16), new THREE.MeshStandardMaterial({ color: 0x191c25, roughness: 0.25 }));
    mouseTop.position.y = 0.035;
    mouseGroup.add(mouseTop);
    const mouseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.028, 10), new THREE.MeshBasicMaterial({ color: 0x36d6ff }));
    mouseWheel.rotation.x = Math.PI / 2;
    mouseWheel.position.set(0, 0.052, -0.035);
    mouseGroup.add(mouseWheel);
    const mouseGlow = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.01, 0.015), new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
    mouseGlow.position.set(0, 0.053, 0.105);
    mouseGroup.add(mouseGlow);
    const mouseCable = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.36, 8), cableMat);
    mouseCable.rotation.x = Math.PI / 2;
    mouseCable.position.set(0, 0.01, -0.24);
    mouseGroup.add(mouseCable);
    deskGroup.add(mouseGroup);

    const pcBurstPieces = [];
    function triggerPcBurst() {
        if (pcBurstPieces.length) return;
        const origin = new THREE.Vector3();
        pcGroup.getWorldPosition(origin);
        const partMat = [
            new THREE.MeshBasicMaterial({ color: 0x36d6ff }),
            new THREE.MeshBasicMaterial({ color: 0xff4fd8 }),
            new THREE.MeshBasicMaterial({ color: 0xfff06b }),
            new THREE.MeshStandardMaterial({ color: 0x171a22, roughness: 0.35, metalness: 0.45 })
        ];
        for (let i = 0; i < 26; i++) {
            const size = 0.035 + Math.random() * 0.07;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size * (0.5 + Math.random()), size), partMat[i % partMat.length]);
            mesh.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.28, (Math.random() - 0.2) * 0.34, (Math.random() - 0.5) * 0.28));
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            scene.add(mesh);
            pcBurstPieces.push({
                mesh,
                life: 0,
                maxLife: 1.35 + Math.random() * 0.55,
                vel: new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.2 + Math.random() * 2.4, (Math.random() - 0.5) * 2.4),
                rot: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9)
            });
        }
        pcBurstRecovering = true;
        setPcRgb(false);
        showMessage('PC RGB overload! It pops apart, then snaps back together.');
    }

    updatables.push({
        update: (dt) => {
            for (let i = pcBurstPieces.length - 1; i >= 0; i--) {
                const part = pcBurstPieces[i];
                part.life += dt;
                part.vel.y -= 4.6 * dt;
                part.mesh.position.addScaledVector(part.vel, dt);
                part.mesh.rotation.x += part.rot.x * dt;
                part.mesh.rotation.y += part.rot.y * dt;
                part.mesh.rotation.z += part.rot.z * dt;
                part.mesh.scale.setScalar(Math.max(0, 1 - Math.max(0, part.life - part.maxLife * 0.62) / (part.maxLife * 0.38)));
                if (part.life >= part.maxLife) {
                    scene.remove(part.mesh);
                    part.mesh.geometry.dispose();
                    pcBurstPieces.splice(i, 1);
                }
            }
            if (!pcBurstPieces.length && pcBurstRecovering) {
                pcBurstRecovering = false;
                setPcRgb(true);
            }
        }
    });

    const togglePcRgb = () => {
        if (sfx) sfx.play('switch');
        if (window.reportRoomSpam?.('rgb')) return;
        setPcRgb(!pcRgbOn);
        showMessage(pcRgbOn ? 'PC RGB glows on.' : 'PC RGB goes dark.');
    };
    const accessPc = () => {
        if (window.isSittingGamingChair !== true) {
            showMessage('Sit in the gaming chair to use the PC.');
            return;
        }
        if (sfx) sfx.play('pc');
        pcSystem.open();
    };
    interactables.push({ mesh: pcFrame, action: togglePcRgb, label: "Toggle PC RGB" });
    interactables.push({ mesh: glassSide, action: togglePcRgb, label: "Toggle PC RGB" });
    interactables.push({ mesh: monitorScreen, action: accessPc, label: "Access PC", canInteract: () => window.isSittingGamingChair === true });
    interactables.push({ mesh: screenFront, action: accessPc, label: "Access PC", canInteract: () => window.isSittingGamingChair === true });
    updatables.push({
        update: (dt) => {
            if (!pcRgbOn || !deskGroup.visible) return;
            for (const fan of pcFans) fan.rotation.z += dt * 5.5;
        }
    });
    updatables.push({
        update: (dt) => {
            pcSystem.update(dt);
            if (pcSystem.consumePreviewDirty()) pcScreenTex.needsUpdate = true;
            monitorGlow.intensity = pcSystem.isScreenLit() ? 0.5 : 0.08;
        }
    });

    // ============ CHAIR ============
    const chairGroup = new THREE.Group();
    chairGroup.position.set(0, 0, 1.0);

    const chairMat = new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.48 });
    const chairAccentMat = new THREE.MeshStandardMaterial({ color: 0x1fb8ff, emissive: 0x0a5c80, emissiveIntensity: 0.2, roughness: 0.42 });
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.13, 0.68), chairMat);
    chairSeat.position.y = 0.5;
    chairGroup.add(chairSeat);
    const seatCushion = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.055, 0.58), new THREE.MeshStandardMaterial({ color: 0x171a22, roughness: 0.82 }));
    seatCushion.position.y = 0.61;
    chairGroup.add(seatCushion);
    for (const x of [-0.37, 0.37]) {
        const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.64), chairAccentMat);
        bolster.position.set(x, 0.61, 0);
        chairGroup.add(bolster);
    }

    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.92, 0.12), chairMat);
    chairBack.position.set(0, 1.03, 0.31);
    chairBack.rotation.x = -0.12;
    chairGroup.add(chairBack);
    for (const x of [-0.39, 0.39]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.12), chairAccentMat);
        wing.position.set(x, 1.02, 0.28);
        wing.rotation.z = x < 0 ? 0.12 : -0.12;
        wing.rotation.x = -0.12;
        chairGroup.add(wing);
    }
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.08), chairAccentMat);
    headrest.position.set(0, 1.42, 0.24);
    headrest.rotation.x = -0.12;
    chairGroup.add(headrest);
    for (const x of [-0.46, 0.46]) {
        const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.34, 0.055), plasticMat);
        armPost.position.set(x, 0.73, -0.02);
        chairGroup.add(armPost);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.46), chairMat);
        arm.position.set(x, 0.91, -0.02);
        chairGroup.add(arm);
    }
    const gasLift = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.5, 16), metalMat);
    gasLift.position.y = 0.26;
    chairGroup.add(gasLift);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.055, 16), metalMat);
    hub.position.y = 0.08;
    chairGroup.add(hub);
    for (let i = 0; i < 5; i++) {
        const spokeGroup = new THREE.Group();
        spokeGroup.rotation.y = i * Math.PI * 2 / 5;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.58), metalMat);
        spoke.position.z = 0.24;
        spokeGroup.add(spoke);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 12), plasticMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0, -0.02, 0.52);
        spokeGroup.add(wheel);
        chairGroup.add(spokeGroup);
    }

    deskGroup.add(chairGroup);

    interactables.push({
        mesh: chairSeat,
        action: 'sit',
        label: "Sit Down",
        chairWorldPos: new THREE.Vector3(floorLayout.desk.x, 0, floorLayout.desk.z + 1.0),
        deskLookAt: new THREE.Vector3(floorLayout.desk.x, 1.3, floorLayout.desk.z - 0.4),
        chairSpinGroup: chairGroup,
        chairExitPos: new THREE.Vector3(floorLayout.desk.x - 1.01, 1.5, floorLayout.desk.z + 0.9)
    });
    interactables.push({
        mesh: chairBack,
        action: 'sit',
        label: "Sit Down",
        chairWorldPos: new THREE.Vector3(floorLayout.desk.x, 0, floorLayout.desk.z + 1.0),
        deskLookAt: new THREE.Vector3(floorLayout.desk.x, 1.3, floorLayout.desk.z - 0.4),
        chairSpinGroup: chairGroup,
        chairExitPos: new THREE.Vector3(floorLayout.desk.x - 1.01, 1.5, floorLayout.desk.z + 0.9)
    });

    // Lamp
    const lampGroup = new THREE.Group();
    lampGroup.position.set(1, 0.95, -0.5);

    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16), plasticMat);
    lampGroup.add(lampBase);

    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    lampShade.position.y = 0.3;
    lampGroup.add(lampShade);

    const deskLight = new THREE.PointLight(0xffaa55, 2.5, 12);
    optionalLights.push(deskLight);
    deskLight.position.set(0, 0.2, 0);
    // Keep this shadowless so the room stays smoother while looking around.
    deskLight.castShadow = false;
    lampGroup.add(deskLight);

    let lampOn = true;
    interactables.push({
        mesh: lampBase,
        action: () => {
            if (sfx) sfx.play('switch');
            lampOn = !lampOn;
            deskLight.intensity = lampOn ? 2.5 : 0;
            showMessage(lampOn ? "The lamp clicks on." : "The lamp clicks off.");
        },
        label: "Toggle Lamp"
    });
    interactables.push({
        mesh: lampShade,
        action: () => {
            if (sfx) sfx.play('lamp');
            lampOn = !lampOn;
            deskLight.intensity = lampOn ? 2.5 : 0;
            showMessage(lampOn ? "The lamp clicks on." : "The lamp clicks off.");
        },
        label: "Toggle Lamp"
    });

    deskGroup.add(lampGroup);
    scene.add(deskGroup);
    trackCullable(deskGroup, 2.7);

    // ============ DOOR ============
    const doorGroup = new THREE.Group();
    doorGroup.position.set(0, 0, ROOM_FRONT_Z - 0.05);

    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.1), woodMat);
    door.position.y = 1.2;
    doorGroup.add(door);

    const doorTrimMat = new THREE.MeshStandardMaterial({ color: 0x2b1d17, roughness: 0.55 });
    for (const y of [0.65, 1.45]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.52, 0.025), new THREE.MeshStandardMaterial({ color: 0x4a2d20, roughness: 0.6 }));
        panel.position.set(0, y, -0.065);
        doorGroup.add(panel);
    }
    const doorFrameTop = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.14), doorTrimMat);
    doorFrameTop.position.set(0, 2.46, -0.01);
    doorGroup.add(doorFrameTop);
    for (const x of [-0.68, 0.68]) {
        const frameSide = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.52, 0.14), doorTrimMat);
        frameSide.position.set(x, 1.25, -0.01);
        doorGroup.add(frameSide);
    }

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), metalMat);
    knob.position.set(0.45, 1.1, 0.06);
    doorGroup.add(knob);

    scene.add(doorGroup);
    trackCullable(doorGroup, 1.5);

    let doorShaking = false;
    function rattleDoor() {
        if (doorShaking) return;
        doorShaking = true;
        if (sfx) sfx.play('rattle');
        showMessage("Locked.");

        let shakeTime = 0;
        const shakeObj = {
            update: (dt) => {
                shakeTime += dt;
                doorGroup.position.x = Math.sin(shakeTime * 60) * 0.02;
                if (shakeTime > 0.3) {
                    doorGroup.position.x = 0;
                    doorShaking = false;
                    updatables.splice(updatables.indexOf(shakeObj), 1);
                }
            }
        };
        updatables.push(shakeObj);
    }

    interactables.push({ mesh: door, action: rattleDoor, label: "Try Door" });
    interactables.push({ mesh: knob, action: rattleDoor, label: "Try Door" });

    // ============ CEILING FAN ============
    const fanGroup = new THREE.Group();
    fanGroup.position.set(0, 3.9, 4.0);

    const fanMount = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.15, 12), metalMat);
    fanGroup.add(fanMount);

    const fanRod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), metalMat);
    fanRod.position.y = -0.3;
    fanGroup.add(fanRod);

    const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), metalMat);
    fanHub.position.y = -0.55;
    fanGroup.add(fanHub);

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x6b5b4b, roughness: 0.7 });
    const bladeGroup = new THREE.Group();
    bladeGroup.position.y = -0.55;
    for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 1.2), bladeMat);
        blade.position.z = 0.7;
        const pivot = new THREE.Group();
        pivot.rotation.y = (Math.PI / 2) * i;
        pivot.add(blade);
        bladeGroup.add(pivot);
    }
    fanGroup.add(bladeGroup);

    scene.add(fanGroup);
    trackCullable(fanGroup, 1.7);

    interactables.push({
        mesh: fanHub,
        action: 'hangFan',
        label: "Hang on Fan",
        fanGroup: fanGroup,
        bladeGroup: bladeGroup
    });

    updatables.push({
        update: (dt) => {
            if (!fanGroup.visible && fanSpeed === 0) return;
            const targetRPM = fanSpeeds[fanSpeed];
            fanCurrentRPM += (targetRPM - fanCurrentRPM) * 2 * dt;
            if (fanGroup.visible || fanCurrentRPM > 0.05) bladeGroup.rotation.y += fanCurrentRPM * dt;
        }
    });

    // ============ ORANGE CAT ============
    const catGroup = new THREE.Group();
    // Sleep directly on the blanket instead of floating in front of the bed.
    catGroup.position.set(floorLayout.bed.x + 0.34, 0.96, floorLayout.bed.z + 0.34);

    const catBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.7), catOrangeMat);
    catBody.position.y = 0.125;
    catGroup.add(catBody);

    const catHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), catOrangeMat);
    catHead.position.set(0, 0.22, -0.4);
    catGroup.add(catHead);

    const earMat = new THREE.MeshStandardMaterial({ color: 0xd07030 });
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), earMat);
    earL.position.set(-0.1, 0.4, -0.4);
    catGroup.add(earL);
    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), earMat);
    earR.position.set(0.1, 0.4, -0.4);
    catGroup.add(earR);

    const catTail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), catOrangeMat);
    catTail.position.set(0, 0.18, 0.55);
    catGroup.add(catTail);

    const catStripeMat = new THREE.MeshStandardMaterial({ color: 0xb95f20, roughness: 0.85 });
    for (const z of [-0.1, 0.08, 0.26]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.035), catStripeMat);
        stripe.position.set(0, 0.26, z);
        catGroup.add(stripe);
    }
    for (const x of [-0.15, 0.15]) {
        const pawFront = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.055, 0.14), new THREE.MeshStandardMaterial({ color: 0xffb16a, roughness: 0.88 }));
        pawFront.position.set(x, 0.035, -0.27);
        catGroup.add(pawFront);
        const pawBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.16), new THREE.MeshStandardMaterial({ color: 0xffb16a, roughness: 0.88 }));
        pawBack.position.set(x, 0.035, 0.24);
        catGroup.add(pawBack);
    }
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.035), new THREE.MeshBasicMaterial({ color: 0x2ee6ff }));
    collar.position.set(0, 0.22, -0.28);
    catGroup.add(collar);
    const tag = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffdf6e, metalness: 0.5, roughness: 0.25 }));
    tag.position.set(0, 0.18, -0.33);
    catGroup.add(tag);
    const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xf4eee0 });
    for (const side of [-1, 1]) {
        for (const y of [0.25, 0.29]) {
            const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.28, 6), whiskerMat);
            whisker.rotation.z = Math.PI / 2 + side * 0.18;
            whisker.position.set(side * 0.18, y, -0.55);
            catGroup.add(whisker);
        }
    }

    // Cat Digital Face
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = 128; faceCanvas.height = 64;
    const fctx = faceCanvas.getContext('2d');
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
    const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.125), faceMat);
    faceMesh.position.set(0, 0.28, -0.56);
    faceMesh.rotation.y = Math.PI; // Face outwards
        catGroup.add(faceMesh);
    
    let currentCatFace = '- w -';
    function updateCatFace(faceStr) {
        currentCatFace = faceStr;
        fctx.clearRect(0, 0, 128, 64);
        fctx.fillStyle = '#111';
        fctx.font = 'bold 32px monospace';
        fctx.textAlign = 'center';
        fctx.fillText(currentCatFace, 64, 42);
        faceTex.needsUpdate = true;
    }
    updateCatFace('- w -');
    scene.add(catGroup);
    trackCullable(catGroup, 1.0);
    const catHomePos = catGroup.position.clone();
    const zoomiePoints = [
        catHomePos.clone(),
        new THREE.Vector3(-1.15, 0.96, 1.32),
        new THREE.Vector3(1.4, 0.96, 1.05),
        new THREE.Vector3(2.65, 0.96, -0.95),
        new THREE.Vector3(0.1, 0.96, -1.55),
        catHomePos.clone()
    ];

    const catCamPos = new THREE.Vector3(floorLayout.bed.x + 1.42, 1.42, floorLayout.bed.z + 0.72);
    const catLookAt = new THREE.Vector3(floorLayout.bed.x + 0.34, 1.13, floorLayout.bed.z + 0.34);

    const triggerMeow = () => {
        if (sfx) {
            const r = Math.random();
            if (r < 0.33) sfx.play('meow1');
            else if (r < 0.66) sfx.play('meow2');
            else sfx.play('meow3');
        }
    };

    const beginPettingCat = () => {
        catState = 'petting';
        catStateTime = 0;
        updateCatFace('^ w ^');
        triggerMeow();
        showMessage('Meow!');
    };

    const oldPetCatAction = () => {
        if (catState !== 'petting') {
            if (window.startCinematic) {
                window.startCinematic('pet', catCamPos, catLookAt, () => {
                    catState = 'petting';
                    catStateTime = 0;
                    updateCatFace('^ w ^');
                    triggerMeow();
                });
            } else {
                catState = 'petting';
                catStateTime = 0;
                updateCatFace('^ w ^');
                triggerMeow();
            }
        }
    };

    const petCatAction = () => {
        if (catState === 'petting') return;
        if (window.startCinematic) {
            window.startCinematic('pet', catCamPos, catLookAt, beginPettingCat);
        } else {
            beginPettingCat();
        }
    };

    // Make cat interactable
    interactables.push({ mesh: catBody, action: petCatAction, label: 'Pet Cat' });
    interactables.push({ mesh: catHead, action: petCatAction, label: 'Pet Cat' });

    let catTimer = 0;
    let catState = 'sleeping';
    let catStateTime = 0;
    const catBreathBaseY = catBody.position.y;
    let playerRef = null; // Will be set from outside for cat tracking

    updatables.push({
        update: (dt) => {
            if (!catGroup.visible && catState !== 'tracking') return;
            catTimer += dt;
            catStateTime += dt;

            catBody.position.y = catBreathBaseY + Math.sin(catTimer * 2) * 0.015;
            catTail.rotation.y = Math.sin(catTimer * 1.5) * 0.15;
            earL.rotation.z = Math.sin(catTimer * 3.7) * 0.1;
            earR.rotation.z = -Math.sin(catTimer * 4.1) * 0.1;

            // Cat curiously tracks player when they're spinning on the fan
            if (catState === 'tracking') {
                if (playerRef) {
                    const catWorldPos = new THREE.Vector3();
                    catGroup.getWorldPosition(catWorldPos);
                    const dx = playerRef.x - catWorldPos.x;
                    const dz = playerRef.z - catWorldPos.z;
                    const targetAngle = Math.atan2(dx, dz) - Math.PI;
                    // Smooth lerp toward player
                    let diff = targetAngle - catHead.rotation.y;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    catHead.rotation.y += diff * 8 * dt;
                    // Slight tilt up to look at the ceiling
                    catHead.rotation.x += (0.3 - catHead.rotation.x) * 4 * dt;
                    // Excited tail wag while tracking
                    catTail.rotation.y = Math.sin(catTimer * 10) * 0.4;
                }
            } else if (catState === 'petting') {
                // Lean head into the pet and purr/vibrate slightly
                catHead.rotation.x = -0.2 + Math.sin(catTimer * 20) * 0.02;
                catHead.rotation.y = Math.sin(catTimer * 15) * 0.05;
                catTail.rotation.y = Math.sin(catTimer * 8) * 0.3; // Happy tail wag
                
                if (catStateTime > 2.0) { // Petting lasts 2 seconds
                    catState = 'sleeping';
                    catStateTime = 0;
                    catHead.rotation.x = 0;
                    catHead.rotation.y = 0;
                    updateCatFace('- w -');
                }
            } else {
                if (catState === 'sleeping' && catStateTime > 4 + Math.random() * 6) {
                    const r = Math.random();
                    if (r < 0.08) {
                        catState = 'zoomies';
                        updateCatFace('O_O');
                        triggerMeow();
                    } else if (r < 0.38) catState = 'looking';
                    else if (r < 0.68) catState = 'tailWag';
                    else catState = 'stretching';
                    catStateTime = 0;
                }

                if (catState === 'zoomies') {
                    const speed = 1.8;
                    const total = (zoomiePoints.length - 1) / speed;
                    const t = Math.min(catStateTime / total, 0.999);
                    const scaled = t * (zoomiePoints.length - 1);
                    const idx = Math.min(zoomiePoints.length - 2, Math.floor(scaled));
                    const local = scaled - idx;
                    catGroup.position.lerpVectors(zoomiePoints[idx], zoomiePoints[idx + 1], local);
                    const next = zoomiePoints[idx + 1];
                    const dx = next.x - catGroup.position.x;
                    const dz = next.z - catGroup.position.z;
                    if (Math.abs(dx) + Math.abs(dz) > 0.001) catGroup.rotation.y = Math.atan2(dx, dz);
                    catBody.position.y = catBreathBaseY + Math.abs(Math.sin(catTimer * 18)) * 0.055;
                    catTail.rotation.y = Math.sin(catTimer * 18) * 0.72;
                    if (catStateTime >= total) {
                        catGroup.position.copy(catHomePos);
                        catGroup.rotation.y = 0;
                        catBody.position.y = catBreathBaseY;
                        catState = 'sleeping';
                        catStateTime = 0;
                        updateCatFace('- w -');
                    }
                } else if (catState === 'looking') {
                    catHead.rotation.y = Math.sin(catTimer * 2) * 0.5;
                    if (catStateTime > 3) {
                        catHead.rotation.y = 0;
                        catState = 'sleeping';
                        catStateTime = 0;
                    }
                } else if (catState === 'tailWag') {
                    catTail.rotation.y = Math.sin(catTimer * 8) * 0.6;
                    if (catStateTime > 2.5) {
                        catState = 'sleeping';
                        catStateTime = 0;
                    }
                } else if (catState === 'stretching') {
                    catBody.scale.z = 1 + Math.sin(catStateTime * Math.PI / 2) * 0.2;
                    catBody.position.y = catBreathBaseY + Math.sin(catStateTime * Math.PI / 2) * 0.03;
                    if (catStateTime > 2) {
                        catBody.scale.z = 1;
                        catState = 'sleeping';
                        catStateTime = 0;
                    }
                } else if (catState === 'petting') {
                    catHead.rotation.x = Math.sin(catStateTime * 10) * 0.15;
                    if (catStateTime > 1) {
                        catHead.rotation.x = 0;
                        catState = 'sleeping';
                        catStateTime = 0;
                    }
                }
            }
        }
    });

    // ============ FULL DIGITAL PIANO ============
    const pianoGroup = new THREE.Group();
    pianoGroup.position.set(floorLayout.piano.x, 0, floorLayout.piano.z);
    pianoGroup.rotation.y = -Math.PI / 2;
    pianoGroup.scale.set(1.0, 1.0, 1.0);

    const pianoGlossMat = new THREE.MeshStandardMaterial({ color: 0x080706, roughness: 0.18, metalness: 0.08 });
    const pianoSideMat = new THREE.MeshStandardMaterial({ color: 0x11100e, roughness: 0.35, metalness: 0.02 });
    const redFeltMat = new THREE.MeshStandardMaterial({ color: 0x7f1414, roughness: 0.7 });

    const pianoBody = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.18, 0.88), pianoGlossMat);
    pianoBody.position.set(0, 1.03, 0.05);
    pianoGroup.add(pianoBody);

    const frontLip = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.12, 0.14), pianoSideMat);
    frontLip.position.set(0, 0.95, 0.47);
    pianoGroup.add(frontLip);

    const backRail = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.24, 0.12), pianoSideMat);
    backRail.position.set(0, 1.17, -0.42);
    pianoGroup.add(backRail);

    const leftCheek = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.95), pianoSideMat);
    leftCheek.position.set(-1.37, 1.08, 0.04);
    pianoGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.95), pianoSideMat);
    rightCheek.position.set(1.37, 1.08, 0.04);
    pianoGroup.add(rightCheek);

    const feltStrip = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.025, 0.08), redFeltMat);
    feltStrip.position.set(0, 1.19, -0.08);
    pianoGroup.add(feltStrip);

    for (const x of [-1.18, 1.18]) {
        for (const z of [-0.35, 0.42]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), metalMat);
            leg.position.set(x, 0.48, z);
            pianoGroup.add(leg);
        }
    }

    const pedalBar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.06), metalMat);
    pedalBar.position.set(0, 0.18, 0.55);
    pianoGroup.add(pedalBar);
    for (const x of [-0.18, 0, 0.18]) {
        const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.24), metalMat);
        pedal.position.set(x, 0.12, 0.68);
        pianoGroup.add(pedal);
    }

    const standBase = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.08, 0.08), pianoSideMat);
    standBase.position.set(0, 1.29, -0.34);
    pianoGroup.add(standBase);
    for (const x of [-0.86, 0.86]) {
        const standPost = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.06), pianoSideMat);
        standPost.position.set(x, 1.52, -0.39);
        standPost.rotation.x = -0.25;
        pianoGroup.add(standPost);
    }

    const pianoKeyDefs = [
        { label: 'Z', code: 'KeyZ', note: 'C4', freq: 261.63, whiteIndex: 0 },
        { label: 'S', code: 'KeyS', note: 'C#4', freq: 277.18, blackAfter: 0 },
        { label: 'X', code: 'KeyX', note: 'D4', freq: 293.66, whiteIndex: 1 },
        { label: 'D', code: 'KeyD', note: 'D#4', freq: 311.13, blackAfter: 1 },
        { label: 'C', code: 'KeyC', note: 'E4', freq: 329.63, whiteIndex: 2 },
        { label: 'V', code: 'KeyV', note: 'F4', freq: 349.23, whiteIndex: 3 },
        { label: 'G', code: 'KeyG', note: 'F#4', freq: 369.99, blackAfter: 3 },
        { label: 'B', code: 'KeyB', note: 'G4', freq: 392.0, whiteIndex: 4 },
        { label: 'H', code: 'KeyH', note: 'G#4', freq: 415.3, blackAfter: 4 },
        { label: 'N', code: 'KeyN', note: 'A4', freq: 440.0, whiteIndex: 5 },
        { label: 'J', code: 'KeyJ', note: 'A#4', freq: 466.16, blackAfter: 5 },
        { label: 'M', code: 'KeyM', note: 'B4', freq: 493.88, whiteIndex: 6 },
        { label: 'Q', code: 'KeyQ', note: 'C5', freq: 523.25, whiteIndex: 7 },
        { label: '2', code: 'Digit2', note: 'C#5', freq: 554.37, blackAfter: 7 },
        { label: 'W', code: 'KeyW', note: 'D5', freq: 587.33, whiteIndex: 8 },
        { label: '3', code: 'Digit3', note: 'D#5', freq: 622.25, blackAfter: 8 },
        { label: 'E', code: 'KeyE', note: 'E5', freq: 659.25, whiteIndex: 9 },
        { label: 'R', code: 'KeyR', note: 'F5', freq: 698.46, whiteIndex: 10 },
        { label: '5', code: 'Digit5', note: 'F#5', freq: 739.99, blackAfter: 10 },
        { label: 'T', code: 'KeyT', note: 'G5', freq: 783.99, whiteIndex: 11 },
        { label: '6', code: 'Digit6', note: 'G#5', freq: 830.61, blackAfter: 11 },
        { label: 'Y', code: 'KeyY', note: 'A5', freq: 880.0, whiteIndex: 12 },
        { label: '7', code: 'Digit7', note: 'A#5', freq: 932.33, blackAfter: 12 },
        { label: 'U', code: 'KeyU', note: 'B5', freq: 987.77, whiteIndex: 13 },
        { label: 'I', code: 'KeyI', note: 'C6', freq: 1046.5, whiteIndex: 14 }
    ];
    const pianoKeyMap = Object.fromEntries(pianoKeyDefs.map((key) => [key.code, key.freq]));
    pianoKeyMap.KeyA = pianoKeyMap.KeyZ;
    pianoKeyMap.Digit1 = pianoKeyMap.KeyZ;
    const pianoNoteMap = Object.fromEntries(pianoKeyDefs.map((key) => [key.note, key]));

    function createKeyMat(text, isBlack) {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = isBlack ? '#111111' : '#eeeeee';
        ctx.fillRect(0, 0, 64, 128);
        ctx.fillStyle = isBlack ? '#eeeeee' : '#111111';
        ctx.font = `bold ${text.length > 1 ? 30 : 38}px Arial`;
        ctx.textAlign = 'center';
        // Draw text near the bottom edge
        ctx.fillText(text, 32, 110);
        const tex = new THREE.CanvasTexture(canvas);
        return new THREE.MeshStandardMaterial({ 
            color: isBlack ? 0x222222 : 0xdddddd,
            map: tex,
            roughness: 0.4
        });
    }

    // Two-octave keyboard: lower row starts on Z, upper row starts on Q.
    const whiteKeyDefs = pianoKeyDefs.filter((key) => key.whiteIndex !== undefined);
    const whiteKeyWidth = 0.14;
    const whiteKeyDepth = 0.58;
    const whiteKeyHeight = 0.055;
    const firstWhiteX = -((whiteKeyDefs.length - 1) * whiteKeyWidth) / 2;
    const pianoKeyMeshes = [];
    for (const keyDef of whiteKeyDefs) {
        const mat = createKeyMat(keyDef.label, false);
        const key = new THREE.Mesh(new THREE.BoxGeometry(whiteKeyWidth, whiteKeyHeight, whiteKeyDepth), mat);
        key.position.set(firstWhiteX + keyDef.whiteIndex * whiteKeyWidth, 1.16, 0.22);
        key.userData.note = keyDef.note;
        key.userData.restY = key.position.y;
        key.userData.press = 0;
        pianoGroup.add(key);
        pianoKeyMeshes.push(key);
    }

    // Black keys
    const blackKeyDefs = pianoKeyDefs.filter((key) => key.blackAfter !== undefined);
    for (const keyDef of blackKeyDefs) {
        const mat = createKeyMat(keyDef.label, true);
        const bk = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.085, 0.34), mat);
        bk.position.set(firstWhiteX + (keyDef.blackAfter + 0.5) * whiteKeyWidth, 1.215, 0.03);
        bk.userData.note = keyDef.note;
        bk.userData.restY = bk.position.y;
        bk.userData.press = 0;
        pianoGroup.add(bk);
        pianoKeyMeshes.push(bk);
    }

    const pianoKeyByNote = new Map(pianoKeyMeshes.map((mesh) => [mesh.userData.note, mesh]));
    function pressPianoKeyVisual(noteOrMesh, strength = 1) {
        const mesh = typeof noteOrMesh === 'string' ? pianoKeyByNote.get(noteOrMesh) : noteOrMesh;
        if (!mesh) return;
        mesh.userData.press = Math.max(mesh.userData.press || 0, Math.max(0.35, strength));
    }
    updatables.push({
        update: (dt) => {
            for (const key of pianoKeyMeshes) {
                const press = key.userData.press || 0;
                const targetY = key.userData.restY - press * 0.045;
                key.position.y += (targetY - key.position.y) * Math.min(1, dt * 32);
                key.userData.press = Math.max(0, press - dt * 6.8);
            }
        }
    });

    const pianoRestY = pianoGroup.position.y;
    const pianoMouthGroup = new THREE.Group();
    pianoMouthGroup.visible = false;
    pianoMouthGroup.position.set(0, 1.06, 0.58);
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x030006 });
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xfff7e0, roughness: 0.28 });
    const gumMat = new THREE.MeshStandardMaterial({ color: 0x6b0018, roughness: 0.55 });
    const mouthBack = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.04, 0.08), mouthMat);
    mouthBack.position.set(0, 0, 0);
    pianoMouthGroup.add(mouthBack);
    const upperGum = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.035, 0.06), gumMat);
    upperGum.position.set(0, 0.12, -0.01);
    pianoMouthGroup.add(upperGum);
    const lowerGum = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.035, 0.06), gumMat);
    lowerGum.position.set(0, -0.12, -0.01);
    pianoMouthGroup.add(lowerGum);
    for (let i = 0; i < 15; i++) {
        const x = -1.02 + i * 0.146;
        const topTooth = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.17, 3), toothMat);
        topTooth.position.set(x, 0.065, 0.025);
        topTooth.rotation.z = Math.PI;
        topTooth.rotation.y = Math.PI / 6;
        pianoMouthGroup.add(topTooth);
        const bottomTooth = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.17, 3), toothMat);
        bottomTooth.position.set(x + 0.07, -0.065, 0.025);
        bottomTooth.rotation.y = Math.PI / 6;
        pianoMouthGroup.add(bottomTooth);
    }
    pianoMouthGroup.scale.y = 0.01;
    pianoGroup.add(pianoMouthGroup);
    let pianoScareTime = 0;
    let pianoScareActive = false;
    let pianoScareNoteTimer = 0;
    const scareNotes = pianoKeyDefs.map((key) => key.freq);

    function triggerPianoScare() {
        if (pianoScareActive) return;
        pianoScareActive = true;
        pianoScareTime = 0;
        pianoScareNoteTimer = 0;
        pianoMouthGroup.visible = true;
        showMessage('The piano got angry.');
    }

    // Music Book
    const bookCanvas = document.createElement('canvas');
    bookCanvas.width = 1024; bookCanvas.height = 512;
    const bctx = bookCanvas.getContext('2d');
    const bookTex = new THREE.CanvasTexture(bookCanvas);
    const bookMat = new THREE.MeshBasicMaterial({ map: bookTex });
    
    // Large sheet book on the music stand.
    const bookMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.8), bookMat);
    bookMesh.position.set(0, 1.55, -0.48);
    bookMesh.rotation.x = -Math.PI / 5;
    pianoGroup.add(bookMesh);
    
    const song = (title, notes, note = 'PLAY plays this page melody; press the keys shown from left to right.', options = {}) => ({
        title,
        notes,
        note,
        playback: options.playback || notes,
        beatSeconds: options.beatSeconds || 0.46,
        recordingUrl: options.recordingUrl || null
    });
    const realPianoNote = "PLAY uses this melody; a verified piano recording is used here.";
    const realRecordingNote = "PLAY uses this melody; a real recording is used here.";
    const bookPages = [
        song("Ode to Joy", [
            "E4 E4 F4 G4 G4 F4 E4 D4",
            "C4 C4 D4 E4 E4/1.5 D4/0.5 D4/2",
            "E4 E4 F4 G4 G4 F4 E4 D4",
            "C4 C4 D4 E4 D4/1.5 C4/0.5 C4/2",
            "D4 D4 E4 C4 D4 E4/0.5 F4/0.5 E4 C4",
            "D4 E4/0.5 F4/0.5 E4 D4 C4 D4 G4/2",
            "E4 E4 F4 G4 G4 F4 E4 D4",
            "C4 C4 D4 E4 D4/1.5 C4/0.5 C4/2"
        ], realPianoNote, { recordingUrl: "assets/ode-to-joy-piano.mp3" }),
        song("Fur Elise Opening", [
            "E5 D#5 E5 D#5 E5 B4 D5 C5 A4/2",
            "C4 E4 A4 B4/2 E4 G#4 B4 C5/2",
            "E4 E5 D#5 E5 D#5 E5 B4 D5 C5 A4/2",
            "C4 E4 A4 B4/2 E4 C5 B4 A4/2"
        ], realPianoNote, { recordingUrl: "assets/fur-elise-piano.mp3", beatSeconds: 0.34 }),
        song("Beethoven Fifth Opening", [
            "G4 G4 G4 D#4/3 R/0.5 F4 F4 F4 D4/3",
            "G4 G4 G4 D#4/3 R/0.5 F4 F4 F4 D4/3",
            "G4 F4 D#4 D4 C4/2 R/0.5 G4 G4 G4 D#4/3",
            "F4 F4 F4 D4/3 R/0.5 C4/4"
        ], realPianoNote, { recordingUrl: "assets/beethoven-fifth-piano.mp3", beatSeconds: 0.28 }),
        song("Brahms Lullaby", [
            "E4/0.5 E4/0.5 G4/1.5 E4/0.5 E4 G4",
            "E4/0.5 G4/0.5 C5 B4/1.5 A4/0.5 A4 G4",
            "D4/0.5 E4/0.5 F4 D4 D4/0.5 E4/0.5 F4",
            "D4/0.5 F4/0.5 B4/0.5 A4/0.5 G4 B4 C5",
            "C4/0.5 C4/0.5 C5/2 A4/0.5 F4/0.5",
            "G4/2 E4/0.5 C4/0.5 F4 G4 A4",
            "G4/2 C4/0.5 C4/0.5 C5/2 A4/0.5 F4/0.5",
            "G4/2 E4/0.5 C4/0.5 F4 E4 D4 C4/2"
        ], realRecordingNote, { recordingUrl: "assets/brahms-lullaby.ogg", beatSeconds: 0.38 }),
        song("Twinkle Twinkle", [
            "C4 C4 G4 G4 A4 A4 G4/2",
            "F4 F4 E4 E4 D4 D4 C4/2",
            "G4 G4 F4 F4 E4 E4 D4/2",
            "G4 G4 F4 F4 E4 E4 D4/2",
            "C4 C4 G4 G4 A4 A4 G4/2",
            "F4 F4 E4 E4 D4 D4 C4/2"
        ], realRecordingNote, { recordingUrl: "assets/twinkle-twinkle.ogg" }),
        song("Happy Birthday", [
            "G4/0.75 G4/0.25 A4 G4 C5 B4/2",
            "G4/0.75 G4/0.25 A4 G4 D5 C5/2",
            "G4/0.75 G4/0.25 G5 E5 C5 B4 A4/2",
            "F5/0.75 F5/0.25 E5 C5 D5 C5/3"
        ], realRecordingNote, { recordingUrl: "assets/happy-birthday.ogg" }),
        song("Jingle Bells Chorus", [
            "E4 E4 E4/2 E4 E4 E4/2",
            "E4 G4 C4 D4 E4/4",
            "F4 F4 F4 F4 F4 E4 E4 E4",
            "E4 D4 D4 E4 D4/2 G4/2",
            "E4 E4 E4/2 E4 E4 E4/2",
            "E4 G4 C4 D4 E4/4",
            "F4 F4 F4 F4 F4 E4 E4 E4",
            "G4 G4 F4 D4 C4/4"
        ], realRecordingNote, { recordingUrl: "assets/jingle-bells.oga", beatSeconds: 0.34 }),
        song("Silent Night", [
            "G4/1.5 A4/0.5 G4 E4/3",
            "G4/1.5 A4/0.5 G4 E4/3",
            "D5/2 D5 B4/3",
            "C5/2 C5 G4/3",
            "A4/2 A4 C5/1.5 B4/0.5 A4 G4/1.5 A4/0.5 G4 E4/3",
            "A4/2 A4 C5/1.5 B4/0.5 A4 G4/1.5 A4/0.5 G4 E4/3",
            "D5/2 D5 F5/1.5 D5/0.5 B4 C5 E5/3",
            "C5 G4 E4 G4 F4 D4 C4/4"
        ], realRecordingNote, { recordingUrl: "assets/silent-night.oga", beatSeconds: 0.38 }),
        song("Joy to the World", [
            "C5/2 B4 A4 G4/2 F4 E4 D4 C4/2",
            "G4 A4/2 A4 B4/2 B4 C5/3",
            "C5 C5 B4 A4 G4 G4/1.5 F4/0.5 E4/2",
            "C5 C5 B4 A4 G4 G4/1.5 F4/0.5 E4/2",
            "E4 E4 E4 E4 F4 G4/2",
            "F4 E4 D4 D4 E4 F4/2",
            "E4 D4 C4/4"
        ], realRecordingNote, { recordingUrl: "assets/joy-to-the-world.ogg" }),
        song("Deck the Halls", [
            "D5 C5 B4 A4 G4 A4 B4 G4",
            "A4 B4 C5 A4 B4 A4 G4 F#4 G4",
            "D5 C5 B4 A4 G4 A4 B4 G4",
            "A4 B4 C5 A4 B4 A4 G4 F#4 G4",
            "A4 B4 C5 A4 B4 C5 D5 A4",
            "B4 C5 D5 E5 F#5 G5 F#5 E5 D5",
            "D5 C5 B4 A4 G4 A4 B4 G4",
            "A4 B4 C5 A4 B4 A4 G4/2"
        ], realRecordingNote, { recordingUrl: "assets/deck-the-halls.oga", beatSeconds: 0.34 }),
        song("We Wish You", [
            "D4 G4 G4 A4 G4 F#4 E4/2",
            "E4 A4 A4 B4 A4 G4 F#4/2",
            "D4 B4 B4 C5 B4 A4 G4 E4",
            "D4 D4 E4 A4 F#4/2 G4/2",
            "D4 G4 G4 G4 F#4/2 F#4",
            "G4 F#4 E4 D4 A4/2",
            "B4 A4 G4 D5 D4 D4",
            "E4 A4 F#4/2 G4/2"
        ], realRecordingNote, { recordingUrl: "assets/we-wish-you.oga", beatSeconds: 0.36 }),
        song("Amazing Grace", [
            "D4/2 G4 B4 G4 B4/2 A4",
            "G4/2 E4 D4/3",
            "D4/2 G4 B4 G4 B4/2 A4 D5/3",
            "B4/2 D5 B4 G4 B4/2 A4",
            "G4/2 E4 D4/3",
            "D4/2 G4 B4 G4 B4/2 A4 G4/3"
        ], realPianoNote, { recordingUrl: "assets/amazing-grace-piano.mp3", beatSeconds: 0.48 }),
        song("Greensleeves", [
            "E4 G4 A4 B4 C5/2 B4 A4 F#4",
            "D4 F#4 G4 A4 B4/2 A4 G4 E4",
            "E4 G4 A4 B4 C5/2 B4 A4 F#4",
            "D4 F#4 G4 A4 G4/2 F#4 E4/2",
            "B4 C5 D5 E5 D5/2 C5 B4 G4",
            "E4 F#4 G4 A4 F#4/2 E4 E4/2"
        ], realRecordingNote, { recordingUrl: "assets/greensleeves.ogg", beatSeconds: 0.42 }),
        song("Auld Lang Syne", [
            "G4 C5 C5 C5 E5 D5 C5 D5",
            "E5 C5 C5 E5 G5 A5/2",
            "A5 G5 E5 E5 C5 D5 C5 D5",
            "E5 D5 C5 A4 A4 G4 C5/2",
            "A5 G5 E5 E5 C5 D5 C5 D5",
            "A5 G5 E5 E5 G5 A5/2",
            "G5 E5 C5 C5 E5 D5 C5 D5",
            "E5 D5 C5 A4 A4 G4 C5/2"
        ], realRecordingNote, { recordingUrl: "assets/auld-lang-syne.ogg", beatSeconds: 0.42 }),
        song("Frere Jacques", [
            "C4 D4 E4 C4 C4 D4 E4 C4",
            "E4 F4 G4/2 E4 F4 G4/2",
            "G4 A4 G4 F4 E4 C4 G4 A4 G4 F4 E4 C4",
            "C5 G4 C5/2 C5 G4 C5/2"
        ], realRecordingNote, { recordingUrl: "assets/frere-jacques.ogg" })
    ];
    let currentBookPage = 0;
    let isBookAutoPlaying = false;
    let bookAutoPlayTimers = [];
    let bookRecordingAudio = null;

    function stopBookAutoPlay(showStopMessage = false) {
        for (const timer of bookAutoPlayTimers) clearTimeout(timer);
        bookAutoPlayTimers = [];
        if (bookRecordingAudio) {
            bookRecordingAudio.pause();
            bookRecordingAudio.currentTime = 0;
            bookRecordingAudio = null;
        }
        if (isBookAutoPlaying && showStopMessage) showMessage('Stopped song.');
        isBookAutoPlaying = false;
        drawBookPage();
    }

    function parseBookToken(token) {
        if (token === '|') return { type: 'bar' };
        if (token === '.') return { type: 'rest', beats: 0.5 };

        const restMatch = token.match(/^R(?:\/(\d+(?:\.\d+)?))?$/);
        if (restMatch) {
            return { type: 'rest', beats: restMatch[1] ? Number(restMatch[1]) : 1 };
        }

        const noteMatch = token.match(/^([A-G]#?\d)(?:\/(\d+(?:\.\d+)?))?$/);
        if (noteMatch) {
            return {
                type: 'note',
                note: noteMatch[1],
                beats: noteMatch[2] ? Number(noteMatch[2]) : 1
            };
        }

        return null;
    }

    function formatPracticeLine(line) {
        const keys = [];
        const tokens = line.split(/\s+/).filter(Boolean);
        for (const token of tokens) {
            const parsed = parseBookToken(token);
            if (parsed && parsed.type === 'note' && pianoNoteMap[parsed.note]) {
                keys.push(pianoNoteMap[parsed.note].label);
            }
        }
        return keys.join(' ');
    }

    function groupPracticeLine(line) {
        const keys = line.split(/\s+/).filter(Boolean);
        const groups = [];
        for (let i = 0; i < keys.length; i += 4) {
            groups.push(keys.slice(i, i + 4).join(' '));
        }
        return groups.join('    ');
    }

    function parseBookNotes(page) {
        const sequence = [];
        const beatSeconds = page.beatSeconds || 0.6;
        for (const line of page.playback || page.notes) {
            const tokens = line.split(/\s+/).filter(Boolean);
            for (const token of tokens) {
                const parsed = parseBookToken(token);
                if (!parsed || parsed.type === 'bar') continue;
                const duration = beatSeconds * parsed.beats;
                if (parsed.type === 'rest') {
                    sequence.push({ duration });
                } else if (parsed.type === 'note' && pianoNoteMap[parsed.note]) {
                    sequence.push({ freq: pianoNoteMap[parsed.note].freq, duration });
                }
            }
        }
        return sequence;
    }

    function playCurrentBookPage() {
        if (isBookAutoPlaying) {
            stopBookAutoPlay(true);
            return;
        }

        const page = bookPages[currentBookPage];
        if (page.recordingUrl) {
            bookRecordingAudio = new Audio(page.recordingUrl);
            bookRecordingAudio.volume = 0.78;
            bookRecordingAudio.addEventListener('ended', () => {
                isBookAutoPlaying = false;
                bookRecordingAudio = null;
                drawBookPage();
            }, { once: true });
            bookRecordingAudio.addEventListener('error', () => {
                isBookAutoPlaying = false;
                bookRecordingAudio = null;
                drawBookPage();
                showMessage('Could not play recording.');
            }, { once: true });
            isBookAutoPlaying = true;
            drawBookPage();
            showMessage(`Playing recording: ${page.title}`);
            const playResult = bookRecordingAudio.play();
            if (playResult && playResult.catch) {
                playResult.catch(() => {
                    isBookAutoPlaying = false;
                    bookRecordingAudio = null;
                    drawBookPage();
                    showMessage('Click PLAY again to start audio.');
                });
            }
            return;
        }

        const sequence = parseBookNotes(page);
        if (!sequence.length) {
            showMessage('This page has no playable notes.');
            return;
        }

        isBookAutoPlaying = true;
        drawBookPage();
        showMessage(`Playing song: ${page.title}`);

        let delayMs = 0;
        for (const item of sequence) {
            if (item.freq) {
                const timer = setTimeout(() => {
                    playPianoKey(item.freq, 0.38, Math.max(0.32, Math.min(1.35, item.duration * 0.95)));
                }, delayMs);
                bookAutoPlayTimers.push(timer);
            }
            delayMs += item.duration * 1000;
        }

        const finishTimer = setTimeout(() => {
            isBookAutoPlaying = false;
            bookAutoPlayTimers = [];
            drawBookPage();
        }, delayMs + 120);
        bookAutoPlayTimers.push(finishTimer);
    }

    function turnBookPage(delta) {
        if (isBookAutoPlaying) stopBookAutoPlay(false);
        currentBookPage = (currentBookPage + delta + bookPages.length) % bookPages.length;
        drawBookPage();
    }
    
    function drawBookPage() {
        const page = bookPages[currentBookPage];
        const pageW = bookCanvas.width;
        const pageH = bookCanvas.height;
        const marginX = 56;
        const titleY = 72;
        const noteInfoY = 116;
        const notesTop = 154;
        const footerY = 474;
        const maxTextWidth = pageW - marginX * 2;
        const fitMonoFont = (text, maxSize, minSize, weight = '') => {
            let size = maxSize;
            do {
                bctx.font = `${weight}${size}px monospace`;
                if (bctx.measureText(text).width <= maxTextWidth || size <= minSize) return size;
                size -= 2;
            } while (size >= minSize);
            return minSize;
        };

        bctx.fillStyle = '#fff9e6';
        bctx.fillRect(0, 0, pageW, pageH);
        bctx.fillStyle = '#111';

        const title = `Page ${currentBookPage + 1}/${bookPages.length}: ${page.title}`;
        const titleSize = fitMonoFont(title, 46, 30, 'bold ');
        bctx.font = `bold ${titleSize}px monospace`;
        bctx.fillText(title, marginX, titleY);

        if (page.note) {
            bctx.font = 'italic 21px Arial';
            bctx.fillStyle = '#555';
            bctx.fillText(page.note, marginX, noteInfoY);
            bctx.fillStyle = '#111';
        }

        const practiceLines = page.notes.map(formatPracticeLine).filter(Boolean).map(groupPracticeLine);
        const longestLine = practiceLines.reduce((longest, line) => line.length > longest.length ? line : longest, '');
        const heightFit = Math.floor((footerY - notesTop) / Math.max(1, practiceLines.length) / 1.12);
        const noteSize = Math.min(44, heightFit, fitMonoFont(longestLine, 44, 24));
        const lineHeight = noteSize * 1.22;
        const totalNoteHeight = (practiceLines.length - 1) * lineHeight;
        let noteY = notesTop + Math.max(0, (footerY - notesTop - totalNoteHeight) * 0.2);
        bctx.font = `bold ${noteSize}px monospace`;
        for (const line of practiceLines) {
            bctx.fillText(line, marginX, noteY);
            noteY += lineHeight;
        }

        const controls = [
            { text: '-10', x: 150, w: 110 },
            { text: 'Prev', x: 300, w: 130 },
            { text: isBookAutoPlaying ? 'STOP' : 'PLAY', x: 512, w: 160 },
            { text: 'Next', x: 724, w: 130 },
            { text: '+10', x: 874, w: 110 }
        ];
        bctx.font = 'bold 28px Arial';
        bctx.textAlign = 'center';
        for (const control of controls) {
            bctx.fillStyle = control.text === 'PLAY' ? '#153f1c' : control.text === 'STOP' ? '#6b1010' : '#333';
            bctx.fillRect(control.x - control.w / 2, 436, control.w, 44);
            bctx.fillStyle = '#fff9e6';
            bctx.fillText(control.text, control.x, 467);
        }

        bctx.font = 'italic 20px Arial';
        bctx.fillStyle = '#555';
        bctx.textAlign = 'right';
        const footerText = page.recordingUrl ? "PLAY uses a real recording; page shows practice keys" : "PLAY uses the page melody; page shows practice keys";
        bctx.fillText(footerText, pageW - marginX, 510);
        bctx.textAlign = 'left';
        bookTex.needsUpdate = true;
    }
    drawBookPage();

    // Piano Bench
    const benchGroup = new THREE.Group();
    benchGroup.position.set(0, 0, 0.95);
    const benchTop = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 0.42), pianoSideMat);
    benchTop.position.y = 0.48;
    benchGroup.add(benchTop);
    const benchCushion = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.38), new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.55 }));
    benchCushion.position.y = 0.58;
    benchGroup.add(benchCushion);
    const benchLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), metalMat);
    benchLeg1.position.set(-0.42, 0.225, -0.16);
    benchGroup.add(benchLeg1);
    const benchLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), metalMat);
    benchLeg2.position.set(0.42, 0.225, -0.16);
    benchGroup.add(benchLeg2);
    const benchLeg3 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), metalMat);
    benchLeg3.position.set(-0.42, 0.225, 0.16);
    benchGroup.add(benchLeg3);
    const benchLeg4 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), metalMat);
    benchLeg4.position.set(0.42, 0.225, 0.16);
    benchGroup.add(benchLeg4);
    pianoGroup.add(benchGroup);

    scene.add(pianoGroup);
    trackCullable(pianoGroup, 2.5);

    // Realistic Piano Audio Engine using PeriodicWave for Harmonics
    let pianoWave = null;
    if (audioCtx) {
        // Create an acoustic piano-like harmonic wave
        const real = new Float32Array([0, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01]);
        const imag = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]);
        pianoWave = audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    function playPianoKey(freq, volume = 0.8, decay = 1.5) {
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        if (pianoWave) {
            osc.setPeriodicWave(pianoWave);
        } else {
            osc.type = 'sine'; // Fallback
        }
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        // Attack and Exponential decay envelope for piano sound
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + decay);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + decay);
    }

    // Add interaction to sit
    const pianoSeatPos = new THREE.Vector3(floorLayout.piano.x - 0.83, 0, floorLayout.piano.z);
    const pianoViewTarget = new THREE.Vector3(floorLayout.piano.x + 0.83, 1.05, floorLayout.piano.z);
    for (let km of pianoKeyMeshes) {
        interactables.push({
            mesh: km,
            action: 'sitPiano',
            label: 'Sit at Piano',
            pianoWorldPos: pianoSeatPos,
            pianoLookAt: pianoViewTarget,
            canInteract: () => !servantActive
        });
    }
    interactables.push({
        mesh: pianoBody,
        action: 'sitPiano',
        label: 'Sit at Piano',
        pianoWorldPos: pianoSeatPos,
        pianoLookAt: pianoViewTarget,
        canInteract: () => !servantActive
    });
    interactables.push({
        mesh: benchTop,
        action: 'sitPiano',
        get label() { return servantActive ? 'Bone Pianist Occupies Bench' : 'Sit at Piano'; },
        pianoWorldPos: pianoSeatPos,
        pianoLookAt: pianoViewTarget,
        canInteract: () => !servantActive
    });

    updatables.push({
        update: (dt) => {
            if (!pianoScareActive) return;
            pianoScareTime += dt;
            pianoScareNoteTimer -= dt;
            const open = Math.min(1, pianoScareTime / 0.32) * Math.max(0, Math.min(1, (3.35 - pianoScareTime) / 0.55));
            pianoMouthGroup.visible = open > 0.02;
            pianoMouthGroup.scale.y = 0.01 + open * (2.1 + Math.sin(pianoScareTime * 24) * 0.18);
            pianoGroup.position.y = pianoRestY + open * (0.22 + Math.sin(pianoScareTime * 30) * 0.04);
            pianoGroup.rotation.z = Math.sin(pianoScareTime * 38) * 0.035 * open;
            if (pianoScareNoteTimer <= 0 && audioCtx) {
                pianoScareNoteTimer = 0.055 + Math.random() * 0.06;
                const freq = scareNotes[Math.floor(Math.random() * scareNotes.length)] * (Math.random() < 0.18 ? 0.5 : 1);
                playPianoKey(freq, 0.28 + Math.random() * 0.28, 0.18 + Math.random() * 0.25);
            }
            if (pianoScareTime >= 3.5) {
                pianoScareActive = false;
                pianoScareTime = 0;
                pianoMouthGroup.visible = false;
                pianoMouthGroup.scale.y = 0.01;
                pianoGroup.position.y = pianoRestY;
                pianoGroup.rotation.z = 0;
                showMessage('The piano calms down.');
            }
        }
    });
    
    const bookControlMat = new THREE.MeshBasicMaterial({ visible: false });
    const bookControlDefs = [
        {
            label: 'Jump Back 10',
            x: -0.55,
            w: 0.2,
            action: () => {
                if (sfx) sfx.play('page');
                turnBookPage(-10);
            }
        },
        {
            label: 'Prev Page',
            x: -0.32,
            w: 0.22,
            action: () => {
                if (sfx) sfx.play('page');
                turnBookPage(-1);
            }
        },
        {
            label: 'Play Song',
            x: 0,
            w: 0.3,
            action: () => playCurrentBookPage()
        },
        {
            label: 'Next Page',
            x: 0.32,
            w: 0.22,
            action: () => {
                if (sfx) sfx.play('page');
                turnBookPage(1);
            }
        },
        {
            label: 'Jump Forward 10',
            x: 0.55,
            w: 0.2,
            action: () => {
                if (sfx) sfx.play('page');
                turnBookPage(10);
            }
        }
    ];

    for (const control of bookControlDefs) {
        const controlBox = new THREE.Mesh(new THREE.BoxGeometry(control.w, 0.16, 0.25), bookControlMat.clone());
        controlBox.position.set(control.x, -0.32, 0.12);
        bookMesh.add(controlBox);
        interactables.push({
            mesh: controlBox,
            action: control.action,
            get label() {
                if (control.label === 'Play Song') return isBookAutoPlaying ? 'Stop Song' : 'Play Song';
                return control.label;
            },
            mouseOnly: true,
            canInteract: () => window.isSittingPiano === true
        });
    }

    // ============ MINI FRIDGE ============
    const fridgeGroup = new THREE.Group();
    fridgeGroup.position.set(floorLayout.fridge.x, 0, floorLayout.fridge.z);
    fridgeGroup.rotation.y = Math.PI / 2; // Face into the hall

    const fridgeMat = new THREE.MeshStandardMaterial({ color: 0xe7e9ec, roughness: 0.28, metalness: 0.08 });
    const fridgeTrimMat = new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.45 });

    // Fridge hollow body (no front face to prevent z-fighting abyss)
    const fridgeBody = new THREE.Group();
    fridgeBody.position.y = 0.7;
    const fTop = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.055, 0.84), fridgeMat); fTop.position.y = 0.675;
    const fBot = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.055, 0.84), fridgeMat); fBot.position.y = -0.675;
    const fLeft = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.3, 0.84), fridgeMat); fLeft.position.set(-0.405, 0, 0);
    const fRight = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.3, 0.84), fridgeMat); fRight.position.set(0.405, 0, 0);
    const fBack = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.3, 0.055), fridgeMat); fBack.position.set(0, 0, -0.405);
    
    // Dark interior backing (prevents abyss)
    const interiorMat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.9 });
    const iLeft = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.3), interiorMat); iLeft.rotation.y = Math.PI/2; iLeft.position.set(-0.34, 0, 0);
    const iRight = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.3), interiorMat); iRight.rotation.y = -Math.PI/2; iRight.position.set(0.34, 0, 0);
    const iBack = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.3), interiorMat); iBack.position.set(0, 0, -0.34);
    
    fridgeBody.add(fTop, fBot, fLeft, fRight, fBack, iLeft, iRight, iBack);
    const lowerShelfY = -0.32;
    const middleShelfY = 0.02;
    const upperShelfY = 0.34;
    for (const y of [lowerShelfY, middleShelfY]) {
        const shelfRail = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.018, 0.58), new THREE.MeshStandardMaterial({ color: 0xbed0de, roughness: 0.18, metalness: 0.25, transparent: true, opacity: 0.62 }));
        shelfRail.position.set(0, y, -0.05);
        fridgeBody.add(shelfRail);
    }
    const freezerLine = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.025, 0.04), fridgeTrimMat);
    freezerLine.position.set(0, 0.38, 0.38);
    fridgeBody.add(freezerLine);
    const interiorLight = new THREE.PointLight(0xbfeaff, 0, 1.8, 2);
    optionalLights.push(interiorLight);
    interiorLight.position.set(0.22, 0.38, 0.18);
    fridgeBody.add(interiorLight);
    fridgeGroup.add(fridgeBody);

    // Fridge Food (Soda cans and Chips)
    const foodGroup = new THREE.Group();
    foodGroup.position.set(0, 0, 0);
    
    const sodaMat = new THREE.MeshStandardMaterial({ color: 0x2255ff, roughness: 0.2, metalness: 0.6 });
    const soda1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 12), sodaMat); soda1.position.set(-0.22, middleShelfY + 0.085, -0.12);
    const soda2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 12), sodaMat); soda2.position.set(-0.08, middleShelfY + 0.085, -0.12);
    
    const chipsMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.7 });
    const chips = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), chipsMat); chips.position.set(0.2, middleShelfY + 0.16, -0.15);
    const milk = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.28, 0.11), new THREE.MeshStandardMaterial({ color: 0xf5f6ef, roughness: 0.45 }));
    milk.position.set(-0.25, upperShelfY + 0.15, -0.16);
    const milkCap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.08), new THREE.MeshStandardMaterial({ color: 0x5db7ff, roughness: 0.35 }));
    milkCap.position.set(-0.25, upperShelfY + 0.307, -0.16);
    const juice = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0xffaa2a, roughness: 0.38, transparent: true, opacity: 0.88 }));
    juice.position.set(0.0, upperShelfY + 0.12, -0.16);
    const leftover = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.18), new THREE.MeshStandardMaterial({ color: 0x94e08f, roughness: 0.45, transparent: true, opacity: 0.72 }));
    leftover.position.set(0.24, upperShelfY + 0.065, -0.13);
    const bottomBin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.34), new THREE.MeshStandardMaterial({ color: 0xaac0cf, roughness: 0.28, transparent: true, opacity: 0.42 }));
    bottomBin.position.set(0, lowerShelfY - 0.18, -0.08);
    const appleMat = new THREE.MeshStandardMaterial({ color: 0xff4d4d, roughness: 0.6 });
    const apple1 = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), appleMat);
    apple1.position.set(-0.2, lowerShelfY - 0.055, -0.1);
    const apple2 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0x94d64f, roughness: 0.6 }));
    apple2.position.set(-0.08, lowerShelfY - 0.06, -0.12);
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12), new THREE.MeshStandardMaterial({ color: 0x77d8ff, roughness: 0.2, transparent: true, opacity: 0.75 }));
    bottle.position.set(0.18, lowerShelfY - 0.035, -0.11);
    
    // Middle shelf
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.6), interiorMat);
    shelf.position.set(0, upperShelfY, -0.05);
    foodGroup.add(shelf, soda1, soda2, chips, milk, milkCap, juice, leftover, bottomBin, apple1, apple2, bottle);
    fridgeBody.add(foodGroup);

    // Door (pivot on the left edge)
    const fridgeDoorPivot = new THREE.Group();
    fridgeDoorPivot.position.set(-0.4, 0.7, 0.4);
    const fridgeDoor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.06), fridgeMat);
    fridgeDoor.position.set(0.4, 0, 0.03);
    fridgeDoorPivot.add(fridgeDoor);
    const doorSeal = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.26, 0.025), fridgeTrimMat);
    doorSeal.position.set(0.4, 0, -0.012);
    fridgeDoorPivot.add(doorSeal);
    const doorInner = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.028), new THREE.MeshStandardMaterial({ color: 0xd9e0e6, roughness: 0.42 }));
    doorInner.position.set(0.4, -0.02, -0.035);
    fridgeDoorPivot.add(doorInner);
    for (const y of [-0.28, 0.22]) {
        const bin = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.35, transparent: true, opacity: 0.68 }));
        bin.position.set(0.4, y, -0.08);
        fridgeDoorPivot.add(bin);
    }

    // Handle
    const fridgeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), metalMat);
    fridgeHandle.position.set(0.7, 0, 0.08);
    fridgeDoorPivot.add(fridgeHandle);
    const vent = new THREE.Group();
    vent.position.set(0.4, -0.52, 0.085);
    for (let i = 0; i < 5; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.012), fridgeTrimMat);
        slot.position.y = i * 0.035;
        vent.add(slot);
    }
    fridgeDoorPivot.add(vent);
    const magnetColors = [0xff4f6d, 0x36d6ff, 0xffd34d];
    for (let i = 0; i < magnetColors.length; i++) {
        const magnet = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.014), new THREE.MeshBasicMaterial({ color: magnetColors[i] }));
        magnet.position.set(0.15 + i * 0.13, 0.42 - i * 0.09, 0.095);
        fridgeDoorPivot.add(magnet);
    }

    fridgeGroup.add(fridgeDoorPivot);
    scene.add(fridgeGroup);
    trackCullable(fridgeGroup, 1.6);

    let fridgeOpen = false;
    let fridgeTargetAngle = 0;
    let fridgeOpenTimer = 0;
    const fridgeRestockDelay = 8;
    const fridgeItems = [
        { mesh: soda1, type: 'drink', label: 'Grab Soda', message: 'You grab a soda. *sip*', available: true, restockRemaining: 0 },
        { mesh: soda2, type: 'drink', label: 'Grab Soda', message: 'You grab a soda. *sip*', available: true, restockRemaining: 0 },
        { mesh: chips, type: 'eat', label: 'Grab Chips', message: 'You grab some chips. *crunch*', available: true, restockRemaining: 0 }
    ];

    function refreshFridgeItems(dt = 0) {
        for (const item of fridgeItems) {
            if (!item.available && item.restockRemaining > 0) {
                item.restockRemaining = Math.max(0, item.restockRemaining - dt);
                if (item.restockRemaining === 0) {
                    item.available = true;
                }
            }
            item.mesh.visible = item.available;
        }
    }

    function setFridgeOpen(open, message) {
        fridgeOpen = open;
        fridgeOpenTimer = 0;
        fridgeTargetAngle = open ? -Math.PI * 0.38 : 0;
        fridgeInteractable.label = open ? 'Close Fridge' : 'Open Fridge';
        if (sfx) sfx.play('switch');
        if (message) showMessage(message);
        refreshFridgeItems();
    }
    
    updatables.push({
        update: (dt) => {
            if (!fridgeGroup.visible && !fridgeOpen && Math.abs(fridgeDoorPivot.rotation.y) < 0.002 && interiorLight.intensity < 0.01) return;
            fridgeDoorPivot.rotation.y += (fridgeTargetAngle - fridgeDoorPivot.rotation.y) * 8 * dt;
            interiorLight.intensity += ((fridgeOpen ? 1.3 : 0) - interiorLight.intensity) * 8 * dt;
            refreshFridgeItems(dt);
            if (fridgeOpen) {
                fridgeOpenTimer += dt;
                if (fridgeOpenTimer > 10.0) {
                    setFridgeOpen(false, 'The fridge swings shut.');
                }
            } else {
                fridgeOpenTimer = 0;
            }
        }
    });

    const fridgeInteractable = {
        mesh: fridgeDoor,
        action: () => {
            if (!fridgeOpen) {
                setFridgeOpen(true, 'You open the fridge.');
            } else {
                setFridgeOpen(false, 'You close the fridge.');
            }
        },
        label: 'Open Fridge'
    };
    interactables.push(fridgeInteractable);
    interactables.push({ mesh: fridgeHandle, action: () => fridgeInteractable.action(), get label() { return fridgeInteractable.label; } });
    interactables.push({ mesh: fridgeBody, action: () => fridgeInteractable.action(), get label() { return fridgeInteractable.label; } });

    // Cinematic targets for fridge items
    const fridgeCamPos = new THREE.Vector3(floorLayout.fridge.x + 1.03, 1.3, floorLayout.fridge.z);
    const fridgeLookAt = new THREE.Vector3(floorLayout.fridge.x - 0.03, 1.3, floorLayout.fridge.z);

    const grabItemAction = (item) => {
        if (!fridgeOpen || !item.available) return;

        const consumeItem = () => {
            item.available = false;
            item.restockRemaining = fridgeRestockDelay;
            item.mesh.visible = false;
        };

        const finishGrab = () => {
            if (sfx) sfx.play(item.type);
            showMessage(item.message);
            window.reportRoomSpam?.(item.type);
        };

        if (window.startCinematic) {
            const started = window.startCinematic(item.type, fridgeCamPos, fridgeLookAt, () => {
                finishGrab();
            });
            if (started) consumeItem();
        } else {
            finishGrab();
            consumeItem();
        }
    };

    for (const item of fridgeItems) {
        interactables.push({
            mesh: item.mesh,
            action: () => grabItemAction(item),
            canInteract: () => fridgeOpen && item.available,
            get label() { return fridgeOpen && item.available ? item.label : ''; }
        });
    }

    // ============ AMBIENT LIGHTING ============
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x555566, 1.05);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0x596074, 0.68);
    scene.add(ambientLight);

    // ============ SCROLLABLE CONTROLS POSTER ============
    const posterCanvas = document.createElement('canvas');
    posterCanvas.width = 768;
    posterCanvas.height = 1024;
    const pctx = posterCanvas.getContext('2d');
    const posterTex = new THREE.CanvasTexture(posterCanvas);
    const posterLines = [
        'CONTROLS',
        '- Mouse: look around',
        '- W/A/S/D or arrows: move',
        '- E: interact',
        '- Click: interact / turn book pages',
        '- Space: stand up from chair or piano',
        '- While hanging from fan: E drops down',
        '- Desk chair: Arrow Left/Right nudges spin',
        '- PC: sit in gaming chair first',
        '- PC OS: close monitor with Esc or Close',
        '- PC OS: Alt+Tab cycles app windows',
        '- PC OS: drag desktop for selection box',
        '- PC OS: resize windows from bottom-right',
        '',
        'PIANO',
        '- Sit first, then play notes:',
        '  Z S X D C V G B H N J M',
        '  Q 2 W 3 E R 5 T 6 Y 7 U I',
        '- While seated, E is a piano key.',
        '- Book pages only turn with mouse clicks.',
        "",
        'INTERACTABLES',
        '- Room light switch',
        '- Desk lamp',
        '- Window / rain',
        '- PC case RGB',
        '- PC monitor opens Windows 12 only while seated',
        '- Desk chair',
        '- Door',
        '- Fan switch and ceiling fan',
        '- Cat',
        '- Fridge soda and chips',
        '- Piano, bench, and music book',
        '',
        'ROOM DETAILS',
        '- Window: click glass to toggle rain',
        '- Fridge: snacks restock after a bit',
        '- PC case toggles RGB lights only',
        '- Monitor opens boot menu / desktop PC',
        '- Boot USB installs Windows 12',
        '- Firmware can reset or reinstall',
        '- Chair has soft spin momentum',
        '- Look sideways for a tiny chair drift',
        '- Arrow Left/Right gives chair a push',
        '- Music book: click its page controls',
        '',
        'NOTES',
        '- Point the crosshair at objects',
        '- The prompt tells you what works',
        '- Some details are just there to look nice'
    ];
    let posterScroll = 0;
    const posterVisibleLines = 18;
    function drawPoster() {
        pctx.fillStyle = '#f7f3dc';
        pctx.fillRect(0, 0, 768, 1024);
        pctx.fillStyle = '#d2c88f';
        pctx.fillRect(0, 0, 768, 82);
        pctx.fillStyle = '#111';
        pctx.font = 'bold 42px monospace';
        pctx.fillText('ROOM NOTES', 32, 56);
        pctx.font = '22px monospace';
        pctx.fillStyle = '#4c4a40';
        pctx.fillText('Click top/bottom edge to scroll', 350, 55);
        pctx.strokeStyle = '#9c9365';
        pctx.lineWidth = 8;
        pctx.strokeRect(16, 16, 736, 992);

        pctx.font = '26px monospace';
        let py = 126;
        for (const line of posterLines.slice(posterScroll, posterScroll + posterVisibleLines)) {
            pctx.fillStyle = line === line.toUpperCase() && line !== '' ? '#4a4a4a' : '#222';
            pctx.fillText(line, 42, py);
            py += 43;
        }
        pctx.fillStyle = '#333';
        pctx.font = 'bold 28px monospace';
        pctx.fillText(`SCROLL ${posterScroll + 1}-${Math.min(posterScroll + posterVisibleLines, posterLines.length)} / ${posterLines.length}`, 42, 965);
        pctx.fillStyle = '#756f50';
        pctx.fillText('UP', 654, 118);
        pctx.fillText('DOWN', 604, 965);
        posterTex.needsUpdate = true;
    }
    drawPoster();
    const posterMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.1, 2.8), 
        new THREE.MeshBasicMaterial({ map: posterTex, side: THREE.DoubleSide })
    );
    const POSTER_X = ROOM_HALF_X - 0.075;
    const POSTER_Z = -1.35;
    const POSTER_ROT_Y = -Math.PI / 2;
    posterMesh.position.set(POSTER_X, 2.0, POSTER_Z);
    posterMesh.rotation.y = POSTER_ROT_Y;
    scene.add(posterMesh);
    const posterFrameMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.45 });
    const posterFrame = new THREE.Group();
    posterFrame.position.copy(posterMesh.position);
    posterFrame.rotation.y = POSTER_ROT_Y;
    const posterTop = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.06, 0.045), posterFrameMat);
    posterTop.position.y = 1.43;
    posterFrame.add(posterTop);
    const posterBottom = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.06, 0.045), posterFrameMat);
    posterBottom.position.y = -1.43;
    posterFrame.add(posterBottom);
    const posterLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.88, 0.045), posterFrameMat);
    posterLeft.position.x = -1.08;
    posterFrame.add(posterLeft);
    const posterRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.88, 0.045), posterFrameMat);
    posterRight.position.x = 1.08;
    posterFrame.add(posterRight);
    scene.add(posterFrame);
    const posterControlMat = new THREE.MeshBasicMaterial({ visible: false });
    const posterScrollUp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.48, 0.08), posterControlMat.clone());
    posterScrollUp.position.set(POSTER_X - 0.045, 3.05, POSTER_Z);
    posterScrollUp.rotation.y = POSTER_ROT_Y;
    const posterScrollDown = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.48, 0.08), posterControlMat.clone());
    posterScrollDown.position.set(POSTER_X - 0.045, 0.95, POSTER_Z);
    posterScrollDown.rotation.y = POSTER_ROT_Y;
    scene.add(posterScrollUp, posterScrollDown);
    interactables.push({
        mesh: posterScrollUp,
        label: 'Scroll Notes Up',
        action: () => {
            posterScroll = Math.max(0, posterScroll - 5);
            if (sfx) sfx.play('page');
            drawPoster();
        }
    });
    interactables.push({
        mesh: posterScrollDown,
        label: 'Scroll Notes Down',
        action: () => {
            posterScroll = Math.min(Math.max(0, posterLines.length - posterVisibleLines), posterScroll + 5);
            if (sfx) sfx.play('page');
            drawPoster();
        }
    });

    // ============ THE SOVEREIGN'S GOTHIC KINGDOM ============
    // Compact castle shell: the original features are preserved, but the room now reads as a hall.
    const castleGroup = new THREE.Group();
    castleGroup.name = 'gothic-castle-overhaul';
    scene.add(castleGroup);

    const castleStoneMat = new THREE.MeshStandardMaterial({ color: 0x151116, roughness: 0.9, metalness: 0.08 });
    const castleStoneAltMat = new THREE.MeshStandardMaterial({ color: 0x241820, roughness: 0.82, metalness: 0.12 });
    const castleIronMat = new THREE.MeshStandardMaterial({ color: 0x130d10, roughness: 0.32, metalness: 0.82 });
    const castleRedMat = new THREE.MeshStandardMaterial({ color: 0x42030b, emissive: 0x240006, emissiveIntensity: 0.35, roughness: 0.7 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xc9bea5, roughness: 0.86 });

    const gothicFloor = new THREE.Mesh(new THREE.PlaneGeometry(7.92, 7.92), castleStoneMat);
    gothicFloor.rotation.x = -Math.PI / 2;
    gothicFloor.position.y = 0.012;
    castleGroup.add(gothicFloor);
    // One line object replaces the former 32 individual floor-seam meshes.
    const gothicGrid = new THREE.GridHelper(7.9, 16, 0x2f2028, 0x241820);
    gothicGrid.position.y = 0.026;
    gothicGrid.material.transparent = true;
    gothicGrid.material.opacity = 0.48;
    gothicGrid.material.depthWrite = false;
    castleGroup.add(gothicGrid);

    const aisleRunner = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.022, 6.15), new THREE.MeshStandardMaterial({ color: 0x27040a, emissive: 0x180005, emissiveIntensity: 0.18, roughness: 0.84 }));
    aisleRunner.position.set(0, 0.04, 0.05);
    castleGroup.add(aisleRunner);
    for (const x of [-0.78, 0.78]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 6.2), castleIronMat);
        rail.position.set(x, 0.09, 0.05);
        castleGroup.add(rail);
    }

    const columnCandidates = [
        [-2.30, -2.50], [2.30, -2.50],
        [-2.30, 0.20], [2.30, 0.20],
        [-2.30, 2.65], [2.30, 1.55],
        [-3.72, -3.45], [3.72, -3.45]
    ];
    const circleTouchesReservation = (x, z, radius, rect, gap = 0.16) => {
        const nearestX = Math.max(rect.x - rect.halfX - gap, Math.min(x, rect.x + rect.halfX + gap));
        const nearestZ = Math.max(rect.z - rect.halfZ - gap, Math.min(z, rect.z + rect.halfZ + gap));
        const dx = x - nearestX;
        const dz = z - nearestZ;
        return dx * dx + dz * dz < radius * radius;
    };
    const columnPositions = [];
    const columnRadius = 0.36;
    const columnStep = 0.22;
    for (const [preferredX, preferredZ] of columnCandidates) {
        let placed = null;
        for (let ring = 0; ring <= 30 && !placed; ring++) {
            for (let ix = -ring; ix <= ring && !placed; ix++) {
                for (let iz = -ring; iz <= ring; iz++) {
                    if (ring > 0 && Math.abs(ix) !== ring && Math.abs(iz) !== ring) continue;
                    const x = Math.max(-5.48, Math.min(5.48, preferredX + ix * columnStep));
                    const z = Math.max(-7.48, Math.min(5.48, preferredZ + iz * columnStep));
                    if (layoutReservations.some((reservation) => circleTouchesReservation(x, z, columnRadius, reservation))) continue;
                    if (columnPositions.some(([otherX, otherZ]) => {
                        const dx = x - otherX;
                        const dz = z - otherZ;
                        const minimum = columnRadius * 2 + 0.24;
                        return dx * dx + dz * dz < minimum * minimum;
                    })) continue;
                    placed = [x, z];
                    break;
                }
            }
        }
        if (placed) columnPositions.push(placed);
    }
    const columnShafts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.19, 3.65, 8), castleStoneAltMat, columnPositions.length);
    const columnBases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.32, 0.18, 8), castleIronMat, columnPositions.length);
    const columnCapitals = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.16, 0.22, 8), castleIronMat, columnPositions.length);
    const columnMatrix = new THREE.Matrix4();
    columnPositions.forEach(([x, z], index) => {
        columnMatrix.makeTranslation(x, 1.85, z);
        columnShafts.setMatrixAt(index, columnMatrix);
        columnMatrix.makeTranslation(x, 0.09, z);
        columnBases.setMatrixAt(index, columnMatrix);
        columnMatrix.makeTranslation(x, 3.72, z);
        columnCapitals.setMatrixAt(index, columnMatrix);
    });
    columnShafts.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    columnBases.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    columnCapitals.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    columnShafts.instanceMatrix.needsUpdate = true;
    columnBases.instanceMatrix.needsUpdate = true;
    columnCapitals.instanceMatrix.needsUpdate = true;
    castleGroup.add(columnShafts, columnBases, columnCapitals);

    [-2.55, 2.55].forEach((x) => {
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.9), castleRedMat);
        banner.position.set(x, 2.46, -3.91);
        banner.rotation.y = Math.PI;
        castleGroup.add(banner);
        const spear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 4), castleIronMat);
        spear.position.set(x, 3.58, -3.86);
        castleGroup.add(spear);
    });

    const chandelier = new THREE.Group();
    const chandelierRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 8, 28), castleIronMat);
    chandelierRing.rotation.x = Math.PI / 2;
    chandelier.add(chandelierRing);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8), castleIronMat);
    chain.position.y = 0.5;
    chandelier.add(chain);
    const chandelierFlameMat = new THREE.MeshBasicMaterial({ color: 0xb31322 });
    const chandelierFlames = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4), chandelierFlameMat, 8);
    const flameMatrix = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        flameMatrix.makeTranslation(Math.cos(angle) * 0.72, 0.06, Math.sin(angle) * 0.72);
        chandelierFlames.setMatrixAt(i, flameMatrix);
    }
    chandelierFlames.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    chandelierFlames.instanceMatrix.needsUpdate = true;
    chandelier.add(chandelierFlames);
    // One light replaces eight separate dynamic point lights.
    const chandelierGlow = new THREE.PointLight(0xb31322, 1.15, 6.5, 2);
    chandelierGlow.position.y = 0.02;
    chandelier.add(chandelierGlow);
    chandelier.position.set(0, 3.05, 0.15);
    castleGroup.add(chandelier);

    // Nothing in the hall architecture moves, so stop recalculating its
    // transforms every frame. Interactive furniture remains outside this group.
    castleGroup.updateMatrixWorld(true);
    castleGroup.traverse((object) => {
        object.updateMatrix();
        object.matrixAutoUpdate = false;
    });

    // Throne and the two sovereign phases.
    const throneGroup = new THREE.Group();
    throneGroup.position.set(0, 0.54, -6.62);
    scene.add(throneGroup);
    trackCullable(throneGroup, 4.4);

    const throneBackMat = new THREE.MeshStandardMaterial({
        color: 0x130509,
        emissive: 0x2b0008,
        emissiveIntensity: 0.22,
        roughness: 0.42,
        metalness: 0.42
    });
    const throneVelvetMat = new THREE.MeshStandardMaterial({
        color: 0x3a0710,
        emissive: 0x190005,
        emissiveIntensity: 0.18,
        roughness: 0.72
    });
    const throneGoldMat = new THREE.MeshStandardMaterial({
        color: 0x8c642b,
        emissive: 0x321500,
        emissiveIntensity: 0.16,
        roughness: 0.28,
        metalness: 0.82
    });
    const royalBlackMat = new THREE.MeshStandardMaterial({ color: 0x08070a, roughness: 0.5, metalness: 0.2 });
    const royalPurpleMat = new THREE.MeshStandardMaterial({ color: 0x291426, roughness: 0.58, metalness: 0.08 });
    const royalSkinMat = new THREE.MeshStandardMaterial({ color: 0x8d665f, roughness: 0.68 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff183d });
    const faceMarkMat = new THREE.MeshBasicMaterial({ color: 0x2a0611 });

    const boneDirection = new THREE.Vector3();
    const boneMidpoint = new THREE.Vector3();
    const boneUp = new THREE.Vector3(0, 1, 0);
    const placeBone = (mesh, a, b) => {
        boneDirection.subVectors(b, a);
        const length = Math.max(0.001, boneDirection.length());
        boneMidpoint.addVectors(a, b).multiplyScalar(0.5);
        mesh.position.copy(boneMidpoint);
        mesh.scale.set(1, length, 1);
        boneDirection.multiplyScalar(1 / length);
        mesh.quaternion.setFromUnitVectors(boneUp, boneDirection);
    };
    const addBone = (parent, a, b, radius, material, radial = 8) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, 1, radial), material);
        placeBone(mesh, a, b);
        parent.add(mesh);
        return mesh;
    };
    const addSkull = (parent, x, y, z, scale = 1, material = boneMat) => {
        const skullGroup = new THREE.Group();
        skullGroup.position.set(x, y, z);
        skullGroup.scale.setScalar(scale);
        const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 9), material);
        cranium.scale.set(0.92, 1.08, 0.82);
        skullGroup.add(cranium);
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.18), material);
        jaw.position.set(0, -0.19, 0.035);
        skullGroup.add(jaw);
        for (const sx of [-0.075, 0.075]) {
            const socket = new THREE.Mesh(new THREE.SphereGeometry(0.052, 7, 5), castleIronMat);
            socket.position.set(sx, 0.035, 0.18);
            skullGroup.add(socket);
        }
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.08, 3), castleIronMat);
        nose.rotation.x = Math.PI / 2;
        nose.position.set(0, -0.045, 0.205);
        skullGroup.add(nose);
        parent.add(skullGroup);
        return skullGroup;
    };

    // Broad raised platform and stairs.
    const lowerDais = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.28, 3.25), castleStoneMat);
    lowerDais.position.set(0, -0.16, 0.92);
    throneGroup.add(lowerDais);
    const upperDais = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.34, 2.72), castleStoneAltMat);
    upperDais.position.set(0, 0.08, 0.65);
    throneGroup.add(upperDais);
    for (let i = 0; i < 4; i++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(4.25 - i * 0.48, 0.13, 0.42), i % 2 ? castleStoneMat : castleStoneAltMat);
        step.position.set(0, -0.35 + i * 0.105, 2.38 + i * 0.31);
        throneGroup.add(step);
    }

    // Monumental throne shell.
    const throneBack = new THREE.Mesh(new THREE.BoxGeometry(2.48, 3.38, 0.34), throneBackMat);
    throneBack.position.set(0, 2.18, 0.08);
    throneGroup.add(throneBack);
    const velvetPanel = new THREE.Mesh(new THREE.BoxGeometry(1.78, 2.82, 0.09), throneVelvetMat);
    velvetPanel.position.set(0, 2.12, 0.285);
    throneGroup.add(velvetPanel);
    const throneSeat = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.38, 1.35), throneVelvetMat);
    throneSeat.position.set(0, 0.93, 0.77);
    throneGroup.add(throneSeat);
    const seatFront = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.24, 0.18), throneGoldMat);
    seatFront.position.set(0, 0.82, 1.43);
    throneGroup.add(seatFront);

    for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.66, 0.3), throneGoldMat);
        post.position.set(side * 1.28, 2.22, 0.08);
        throneGroup.add(post);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 1.46), throneGoldMat);
        arm.position.set(side * 1.05, 1.26, 0.84);
        throneGroup.add(arm);
        const armVelvet = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 1.16), throneVelvetMat);
        armVelvet.position.set(side * 1.05, 1.43, 0.84);
        throneGroup.add(armVelvet);
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.72, 5), throneGoldMat);
        finial.position.set(side * 1.28, 4.35, 0.08);
        throneGroup.add(finial);
        addSkull(throneGroup, side * 1.06, 1.62, 1.15, 0.72);
    }

    // Wing blades and barbs stay elaborate but are instanced into two draw calls.
    const wingBladeInstances = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1, 0.12), throneGoldMat, 8);
    const wingBarbInstances = new THREE.InstancedMesh(new THREE.ConeGeometry(0.11, 0.42, 4), throneGoldMat, 8);
    const ornamentMatrix = new THREE.Matrix4();
    const ornamentPosition = new THREE.Vector3();
    const ornamentRotation = new THREE.Quaternion();
    const ornamentScale = new THREE.Vector3(1, 1, 1);
    const ornamentEuler = new THREE.Euler();
    let wingIndex = 0;
    for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
            ornamentPosition.set(side * (1.55 + i * 0.28), 2.8 - i * 0.18, 0);
            ornamentEuler.set(0, 0, side * (0.55 + i * 0.08));
            ornamentRotation.setFromEuler(ornamentEuler);
            ornamentScale.set(1, 1.5 - i * 0.14, 1);
            ornamentMatrix.compose(ornamentPosition, ornamentRotation, ornamentScale);
            wingBladeInstances.setMatrixAt(wingIndex, ornamentMatrix);

            ornamentPosition.set(side * (1.92 + i * 0.31), 3.2 - i * 0.16, 0);
            ornamentEuler.set(0, 0, side * -0.82);
            ornamentRotation.setFromEuler(ornamentEuler);
            ornamentScale.set(1, 1, 1);
            ornamentMatrix.compose(ornamentPosition, ornamentRotation, ornamentScale);
            wingBarbInstances.setMatrixAt(wingIndex, ornamentMatrix);
            wingIndex++;
        }
    }
    wingBladeInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    wingBarbInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    wingBladeInstances.instanceMatrix.needsUpdate = true;
    wingBarbInstances.instanceMatrix.needsUpdate = true;
    throneGroup.add(wingBladeInstances, wingBarbInstances);

    // Crown crest, with five spikes rendered as one instanced ornament.
    const crestBand = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.18, 0.22), throneGoldMat);
    crestBand.position.set(0, 3.93, 0.09);
    throneGroup.add(crestBand);
    const crestXs = [-0.92, -0.46, 0, 0.46, 0.92];
    const crestSpikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.13, 0.68, 5), throneGoldMat, crestXs.length);
    crestXs.forEach((x, index) => {
        const center = x === 0;
        ornamentPosition.set(x, center ? 4.48 : 4.34, 0.08);
        ornamentRotation.identity();
        ornamentScale.set(center ? 1.385 : 1, center ? 1.353 : 1, center ? 1.385 : 1);
        ornamentMatrix.compose(ornamentPosition, ornamentRotation, ornamentScale);
        crestSpikes.setMatrixAt(index, ornamentMatrix);
    });
    crestSpikes.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    crestSpikes.instanceMatrix.needsUpdate = true;
    throneGroup.add(crestSpikes);

    // Skull mound around the platform, made with one draw call.
    const skullPileGeo = new THREE.DodecahedronGeometry(0.19, 0);
    const skullPile = new THREE.InstancedMesh(skullPileGeo, boneMat, 34);
    const skullMatrix = new THREE.Matrix4();
    for (let i = 0; i < 34; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 10);
        const x = side * (1.72 + (i % 5) * 0.36);
        const y = 0.08 + row * 0.22 + (i % 3) * 0.025;
        const z = 1.25 + (Math.floor(i / 2) % 5) * 0.34;
        const scale = 0.78 + (i % 4) * 0.06;
        skullMatrix.compose(
            new THREE.Vector3(x, y, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler((i % 3) * 0.22, (i % 7) * 0.41, (i % 5) * 0.15)),
            new THREE.Vector3(scale, scale * 0.9, scale)
        );
        skullPile.setMatrixAt(i, skullMatrix);
    }
    skullPile.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    skullPile.instanceMatrix.needsUpdate = true;
    throneGroup.add(skullPile);

    // ONLINE PHASE: relaxed, intimidating sovereign with one hand at the chin.
    const kingGroup = new THREE.Group();
    kingGroup.scale.setScalar(1.12);
    kingGroup.position.set(0, -0.03, 0.03);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 1.12, 10), royalPurpleMat);
    torso.position.set(0, 1.68, 0.65);
    torso.rotation.x = -0.08;
    kingGroup.add(torso);
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.12), royalBlackMat);
    chestPlate.position.set(0, 1.78, 1.03);
    chestPlate.rotation.x = -0.08;
    kingGroup.add(chestPlate);
    for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.08), throneGoldMat);
        lapel.position.set(side * 0.23, 1.72, 1.105);
        lapel.rotation.z = side * 0.28;
        kingGroup.add(lapel);
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 7), royalPurpleMat);
        shoulder.scale.set(1.2, 0.75, 1.0);
        shoulder.position.set(side * 0.5, 1.93, 0.69);
        kingGroup.add(shoulder);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.22, 9), royalSkinMat);
    neck.position.set(0, 2.22, 0.72);
    kingGroup.add(neck);
    const kingHead = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), royalSkinMat);
    kingHead.scale.set(0.9, 1.12, 0.88);
    kingHead.position.set(0, 2.5, 0.75);
    kingHead.rotation.z = -0.08;
    kingGroup.add(kingHead);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.18, 0.28), royalSkinMat);
    jaw.position.set(0, 2.29, 0.82);
    kingGroup.add(jaw);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 4), royalSkinMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 2.49, 1.06);
    kingGroup.add(nose);
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.043, 9, 7), eyeMat);
        eye.position.set(side * 0.115, 2.57, 1.045);
        kingGroup.add(eye);
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.035, 0.035), royalBlackMat);
        brow.position.set(side * 0.115, 2.67, 1.035);
        brow.rotation.z = side * -0.18;
        kingGroup.add(brow);
        const cheekMark = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.025), faceMarkMat);
        cheekMark.position.set(side * 0.16, 2.43, 1.055);
        cheekMark.rotation.z = side * 0.55;
        kingGroup.add(cheekMark);
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), royalSkinMat);
        ear.scale.set(0.55, 1.0, 0.7);
        ear.position.set(side * 0.31, 2.51, 0.74);
        kingGroup.add(ear);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.025), faceMarkMat);
    mouth.position.set(0, 2.34, 1.055);
    kingGroup.add(mouth);

    // Spiked dark hair and crown integrated together.
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.355, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), royalBlackMat);
    hairCap.position.set(0, 2.68, 0.73);
    hairCap.rotation.x = -0.2;
    kingGroup.add(hairCap);
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const hairSpike = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.34 + (i % 3) * 0.06, 5), royalBlackMat);
        hairSpike.position.set(Math.cos(angle) * 0.25, 2.93 + (i % 2) * 0.04, 0.72 + Math.sin(angle) * 0.18);
        hairSpike.rotation.z = Math.cos(angle) * -0.38;
        hairSpike.rotation.x = Math.sin(angle) * 0.38;
        kingGroup.add(hairSpike);
    }
    const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.13, 10), throneGoldMat);
    crownBand.position.set(0, 2.91, 0.72);
    kingGroup.add(crownBand);
    for (const x of [-0.23, 0, 0.23]) {
        const crownPoint = new THREE.Mesh(new THREE.ConeGeometry(0.075, x === 0 ? 0.46 : 0.34, 5), throneGoldMat);
        crownPoint.position.set(x, x === 0 ? 3.22 : 3.14, 0.72);
        kingGroup.add(crownPoint);
    }

    // Arms: left draped over armrest, right elbow planted with hand at chin.
    addBone(kingGroup, new THREE.Vector3(-0.48, 1.9, 0.72), new THREE.Vector3(-0.76, 1.5, 0.98), 0.11, royalPurpleMat);
    addBone(kingGroup, new THREE.Vector3(-0.76, 1.5, 0.98), new THREE.Vector3(-0.88, 1.25, 1.22), 0.095, royalPurpleMat);
    const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), royalSkinMat);
    leftHand.position.set(-0.88, 1.25, 1.22);
    leftHand.scale.set(1.25, 0.72, 0.9);
    kingGroup.add(leftHand);

    addBone(kingGroup, new THREE.Vector3(0.48, 1.91, 0.72), new THREE.Vector3(0.79, 1.48, 1.02), 0.11, royalPurpleMat);
    addBone(kingGroup, new THREE.Vector3(0.79, 1.48, 1.02), new THREE.Vector3(0.32, 2.22, 1.03), 0.09, royalPurpleMat);
    const chinHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), royalSkinMat);
    chinHand.position.set(0.3, 2.23, 1.04);
    chinHand.scale.set(1.15, 0.75, 0.9);
    kingGroup.add(chinHand);
    for (let i = 0; i < 4; i++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, 0.19, 6), royalSkinMat);
        finger.position.set(0.22 + i * 0.045, 2.28 + i * 0.008, 1.07);
        finger.rotation.z = 0.3;
        kingGroup.add(finger);
    }

    // Legs: one planted forward, the other crossed in a relaxed dominant pose.
    addBone(kingGroup, new THREE.Vector3(-0.25, 1.18, 0.72), new THREE.Vector3(-0.42, 0.72, 1.28), 0.16, royalPurpleMat, 10);
    addBone(kingGroup, new THREE.Vector3(-0.42, 0.72, 1.28), new THREE.Vector3(-0.58, 0.23, 1.68), 0.14, royalPurpleMat, 10);
    const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.58), royalBlackMat);
    leftBoot.position.set(-0.58, 0.18, 1.84);
    leftBoot.rotation.x = -0.15;
    kingGroup.add(leftBoot);

    addBone(kingGroup, new THREE.Vector3(0.26, 1.18, 0.72), new THREE.Vector3(0.52, 0.98, 1.22), 0.16, royalPurpleMat, 10);
    addBone(kingGroup, new THREE.Vector3(0.52, 0.98, 1.22), new THREE.Vector3(-0.12, 0.83, 1.52), 0.14, royalPurpleMat, 10);
    const crossedBoot = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.22, 0.6), royalBlackMat);
    crossedBoot.position.set(-0.22, 0.78, 1.7);
    crossedBoot.rotation.z = 0.18;
    crossedBoot.rotation.y = -0.28;
    kingGroup.add(crossedBoot);
    throneGroup.add(kingGroup);

    // OFFLINE PHASE: crowned skeletal sovereign in the same commanding pose.
    const offlineGroup = new THREE.Group();
    offlineGroup.scale.setScalar(1.12);
    offlineGroup.position.set(0, -0.03, 0.03);
    // A rear cape instead of an inverted cone. The old cone crossed the ribs and
    // read as giant black straps from the kneeling camera. These panels stay
    // behind the skeleton and never intersect the body.
    const capeMat = new THREE.MeshStandardMaterial({
        color: 0x130812,
        emissive: 0x26000b,
        emissiveIntensity: 0.16,
        roughness: 0.78,
        side: THREE.DoubleSide
    });
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 1.62), capeMat);
    cape.position.set(0, 1.5, 0.39);
    offlineGroup.add(cape);
    const capeTail = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.82), capeMat);
    capeTail.position.set(0, 0.78, 0.36);
    capeTail.rotation.x = -0.18;
    offlineGroup.add(capeTail);
    const mantle = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.18, 0.16), royalPurpleMat);
    mantle.position.set(0, 1.96, 0.52);
    offlineGroup.add(mantle);
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.92, 8), boneMat);
    spine.position.set(0, 1.63, 0.72);
    offlineGroup.add(spine);
    for (let i = 0; i < 6; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.28 + i * 0.018, 0.032, 6, 16, Math.PI), boneMat);
        rib.position.set(0, 1.48 + i * 0.1, 0.78);
        rib.rotation.z = Math.PI;
        offlineGroup.add(rib);
    }
    const offlineSkull = addSkull(offlineGroup, 0, 2.5, 0.78, 1.48);
    const jawCrownBand = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.13, 10), throneGoldMat);
    jawCrownBand.position.set(0, 2.95, 0.78);
    offlineGroup.add(jawCrownBand);
    for (const x of [-0.23, 0, 0.23]) {
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.075, x === 0 ? 0.48 : 0.36, 5), throneGoldMat);
        point.position.set(x, x === 0 ? 3.27 : 3.18, 0.78);
        offlineGroup.add(point);
    }
    const offlineEyeMat = new THREE.MeshBasicMaterial({ color: 0x8b001d });
    for (const x of [-0.11, 0.11]) {
        const ember = new THREE.Mesh(new THREE.SphereGeometry(0.033, 7, 5), offlineEyeMat);
        ember.position.set(x, 2.55, 1.04);
        offlineGroup.add(ember);
    }
    addBone(offlineGroup, new THREE.Vector3(-0.38, 1.92, 0.74), new THREE.Vector3(-0.76, 1.5, 1.0), 0.052, boneMat);
    addBone(offlineGroup, new THREE.Vector3(-0.76, 1.5, 1.0), new THREE.Vector3(-0.9, 1.25, 1.22), 0.045, boneMat);
    addSkull(offlineGroup, -0.9, 1.24, 1.21, 0.38, boneMat);
    addBone(offlineGroup, new THREE.Vector3(0.38, 1.92, 0.74), new THREE.Vector3(0.78, 1.48, 1.03), 0.052, boneMat);
    addBone(offlineGroup, new THREE.Vector3(0.78, 1.48, 1.03), new THREE.Vector3(0.3, 2.2, 1.04), 0.045, boneMat);
    const bonyHand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), boneMat);
    bonyHand.position.set(0.3, 2.2, 1.04);
    offlineGroup.add(bonyHand);
    addBone(offlineGroup, new THREE.Vector3(-0.2, 1.12, 0.73), new THREE.Vector3(-0.42, 0.7, 1.28), 0.065, boneMat);
    addBone(offlineGroup, new THREE.Vector3(-0.42, 0.7, 1.28), new THREE.Vector3(-0.6, 0.23, 1.66), 0.055, boneMat);
    addBone(offlineGroup, new THREE.Vector3(0.2, 1.12, 0.73), new THREE.Vector3(0.5, 0.98, 1.21), 0.065, boneMat);
    addBone(offlineGroup, new THREE.Vector3(0.5, 0.98, 1.21), new THREE.Vector3(-0.14, 0.82, 1.52), 0.055, boneMat);
    throneGroup.add(offlineGroup);

    const throneGlow = new THREE.PointLight(0x9b0b28, 1.35, 6.5, 2);
    throneGlow.position.set(0, 2.25, 1.6);
    throneGroup.add(throneGlow);

    const plaqueCanvas = document.createElement('canvas');
    plaqueCanvas.width = 768;
    plaqueCanvas.height = 190;
    const plaqueCtx = plaqueCanvas.getContext('2d');
    const plaqueTexture = new THREE.CanvasTexture(plaqueCanvas);
    plaqueTexture.colorSpace = THREE.SRGBColorSpace;
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.59), new THREE.MeshBasicMaterial({ map: plaqueTexture, transparent: true }));
    plaque.position.set(0, 4.66, 0.36);
    throneGroup.add(plaque);

    // Freeze the entire static throne hierarchy. Visibility, material values and
    // plaque textures can still change without recalculating hundreds of matrices.
    throneGroup.updateMatrixWorld(true);
    throneGroup.traverse((object) => {
        object.updateMatrix();
        object.matrixAutoUpdate = false;
    });

    let kingPresence = { status: 'offline', message: 'The throne stands silent.', online: false };
    function drawPresencePlaque() {
        plaqueCtx.clearRect(0, 0, 768, 190);
        plaqueCtx.fillStyle = 'rgba(7, 2, 5, 0.96)';
        plaqueCtx.fillRect(0, 0, 768, 190);
        plaqueCtx.strokeStyle = kingPresence.online ? '#d41435' : '#9f927b';
        plaqueCtx.lineWidth = 9;
        plaqueCtx.strokeRect(7, 7, 754, 176);
        plaqueCtx.textAlign = 'center';
        plaqueCtx.fillStyle = '#efe4cf';
        plaqueCtx.font = 'bold 38px serif';
        plaqueCtx.fillText('THE SOVEREIGN', 384, 56);
        plaqueCtx.fillStyle = kingPresence.online ? '#ff3155' : '#c2b49b';
        plaqueCtx.font = 'bold 30px monospace';
        plaqueCtx.fillText(String(kingPresence.status || 'offline').toUpperCase(), 384, 106);
        plaqueCtx.fillStyle = '#c7baa5';
        plaqueCtx.font = '22px serif';
        const detail = String(kingPresence.message || '').slice(0, 58);
        plaqueCtx.fillText(detail || 'No decree has been posted.', 384, 151);
        plaqueTexture.needsUpdate = true;
    }

    function setKingPresence(next = {}) {
        const status = ['online', 'busy', 'sleeping', 'offline'].includes(next.status) ? next.status : 'offline';
        kingPresence = { status, message: String(next.message || ''), online: next.online === true && status !== 'offline' };
        kingGroup.visible = kingPresence.online;
        offlineGroup.visible = !kingPresence.online;
        eyeMat.color.setHex(status === 'busy' ? 0xff6a00 : status === 'sleeping' ? 0x701020 : 0xff183d);
        throneBackMat.emissiveIntensity = kingPresence.online ? 0.46 : 0.12;
        throneGlow.intensity = kingPresence.online ? 1.55 : 0.72;
        drawPresencePlaque();
    }
    setKingPresence(kingPresence);

    const kneelTarget = new THREE.Vector3(0, 0, -2.36);
    const kneelLook = new THREE.Vector3(0, 2.48, -6.16);
    interactables.push({
        mesh: throneSeat,
        action: 'kneelThrone',
        get label() { return kingPresence.online ? 'Kneel Before My Lord' : 'Kneel at the Bone Throne'; },
        kneelWorldPos: kneelTarget,
        kneelLookAt: kneelLook,
        kneelExitPos: new THREE.Vector3(1.45, 1.5, -2.18)
    });

    // Toggleable skeletal pianist. Off: standing beside the piano. On: seated,
    // facing the keyboard and physically depressing keys while real recordings play.
    const servantGroup = new THREE.Group();
    servantGroup.name = 'gothic-skeleton-servant';
    scene.add(servantGroup);
    trackCullable(servantGroup, 1.5);

    const servantSkull = addSkull(servantGroup, 0, 1.56, 0, 0.92);
    const servantJaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), boneMat);
    servantJaw.position.set(0, 1.36, 0.04);
    servantGroup.add(servantJaw);
    const servantSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, 0.68, 7), boneMat);
    servantSpine.position.set(0, 1.05, 0);
    servantGroup.add(servantSpine);
    for (let i = 0; i < 5; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.18 - i * 0.014, 0.023, 5, 12, Math.PI), boneMat);
        rib.position.set(0, 1.28 - i * 0.095, 0);
        rib.rotation.z = Math.PI;
        servantGroup.add(rib);
    }
    const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 6, 12, Math.PI), boneMat);
    pelvis.position.set(0, 0.73, 0);
    pelvis.rotation.z = Math.PI;
    servantGroup.add(pelvis);

    const leftUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 1, 7), boneMat);
    const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 1, 7), boneMat);
    const rightUpperArm = leftUpperArm.clone();
    const rightForearm = leftForearm.clone();
    servantGroup.add(leftUpperArm, leftForearm, rightUpperArm, rightForearm);

    const servantHands = [];
    for (const side of [-1, 1]) {
        const hand = new THREE.Group();
        const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.055, 0.1), boneMat);
        hand.add(palm);
        for (let i = 0; i < 5; i++) {
            const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.16, 5), boneMat);
            finger.rotation.x = Math.PI / 2;
            finger.position.set((i - 2) * 0.026, -0.018, -0.07);
            hand.add(finger);
        }
        servantGroup.add(hand);
        servantHands.push(hand);
    }

    // Legs/feet remain visible in both standing and seated states.
    const servantLegs = [];
    for (const side of [-1, 1]) {
        const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 1, 7), boneMat);
        const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 1, 7), boneMat);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.28), boneMat);
        servantGroup.add(thigh, shin, foot);
        servantLegs.push({ side, thigh, shin, foot });
    }

    const servantStandingPos = new THREE.Vector3(floorLayout.piano.x - 1.18, 0, floorLayout.piano.z - 1.30);
    const servantPianoPos = new THREE.Vector3(floorLayout.piano.x - 0.88, 0, floorLayout.piano.z);
    servantGroup.position.copy(servantStandingPos);
    servantGroup.rotation.y = -0.48;

    const servantTracks = [
        {
            title: "Beethoven's Fifth — ominous piano",
            url: 'assets/beethoven-fifth-piano.mp3',
            beat: 0.29,
            pattern: [['D4','A4'],['D4','F4'],['D4','A4'],['C#4','G4'],['D4','A4'],['F4','C5'],['E4','A4'],['D4','A4']]
        },
        {
            title: 'Für Elise — haunted opening',
            url: 'assets/fur-elise-piano.mp3',
            beat: 0.34,
            pattern: [['E5'],['D#5'],['E5'],['D#5'],['E5'],['B4'],['D5'],['C5'],['A4','E5']]
        },
        {
            title: 'Greensleeves — dark hall variation',
            url: 'assets/greensleeves.ogg',
            beat: 0.42,
            pattern: [['A4','E5'],['C5'],['D5'],['E5'],['F5','A4'],['E5'],['D5'],['B4']]
        }
    ];
    let servantActive = false;
    let servantTrackIndex = 0;
    let servantAudio = null;
    let servantLastBeat = -1;
    const servantLeftTarget = new THREE.Vector3(-0.26, 1.0, -0.52);
    const servantRightTarget = new THREE.Vector3(0.26, 1.0, -0.52);
    const tmpKeyWorld = new THREE.Vector3();
    const tmpKeyLocal = new THREE.Vector3();
    const servantHips = [new THREE.Vector3(), new THREE.Vector3()];
    const servantKnees = [new THREE.Vector3(), new THREE.Vector3()];
    const servantAnkles = [new THREE.Vector3(), new THREE.Vector3()];
    const leftShoulder = new THREE.Vector3(-0.2, 1.24, 0);
    const rightShoulder = new THREE.Vector3(0.2, 1.24, 0);
    const leftElbow = new THREE.Vector3();
    const rightElbow = new THREE.Vector3();
    const servantLeftPoseTarget = new THREE.Vector3();
    const servantRightPoseTarget = new THREE.Vector3();
    let servantLeftPress = 0;
    let servantRightPress = 0;
    let servantAnimationTime = 0;

    function stopServantAudio(reset = false) {
        if (!servantAudio) return;
        servantAudio.pause();
        if (reset) servantAudio.currentTime = 0;
    }

    function startServantTrack(index = servantTrackIndex) {
        servantTrackIndex = (index + servantTracks.length) % servantTracks.length;
        const track = servantTracks[servantTrackIndex];
        stopServantAudio(true);
        servantAudio = new Audio(track.url);
        servantAudio.preload = 'auto';
        servantAudio.volume = 0.62;
        servantAudio.addEventListener('ended', () => {
            if (!servantActive) return;
            startServantTrack(servantTrackIndex + 1);
        }, { once: true });
        servantLastBeat = -1;
        const result = servantAudio.play();
        if (result?.catch) {
            result.catch(() => showMessage('Click the skeleton again to allow the real piano recording.'));
        }
        showMessage(`The bone pianist performs ${track.title}.`);
    }

    function toggleServant() {
        servantActive = !servantActive;
        servantLastBeat = -1;
        if (servantActive) {
            startServantTrack(servantTrackIndex);
        } else {
            stopServantAudio(false);
            showMessage('The bone pianist rises and waits beside the piano.');
        }
    }

    interactables.push({
        mesh: servantSkull.children[0],
        action: toggleServant,
        get label() { return servantActive ? 'Dismiss Bone Pianist' : 'Command Bone Pianist to Play'; }
    });

    function aimServantHandAtKey(key, target) {
        if (!key) return;
        pressPianoKeyVisual(key, 1);
        key.getWorldPosition(tmpKeyWorld);
        servantGroup.worldToLocal(tmpKeyLocal.copy(tmpKeyWorld));
        target.copy(tmpKeyLocal);
        target.y += 0.105;
        target.z += 0.015;
    }

    updatables.push({
        update: (dt) => {
            servantAnimationTime += dt;

            const targetPos = servantActive ? servantPianoPos : servantStandingPos;
            servantGroup.position.lerp(targetPos, Math.min(1, dt * 4.2));
            const targetYaw = servantActive ? Math.PI / 2 : -0.48;
            let yawDiff = targetYaw - servantGroup.rotation.y;
            while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
            while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
            servantGroup.rotation.y += yawDiff * Math.min(1, dt * 4.2);

            servantSkull.position.y += ((servantActive ? 1.48 : 1.56) - servantSkull.position.y) * Math.min(1, dt * 6);
            servantJaw.position.y += ((servantActive ? 1.28 : 1.36) - servantJaw.position.y) * Math.min(1, dt * 6);
            servantSkull.rotation.y = servantActive ? 0 : Math.sin(servantAnimationTime * 1.2) * 0.16;

            // Pose the legs without allocating temporary vectors every frame.
            for (let i = 0; i < servantLegs.length; i++) {
                const leg = servantLegs[i];
                const side = leg.side;
                const hip = servantHips[i].set(side * 0.1, 0.73, 0);
                const knee = servantKnees[i];
                const ankle = servantAnkles[i];
                if (servantActive) {
                    knee.set(side * 0.14, 0.52, 0.34);
                    ankle.set(side * 0.17, 0.18, 0.18);
                } else {
                    knee.set(side * 0.11, 0.42, 0);
                    ankle.set(side * 0.11, 0.08, 0);
                }
                placeBone(leg.thigh, hip, knee);
                placeBone(leg.shin, knee, ankle);
                leg.foot.position.copy(ankle);
                leg.foot.position.y -= 0.03;
                leg.foot.position.z += servantActive ? 0.11 : 0.08;
                leg.foot.rotation.x = servantActive ? -0.2 : 0;
            }

            if (servantActive && servantAudio && !servantAudio.paused) {
                const track = servantTracks[servantTrackIndex];
                const beatIndex = Math.floor(servantAudio.currentTime / track.beat);
                if (beatIndex !== servantLastBeat) {
                    servantLastBeat = beatIndex;
                    const notes = track.pattern[beatIndex % track.pattern.length];
                    const firstKey = pianoKeyByNote.get(notes[0]);
                    const secondKey = notes[1] ? pianoKeyByNote.get(notes[1]) : null;
                    if (secondKey) {
                        aimServantHandAtKey(firstKey, servantLeftTarget);
                        aimServantHandAtKey(secondKey, servantRightTarget);
                        servantLeftPress = 1;
                        servantRightPress = 1;
                    } else if (beatIndex % 2 === 0) {
                        aimServantHandAtKey(firstKey, servantLeftTarget);
                        servantLeftPress = 1;
                    } else {
                        aimServantHandAtKey(firstKey, servantRightTarget);
                        servantRightPress = 1;
                    }
                }
            } else {
                servantLeftTarget.set(-0.24, 0.9, servantActive ? 0.52 : 0.06);
                servantRightTarget.set(0.24, 0.9, servantActive ? 0.52 : 0.06);
            }

            servantLeftPress = Math.max(0, servantLeftPress - dt * 7.5);
            servantRightPress = Math.max(0, servantRightPress - dt * 7.5);
            servantLeftPoseTarget.copy(servantLeftTarget);
            servantRightPoseTarget.copy(servantRightTarget);
            servantLeftPoseTarget.y -= servantLeftPress * 0.085;
            servantRightPoseTarget.y -= servantRightPress * 0.085;

            const leftHand = servantHands[0];
            const rightHand = servantHands[1];
            leftHand.position.lerp(servantLeftPoseTarget, Math.min(1, dt * 15));
            rightHand.position.lerp(servantRightPoseTarget, Math.min(1, dt * 15));
            leftHand.rotation.x = servantActive ? -0.45 : 0;
            rightHand.rotation.x = servantActive ? -0.45 : 0;

            leftElbow.copy(leftShoulder).lerp(leftHand.position, 0.52);
            leftElbow.x -= 0.08;
            leftElbow.y -= 0.04;
            leftElbow.z += 0.08;
            rightElbow.copy(rightShoulder).lerp(rightHand.position, 0.52);
            rightElbow.x += 0.08;
            rightElbow.y -= 0.04;
            rightElbow.z += 0.08;
            placeBone(leftUpperArm, leftShoulder, leftElbow);
            placeBone(leftForearm, leftElbow, leftHand.position);
            placeBone(rightUpperArm, rightShoulder, rightElbow);
            placeBone(rightForearm, rightElbow, rightHand.position);
        }
    });

    // Player/camera collision uses the same solved footprints as rendering, so
    // the camera cannot enter the throne stairs or any major furniture.
    const collisionBoxes = [
        { id: 'throne', minX: -3.28, maxX: 3.28, minZ: -7.46, maxZ: -2.92 },
        { id: 'bed', minX: floorLayout.bed.x - 1.16, maxX: floorLayout.bed.x + 1.16, minZ: floorLayout.bed.z - 1.58, maxZ: floorLayout.bed.z + 1.58 },
        { id: 'desk', minX: floorLayout.desk.x - 1.62, maxX: floorLayout.desk.x + 1.62, minZ: floorLayout.desk.z - 0.84, maxZ: floorLayout.desk.z + 0.54 },
        { id: 'fridge', minX: floorLayout.fridge.x - 0.52, maxX: floorLayout.fridge.x + 0.52, minZ: floorLayout.fridge.z - 0.52, maxZ: floorLayout.fridge.z + 0.52 },
        { id: 'piano', minX: floorLayout.piano.x - 0.62, maxX: floorLayout.piano.x + 0.62, minZ: floorLayout.piano.z - 1.48, maxZ: floorLayout.piano.z + 1.48 },
        ...columnPositions.map(([x, z], index) => ({
            id: `column-${index + 1}`,
            minX: x - 0.31,
            maxX: x + 0.31,
            minZ: z - 0.31,
            maxZ: z + 0.31
        }))
    ];

    return {
        interactables,
        collisionBoxes,
        updatables,
        cullables,
        updatePC: (dt) => {
            pcSystem.update(dt);
            if (pcSystem.consumePreviewDirty()) pcScreenTex.needsUpdate = true;
        },
        closePCSession: () => pcSystem.close(true),
        setPerformanceOptions: (options = {}) => {
            if (options.quality) performanceOptions.quality = options.quality;
            if (options.pcPreview) performanceOptions.pcPreview = options.pcPreview;

            const quality = performanceOptions.quality;
            // Point lights are the heaviest part of this MeshStandardMaterial
            // scene. Keep the global shader light count tightly bounded even on
            // Quality; emissive meshes preserve the local glow appearance.
            for (const light of optionalLights) light.visible = false;
            roomLight.visible = quality !== 'performance';
            chandelierGlow.visible = quality !== 'performance';
            throneGlow.visible = quality !== 'performance';
            streetGlow.visible = false;
            deskLight.visible = false;
            bedUnderglow.visible = false;
            radioLight.visible = false;
            interiorLight.visible = false;
            pcRgbLight.visible = quality === 'quality';
            monitorGlow.visible = quality === 'quality';

            const textureAnisotropy = quality === 'quality' ? 4 : quality === 'balanced' ? 2 : 1;
            for (const texture of [wallpaperTex, floorTex, ceilingTex]) {
                texture.anisotropy = textureAnisotropy;
                texture.needsUpdate = true;
            }
            pcSystem.setPreviewMode(performanceOptions.pcPreview);
        },
        triggerPcBurst,
        setKingPresence,
        fanGroup,
        bladeGroup,
        fanSpeed: () => fanSpeed,
        setFanSpeed: (s) => { fanSpeed = s; },
        setCatTracking: (tracking, pos) => {
            if (tracking) {
                catState = 'tracking';
                playerRef = pos;
                updateCatFace('O w O');
            } else if (catState === 'tracking') {
                catState = 'sleeping';
                catStateTime = 0;
                catHead.rotation.x = 0;
                catHead.rotation.y = 0;
                playerRef = null;
                updateCatFace('- w -');
            }
        },
        petCat: () => {
            catState = 'petting';
            catStateTime = 0;
            updateCatFace('^ w ^');
        },
        setPlayerRef: (ref) => { playerRef = ref; },
        playPianoKey,
        triggerPianoScare,
        pianoKeyMap,
        pianoGroup,
        fridgeGroup,
        getDebugState: () => ({
            catState,
            currentCatFace,
            currentBookPage,
            currentBookTitle: bookPages[currentBookPage].title,
            bookPageCount: bookPages.length,
            isBookAutoPlaying,
            pianoKeyCount: pianoKeyDefs.length,
            pianoKeyLabels: pianoKeyDefs.map((key) => key.label).join(' '),
            roomDetailVersion: 14,
            kingdom: {
                status: kingPresence.status,
                online: kingPresence.online,
                message: kingPresence.message,
                servantActive,
                layout: 'expanded gothic hall with monumental throne, two sovereign phases, and animated bone pianist'
            },
            pcRgbOn,
            pc: pcSystem.getDebugState(),
            posterScroll,
            fridge: {
                open: fridgeOpen,
                items: fridgeItems.map((item) => ({
                    label: item.label,
                    available: item.available,
                    visible: item.mesh.visible,
                    restockMs: Math.round(item.restockRemaining * 1000)
                }))
            }
        })
    };
}
