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
        this.yawObject.position.set(-4.35, 1.5, -6.05); // Start in the rear-left bed alcove
        this.yawObject.rotation.y = Math.PI; // Face down the castle hall toward the entrance
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
        
        // Mouse look
        const onMouseMove = (event) => {
            if (document.body.classList.contains('mobile-input')) return;
            if (!this.isLocked || !this.allowLook) return;
            const movementX = event.movementX || 0;
            const movementY = event.movementY || 0;
            
            // Ignore massive mouse delta jumps (often happens when locking pointer)
            if (Math.abs(movementX) > 300 || Math.abs(movementY) > 300) return;
            
            // Restored mouse sensitivity
            this.yawObject.rotation.y -= movementX * 0.002;
            this.pitchObject.rotation.x -= movementY * 0.002;
            this.pitchObject.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitchObject.rotation.x));
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

        // Expanded 12 x 14 castle bounds. The previous -3.5..3.5 clamp was the
        // reason the larger shell still felt like the original tiny room.
        newX = Math.max(-5.55, Math.min(5.55, newX));
        newZ = Math.max(-7.55, Math.min(5.55, newZ));

        const resolveBox = (minX, maxX, minZ, maxZ) => {
            if (!(newX > minX && newX < maxX && newZ > minZ && newZ < maxZ)) return;

            // Prefer the side the player came from. This prevents diagonal movement from
            // snapping through large furniture and lets teleports/sitting remain stable.
            if (prevX <= minX) { newX = minX; return; }
            if (prevX >= maxX) { newX = maxX; return; }
            if (prevZ <= minZ) { newZ = minZ; return; }
            if (prevZ >= maxZ) { newZ = maxZ; return; }

            const distances = [
                { axis: 'x', value: minX, distance: Math.abs(newX - minX) },
                { axis: 'x', value: maxX, distance: Math.abs(newX - maxX) },
                { axis: 'z', value: minZ, distance: Math.abs(newZ - minZ) },
                { axis: 'z', value: maxZ, distance: Math.abs(newZ - maxZ) }
            ];
            const nearest = distances.reduce((best, item) => item.distance < best.distance ? item : best);
            if (nearest.axis === 'x') newX = nearest.value;
            else newZ = nearest.value;
        };

        if (moved) {
            // Raised throne platform and its front steps.
            resolveBox(-1.95, 1.95, -7.48, -3.55);

            // Right-front PC workstation. The chair remains reachable from the entrance side.
            resolveBox(2.68, 5.55, 2.72, 4.48);

            // Left utility niche refrigerator. Its front and swinging door remain approachable.
            resolveBox(-5.55, -4.82, 0.25, 1.25);

            // Ominous entrance piano, now aligned along the left wall with the bench aisle-side.
            resolveBox(-4.92, -3.74, 2.7, 5.5);

            // Rear-left bed alcove.
            resolveBox(-5.48, -3.22, -7.5, -4.48);

            // Six freestanding arch columns framing the central hallway.
            for (const z of [-4.18, -0.92, 2.35]) {
                resolveBox(-2.72, -2.04, z - 0.34, z + 0.34);
                resolveBox(2.04, 2.72, z - 0.34, z + 0.34);
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
