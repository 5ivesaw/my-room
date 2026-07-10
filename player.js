import * as THREE from 'three';

export class Player {
    constructor(camera, domElement, sfx) {
        this.camera = camera;
        this.domElement = domElement;
        this.sfx = sfx;
        this.stepTimer = 0;
        
        this.pitchObject = new THREE.Object3D();
        this.pitchObject.add(camera);
        
        this.yawObject = new THREE.Object3D();
        this.yawObject.position.set(-2.75, 1.5, -0.45); // Start in bed
        this.yawObject.add(this.pitchObject);
        
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;

        this.isLocked = false;
        this.allowLook = true;
        this.speed = 3.0; // Kinematic speed
        this.pendingMouseX = 0;
        this.pendingMouseY = 0;
        this.playerRadius = 0.32;
        this.collisionBoxes = [];
        
        // Mouse look
        const onMouseMove = (event) => {
            if (document.body.classList.contains('mobile-input')) return;
            if (!this.isLocked || !this.allowLook) return;
            const movementX = event.movementX || 0;
            const movementY = event.movementY || 0;
            
            // Ignore massive mouse delta jumps (often happens when locking pointer)
            if (Math.abs(movementX) > 300 || Math.abs(movementY) > 300) return;
            
            // Coalesce high-polling-rate mouse events and apply once per frame.
            this.pendingMouseX += movementX;
            this.pendingMouseY += movementY;
        };
        
        document.addEventListener('mousemove', onMouseMove, false);
        
        // Keyboard
        const onKeyDown = (event) => {
            if (document.body.classList.contains('pc-open')) return;
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW': this.moveForward = true; break;
                case 'ArrowLeft':
                case 'KeyA': this.moveLeft = true; break;
                case 'ArrowDown':
                case 'KeyS': this.moveBackward = true; break;
                case 'ArrowRight':
                case 'KeyD': this.moveRight = true; break;
            }
        };
        
