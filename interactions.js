import * as THREE from 'three';

export class InteractionSystem {
    constructor(camera, interactables, promptElement, specialActionHandler) {
        this.camera = camera;
        this.interactables = interactables;
        this.promptElement = promptElement;
        this.specialActionHandler = specialActionHandler || (() => false);
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 3;
        this.center = new THREE.Vector2(0, 0);
        this.currentHover = null;
        this.cachedInteractableCount = -1;
        this.meshes = [];
        this.meshLookup = new Map();
        this.intersections = [];
        this.refreshCache();
        
        this.lastInteractTime = 0;
        this.disableE = false;
        this.lastPromptText = '';
        
        document.addEventListener('keydown', (e) => {
            if (document.body.classList.contains('pc-open')) return;
            if (e.code === 'KeyE' && this.currentHover) {
                this.triggerInteraction('keyboard');
            }
        });

        document.addEventListener('mousedown', (e) => {
            if (document.body.classList.contains('pc-open')) return;
            if (e.button === 0 && this.currentHover && document.pointerLockElement === document.body) {
                this.triggerInteraction('mouse');
            }
        });
    }


    refreshCache() {
        this.cachedInteractableCount = this.interactables.length;
        this.meshes.length = 0;
        this.meshLookup.clear();
        for (const interactable of this.interactables) {
            if (!interactable || !interactable.mesh) continue;
            this.meshes.push(interactable.mesh);
            this.meshLookup.set(interactable.mesh, interactable);
        }
    }

    getLabel(interactable) {
        if (!interactable) return '';
        const label = typeof interactable.label === 'function' ? interactable.label() : interactable.label;
        return label || '';
    }

    isVisibleInScene(object) {
        let current = object;
        while (current) {
            if (current.visible === false) return false;
            current = current.parent;
        }
        return true;
    }

    canUse(interactable) {
        if (!interactable || !interactable.mesh) return false;
        if (!this.isVisibleInScene(interactable.mesh)) return false;
        if (typeof interactable.canInteract === 'function' && !interactable.canInteract()) return false;
        return this.getLabel(interactable) !== '';
    }

    getPromptText(interactable) {
        const isMobile = document.body.classList.contains('mobile-input');
        const keyLabel = isMobile ? 'Tap' : (this.disableE || interactable.mouseOnly ? 'Click' : 'E');
        return `[${keyLabel}] ${this.getLabel(interactable)}`;
    }
    
    triggerInteraction(inputType = 'mouse') {
        if (!this.canUse(this.currentHover)) return;
        if (inputType === 'keyboard' && (this.disableE || this.currentHover.mouseOnly)) return;

        const now = Date.now();
        if (now - this.lastInteractTime < 500) return; // 500ms cooldown
        this.lastInteractTime = now;
        
        const interactable = this.currentHover;
        if (typeof interactable.action === 'string') {
            this.specialActionHandler(interactable);
        } else if (typeof interactable.action === 'function') {
            interactable.action();
        }
    }
    
    update() {
        if (this.cachedInteractableCount !== this.interactables.length) this.refreshCache();
        this.raycaster.setFromCamera(this.center, this.camera);
        this.intersections.length = 0;
        this.raycaster.intersectObjects(this.meshes, false, this.intersections);

        let interactable = null;
        for (let i = 0; i < this.intersections.length; i++) {
            const candidate = this.meshLookup.get(this.intersections[i].object);
            if (this.canUse(candidate)) {
                interactable = candidate;
                break;
            }
        }

        if (interactable) {
            const promptText = this.getPromptText(interactable);
            if (this.currentHover !== interactable || this.lastPromptText !== promptText) {
                this.currentHover = interactable;
                this.lastPromptText = promptText;
                this.promptElement.textContent = promptText;
                this.promptElement.classList.add('visible');
            }
            return;
        }

        if (this.currentHover) {
            this.currentHover = null;
            this.lastPromptText = '';
            this.promptElement.classList.remove('visible');
        }
    }
}
