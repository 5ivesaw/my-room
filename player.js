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

        // Expanded castle bounds.
        newX = Math.max(-5.55, Math.min(5.55, newX));
        newZ = Math.max(-7.45, Math.min(5.55, newZ));

        const resolveBox = (minX, maxX, minZ, maxZ) => {
            if (!(newX > minX && newX < maxX && newZ > minZ && newZ < maxZ)) return;
            const toMinX = newX - minX;
            const toMaxX = maxX - newX;
            const toMinZ = newZ - minZ;
            const toMaxZ = maxZ - newZ;
            let nearest = toMinX;
            let edge = 0;
            if (toMaxX < nearest) { nearest = toMaxX; edge = 1; }
            if (toMinZ < nearest) { nearest = toMinZ; edge = 2; }
            if (toMaxZ < nearest) edge = 3;
            if (edge === 0) newX = minX;
            else if (edge === 1) newX = maxX;
            else if (edge === 2) newZ = minZ;
            else newZ = maxZ;
        };

        // Raised throne, desk, fridge, piano and bed.
        resolveBox(-2.15, 2.15, -7.45, -5.42);
        resolveBox(2.62, 5.55, 2.72, 4.52);
        resolveBox(-5.55, -4.78, 1.67, 2.72);
        resolveBox(-5.55, -3.48, 2.72, 5.55);
        resolveBox(-5.55, -3.58, -3.48, -0.28);

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