        const onKeyUp = (event) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW': this.moveForward = false; break;
                case 'ArrowLeft':
                case 'KeyA': this.moveLeft = false; break;
                case 'ArrowDown':
                case 'KeyS': this.moveBackward = false; break;
                case 'ArrowRight':
                case 'KeyD': this.moveRight = false; break;
            }
        };
        
        document.addEventListener('keydown', onKeyDown, false);
        document.addEventListener('keyup', onKeyUp, false);

        this.headBobTime = 0;
    }
    

    updateLook() {
        if (!this.isLocked || !this.allowLook || document.body.classList.contains('mobile-input')) {
            this.pendingMouseX = 0;
            this.pendingMouseY = 0;
            return;
        }
        const maxDelta = 420;
        const dx = Math.max(-maxDelta, Math.min(maxDelta, this.pendingMouseX));
        const dy = Math.max(-maxDelta, Math.min(maxDelta, this.pendingMouseY));
        this.pendingMouseX = 0;
        this.pendingMouseY = 0;
        this.yawObject.rotation.y -= dx * 0.002;
        this.pitchObject.rotation.x -= dy * 0.002;
        this.pitchObject.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitchObject.rotation.x));
    }

    setCollisionBoxes(boxes = []) {
        this.collisionBoxes = boxes
            .filter((box) => box && Number.isFinite(box.minX) && Number.isFinite(box.maxX) && Number.isFinite(box.minZ) && Number.isFinite(box.maxZ))
            .map((box) => ({
                id: String(box.id || 'obstacle'),
                minX: Math.min(box.minX, box.maxX),
                maxX: Math.max(box.minX, box.maxX),
                minZ: Math.min(box.minZ, box.maxZ),
                maxZ: Math.max(box.minZ, box.maxZ)
            }));
    }

    lock() {
        if (document.body.classList.contains('mobile-input')) {
            this.isLocked = true;
            return;
        }

        if (this.domElement.requestPointerLock) {
            try {
                const result = this.domElement.requestPointerLock();
                if (result && typeof result.catch === 'function') {
                    result.catch(() => {
                        this.isLocked = true;
                    });
                }
            } catch {
                this.isLocked = true;
            }
        } else {
            this.isLocked = true;
        }
    }
    
    update(dt) {
        if (!this.isLocked) return;
        
        // Determine intended movement direction
        let moveZ = Number(this.moveForward) - Number(this.moveBackward);
        let moveX = Number(this.moveRight) - Number(this.moveLeft);
        
        this.direction.set(moveX, 0, moveZ);
        
        // Only normalize if there's input (prevents NaN teleportation bugs)
        if (this.direction.lengthSq() > 0.01) {
            this.direction.normalize();
        } else {
            this.direction.set(0, 0, 0);
        }
        
        // Kinematic smooth movement (no bouncy physics)
        const moveDistance = this.speed * dt;
        
        const prevX = this.yawObject.position.x;
        const prevZ = this.yawObject.position.z;
        
        // translateZ takes negative values for forward
        this.yawObject.translateZ(-this.direction.z * moveDistance);
        this.yawObject.translateX(this.direction.x * moveDistance);
        
        let newX = this.yawObject.position.x;
        let newZ = this.yawObject.position.z;

        let moved = false;
        if (this.moveForward || this.moveBackward || this.moveLeft || this.moveRight) {
            moved = true;
        }

        if (moved) {
            this.stepTimer += dt;
            if (this.stepTimer > 0.4) {
                this.stepTimer = 0;
                const stepName = Math.random() < 0.5 ? 'step1' : 'step2';
                if (this.sfx) this.sfx.play(stepName, false, 0.4); // soft footstep
            }
        } else {
            this.stepTimer = 0.35; // so next step is almost immediate
        }

        // Expanded castle bounds. The camera is treated as a circle on the X/Z
        // plane. Obstacles are expanded by that radius (Minkowski sum), then X
        // and Z are solved separately so movement slides cleanly along edges.
        const roomMinX = -5.55;
        const roomMaxX = 5.55;
        const roomMinZ = -7.45;
        const roomMaxZ = 5.55;
        const radius = this.playerRadius;
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const targetX = clamp(newX, roomMinX, roomMaxX);
        const targetZ = clamp(newZ, roomMinZ, roomMaxZ);
        const boxes = this.collisionBoxes.length ? this.collisionBoxes : [
            { id: 'throne', minX: -2.15, maxX: 2.15, minZ: -7.45, maxZ: -5.42 },
            { id: 'desk', minX: 2.62, maxX: 5.55, minZ: 2.72, maxZ: 4.52 },
            { id: 'fridge', minX: -5.55, maxX: -4.78, minZ: 1.67, maxZ: 2.72 },
            { id: 'piano', minX: -5.55, maxX: -3.48, minZ: 2.72, maxZ: 5.55 },
            { id: 'bed', minX: -5.55, maxX: -3.58, minZ: -3.48, maxZ: -0.28 }
        ];

        const expanded = boxes.map((box) => ({
            minX: box.minX - radius,
            maxX: box.maxX + radius,
            minZ: box.minZ - radius,
            maxZ: box.maxZ + radius
        }));

        // Resolve X first while keeping the previous Z. This prevents diagonal
        // corner tunnelling and naturally produces wall sliding.
        newX = targetX;
        newZ = prevZ;
        for (const box of expanded) {
            if (newZ <= box.minZ || newZ >= box.maxZ) continue;
            if (newX <= box.minX || newX >= box.maxX) continue;
            if (prevX <= box.minX) newX = box.minX;
            else if (prevX >= box.maxX) newX = box.maxX;
            else newX = Math.abs(newX - box.minX) < Math.abs(box.maxX - newX) ? box.minX : box.maxX;
        }

        // Resolve Z with the already-safe X coordinate.
        newZ = targetZ;
        for (const box of expanded) {
            if (newX <= box.minX || newX >= box.maxX) continue;
            if (newZ <= box.minZ || newZ >= box.maxZ) continue;
            if (prevZ <= box.minZ) newZ = box.minZ;
            else if (prevZ >= box.maxZ) newZ = box.maxZ;
            else newZ = Math.abs(newZ - box.minZ) < Math.abs(box.maxZ - newZ) ? box.minZ : box.maxZ;
        }

        // Final depenetration pass protects against teleports, resize glitches,
        // or future furniture changes that place the player inside a footprint.
        for (let pass = 0; pass < 2; pass++) {
            for (const box of expanded) {
                if (!(newX > box.minX && newX < box.maxX && newZ > box.minZ && newZ < box.maxZ)) continue;
                const distances = [
                    { axis: 'x', value: box.minX, distance: newX - box.minX },
                    { axis: 'x', value: box.maxX, distance: box.maxX - newX },
                    { axis: 'z', value: box.minZ, distance: newZ - box.minZ },
                    { axis: 'z', value: box.maxZ, distance: box.maxZ - newZ }
                ];
                distances.sort((a, b) => a.distance - b.distance);
                const nearest = distances[0];
                if (nearest.axis === 'x') newX = nearest.value;
                else newZ = nearest.value;
            }
        }

        this.yawObject.position.x = newX;
        this.yawObject.position.z = newZ;
        
        // Head bob (very subtle now)
        if (this.direction.lengthSq() > 0.1) {
            this.headBobTime += dt * 10;
            this.pitchObject.position.y = Math.sin(this.headBobTime) * 0.015;
        } else {
            // Smoothly return to center
            this.pitchObject.position.y += (0 - this.pitchObject.position.y) * 5 * dt;
            if (Math.abs(this.pitchObject.position.y) < 0.001) this.pitchObject.position.y = 0;
        }
    }
}
