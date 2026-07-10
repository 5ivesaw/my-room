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
        this.yawObject.position.set(-2, 1.5, 2); // Start in bed
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

        // Bounds checking (stuck in room)
        if (newX < -3.5) newX = -3.5;
        if (newX > 3.5) newX = 3.5;
        if (newZ < -3.5) newZ = -3.5;
        if (newZ > 3.5) newZ = 3.5;

        // Gothic throne and dais collision. The kneeling point remains clear in front.
        const tMinX = -1.25;
        const tMaxX = 1.25;
        const tMinZ = -3.5;
        const tMaxZ = -2.72;
        if (newX > tMinX && newX < tMaxX && newZ > tMinZ && newZ < tMaxZ) {
            const distMinX = Math.abs(newX - tMinX);
            const distMaxX = Math.abs(newX - tMaxX);
            const distMaxZ = Math.abs(newZ - tMaxZ);
            const min = Math.min(distMinX, distMaxX, distMaxZ);
            if (min === distMinX) newX = tMinX;
            else if (min === distMaxX) newX = tMaxX;
            else newZ = tMaxZ;
        }
        
        // Desk Collision Box (Desk is at X=2, Z=-2, size 3x1.5)
        const dMinX = 0.5;
        const dMaxX = 3.5;
        const dMinZ = -2.75;
        const dMaxZ = -1.25;
        
        if (newX > dMinX && newX < dMaxX && newZ > dMinZ && newZ < dMaxZ) {
            const distMinX = Math.abs(newX - dMinX);
            const distMaxX = Math.abs(newX - dMaxX);
            const distMinZ = Math.abs(newZ - dMinZ);
            const distMaxZ = Math.abs(newZ - dMaxZ);
            
            const min = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);
            if (min === distMinX) newX = dMinX;
            else if (min === distMaxX) newX = dMaxX;
            else if (min === distMinZ) newZ = dMinZ;
            else newZ = dMaxZ;
        }

        // Fridge Collision Box (moved closer to the desk/table)
        const fMinX = 3.08;
        const fMaxX = 3.5;
        const fMinZ = -0.9;
        const fMaxZ = -0.08;
        
        if (newX > fMinX && newX < fMaxX && newZ > fMinZ && newZ < fMaxZ) {
            const distMinX = Math.abs(newX - fMinX);
            const distMaxX = Math.abs(newX - fMaxX);
            const distMinZ = Math.abs(newZ - fMinZ);
            const distMaxZ = Math.abs(newZ - fMaxZ);
            
            const min = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);
            if (min === distMinX) newX = fMinX;
            else if (min === distMaxX) newX = fMaxX;
            else if (min === distMinZ) newZ = fMinZ;
            else newZ = fMaxZ;
        }
        
        // Bigger digital piano body collision. The bench remains approachable for sitting.
        const pMinX = 2.2;
        const pMaxX = 3.45;
        const pMinZ = 0.65;
        const pMaxZ = 3.45;
        
        if (newX > pMinX && newX < pMaxX && newZ > pMinZ && newZ < pMaxZ) {
            const distMinX = Math.abs(newX - pMinX);
            const distMaxX = Math.abs(newX - pMaxX);
            const distMinZ = Math.abs(newZ - pMinZ);
            const distMaxZ = Math.abs(newZ - pMaxZ);
            
            const min = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);
            if (min === distMinX) newX = pMinX;
            else if (min === distMaxX) newX = pMaxX;
            else if (min === distMinZ) newZ = pMinZ;
            else newZ = pMaxZ;
        }
        
        // Bed Collision Box (corner bed, flush against left/front walls)
        const bMinX = -3.5;
        const bMaxX = -1.95;
        const bMinZ = 1.0;
        const bMaxZ = 3.5;

        if (newX > bMinX && newX < bMaxX && newZ > bMinZ && newZ < bMaxZ) {
            const distMinX = Math.abs(newX - bMinX);
            const distMaxX = Math.abs(newX - bMaxX);
            const distMinZ = Math.abs(newZ - bMinZ);
            const distMaxZ = Math.abs(newZ - bMaxZ);
            
            const min = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);
            if (min === distMinX) newX = bMinX;
            else if (min === distMaxX) newX = bMaxX;
            else if (min === distMinZ) newZ = bMinZ;
            else newZ = bMaxZ;
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
