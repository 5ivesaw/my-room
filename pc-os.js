const STORAGE_KEY = 'bedroom.windows12.state.v1';
const NOTIFICATION_TTL = 5200;

const APP_DEFS = [
    { id: 'files', title: 'File Explorer', icon: 'FE', pinned: true },
    { id: 'browser', title: 'Nova Browser', icon: 'NB', pinned: true },
    { id: 'settings', title: 'Settings', icon: 'ST', pinned: true },
    { id: 'terminal', title: 'Terminal', icon: 'TR', pinned: true },
    { id: 'notepad', title: 'Notepad', icon: 'NP', pinned: true },
    { id: 'calculator', title: 'Calculator', icon: 'CA', pinned: false },
    { id: 'viewer', title: 'Media Viewer', icon: 'MV', pinned: false },
    { id: 'taskmgr', title: 'Task Manager', icon: 'TM', pinned: false },
    { id: 'store', title: 'App Store', icon: 'AS', pinned: false },
    { id: 'gamehub', title: 'Game Hub', icon: 'GH', pinned: true },
    { id: 'games', title: 'Mini Games', icon: 'MG', pinned: true },
    { id: 'mines', title: 'Mine Tiles', icon: 'MT', pinned: false },
    { id: 'snake', title: 'Neon Snake', icon: 'NS', pinned: false }
];

const STORE_APPS = [
    { id: 'pixelpaint', title: 'Pixel Paint', icon: 'PP', desc: 'Tiny drawing canvas placeholder.' },
    { id: 'weather', title: 'Weather Tile', icon: 'WT', desc: 'Local fake forecast card.' },
    { id: 'radio', title: 'Retro Radio', icon: 'RR', desc: 'Silent station browser for now.' },
    { id: 'codepad', title: 'Code Pad', icon: 'CP', desc: 'Simple code editor placeholder.' }
];

const WALLPAPERS = [
    { id: 'aurora', name: 'Aurora Glass' },
    { id: 'circuit', name: 'Circuit Night' },
    { id: 'sunrise', name: 'Soft Sunrise' },
    { id: 'grid', name: 'Depth Grid' }
];

const ACCENTS = ['#4cc9ff', '#ff4fd8', '#7cf27c', '#ffb84d', '#9a7cff'];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function nowStamp() {
    return new Date().toISOString();
}

function joinPath(base, name) {
    if (base === '/') return `/${name}`;
    return `${base}/${name}`;
}

function parentPath(path) {
    if (path === '/') return '/';
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    return parts.length ? `/${parts.join('/')}` : '/';
}

function baseName(path) {
    if (path === '/') return 'Root';
    return path.split('/').filter(Boolean).pop() || 'Root';
}

function uniquePath(fs, folder, desired) {
    const extIndex = desired.lastIndexOf('.');
    const stem = extIndex > 0 ? desired.slice(0, extIndex) : desired;
    const ext = extIndex > 0 ? desired.slice(extIndex) : '';
    let name = desired;
    let index = 2;
    while (fs[joinPath(folder, name)]) {
        name = `${stem} ${index}${ext}`;
        index += 1;
    }
    return joinPath(folder, name);
}

function defaultFs(userName = 'Player') {
    return {
        '/': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Desktop': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Documents': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Downloads': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Pictures': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Music': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/System': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Apps': { type: 'folder', created: nowStamp(), modified: nowStamp() },
        '/Desktop/Welcome.txt': {
            type: 'text',
            content: `Welcome ${userName}.\n\nThis is Windows 12 for the bedroom PC.\nThe install, files, apps, settings, browser history, and notes persist locally.`,
            created: nowStamp(),
            modified: nowStamp()
        },
        '/Documents/Read Me.txt': {
            type: 'text',
            content: 'Try File Explorer, Nova Browser, Terminal, Settings, Task Manager, Game Hub, and Mini Games. This whole desktop is running inside the physical room monitor.',
            created: nowStamp(),
            modified: nowStamp()
        },
        '/Pictures/Aurora.w12pic': {
            type: 'media',
            media: 'aurora',
            created: nowStamp(),
            modified: nowStamp()
        },
        '/Music/Boot Notes.txt': {
            type: 'text',
            content: 'Phase 3: USB installer, boot menu, desktop shell, apps, virtual files, and persistent state.',
            created: nowStamp(),
            modified: nowStamp()
        },
        '/System/SystemInfo.txt': {
            type: 'text',
            content: 'Bedroom Glass PC\nCPU: NovaCore 8\nGPU: RGB Phantom\nMemory: 16 GB\nStorage: 512 GB NVMe\nOS: Windows 12',
            created: nowStamp(),
            modified: nowStamp()
        }
    };
}

function createDefaultState() {
    return {
        version: 1,
        machine: {
            powered: false,
            phase: 'off',
            bootTarget: 'auto',
            monitor: true,
            video: true,
            keyboard: true,
            mouse: true,
            network: true,
            volume: 64,
            battery: 96
        },
        os: {
            installed: false,
            language: 'English (US)',
            drive: 'NVMe 0',
            user: { name: 'Player', password: '', pin: '' },
            theme: 'dark',
            accent: '#4cc9ff',
            wallpaper: 'aurora',
            scale: 1
        },
        fs: defaultFs('Player'),
        browser: {
            history: [],
            bookmarks: ['nova://start']
        },
        terminal: {
            cwd: '/Desktop',
            history: ['Windows 12 terminal ready. Type help.']
        },
        installedApps: APP_DEFS.map((app) => app.id),
        windowPositions: {},
        recentFiles: [],
        notifications: [
            { id: 'welcome', title: 'System ready', body: 'The desktop shell will remember your local changes.', created: Date.now(), ttl: NOTIFICATION_TTL }
        ]
    };
}

function normalizeState(state) {
    const defaults = createDefaultState();
    const merged = Object.assign(defaults, state || {});
    merged.machine = Object.assign(defaults.machine, state?.machine || {});
    merged.os = Object.assign(defaults.os, state?.os || {});
    merged.os.user = Object.assign(defaults.os.user, state?.os?.user || {});
    merged.browser = Object.assign(defaults.browser, state?.browser || {});
    merged.terminal = Object.assign(defaults.terminal, state?.terminal || {});
    merged.fs = Object.assign(defaultFs(merged.os.user.name), state?.fs || {});
    const builtInApps = APP_DEFS.map((app) => app.id);
    merged.installedApps = Array.isArray(state?.installedApps)
        ? Array.from(new Set([...state.installedApps, ...builtInApps]))
        : defaults.installedApps;
    merged.windowPositions = state?.windowPositions || {};
    merged.recentFiles = state?.recentFiles || [];
    const now = Date.now();
    merged.notifications = (state?.notifications || defaults.notifications)
        .filter((item) => item && item.created && now - item.created < (item.ttl || NOTIFICATION_TTL));
    return merged;
}

export function createPCSystem({ showMessage } = {}) {
    return new PCSystem(showMessage || (() => {}));
}

class PCSystem {
    constructor(showMessage) {
        this.showMessage = showMessage;
        this.state = this.loadState();
        this.overlay = null;
        this.root = null;
        this.visible = false;
        this.bootTimer = 0;
        this.bootNextPhase = null;
        this.install = { step: 'language', progress: 0, stage: 0 };
        this.windows = [];
        this.nextWindowId = 1;
        this.zCounter = 10;
        this.startOpen = false;
        this.quickOpen = false;
        this.searchQuery = '';
        this.contextMenu = null;
        this.drag = null;
        this.resize = null;
        this.selection = null;
        this.audioCtx = null;
        this.lastSoundAt = 0;
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.width = 640;
        this.previewCanvas.height = 360;
        this.previewDirty = true;
        this.previewTextureDirty = true;
        this.previewClock = 0;
        this.previewMode = 'still';
        this.closeTimer = null;
        this.snakeClock = 0;
        this.createOverlay();
        this.renderPreview();
        window.__bedroomPCOS = this;
    }

    ensureAudio() {
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
            return this.audioCtx;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        this.audioCtx = new Ctx();
        return this.audioCtx;
    }

    playSound(type = 'click') {
        const nowMs = performance.now();
        if (type === 'hover' && nowMs - this.lastSoundAt < 45) return;
        if (!['type', 'notify'].includes(type) && nowMs - this.lastSoundAt < 35) return;
        this.lastSoundAt = nowMs;
        const ctx = this.ensureAudio();
        if (!ctx) return;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(type === 'notify' ? 0.08 : 0.045, ctx.currentTime + 0.01);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + this.soundDuration(type));
        master.connect(ctx.destination);

        const makeTone = (freq, delay, dur, wave = 'sine') => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = wave;
            osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
            gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.7, ctx.currentTime + delay + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
            osc.connect(gain);
            gain.connect(master);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + dur + 0.03);
        };

        const patterns = {
            click: [[420, 0, 0.045, 'triangle']],
            open: [[392, 0, 0.06, 'sine'], [640, 0.035, 0.08, 'sine']],
            close: [[520, 0, 0.05, 'triangle'], [220, 0.035, 0.08, 'sine']],
            boot: [[196, 0, 0.12, 'sine'], [392, 0.1, 0.12, 'sine'], [784, 0.21, 0.16, 'triangle']],
            install: [[330, 0, 0.08, 'sine'], [495, 0.07, 0.08, 'sine'], [660, 0.14, 0.12, 'sine']],
            notify: [[880, 0, 0.07, 'sine'], [1174, 0.055, 0.14, 'sine']],
            error: [[170, 0, 0.14, 'sawtooth'], [120, 0.1, 0.15, 'sawtooth']],
            type: [[620, 0, 0.025, 'square']],
            drag: [[240, 0, 0.035, 'triangle']],
            resize: [[300, 0, 0.045, 'triangle']],
            toggle: [[260, 0, 0.05, 'triangle'], [520, 0.035, 0.06, 'triangle']],
            save: [[523, 0, 0.06, 'sine'], [659, 0.05, 0.06, 'sine'], [784, 0.1, 0.1, 'sine']],
            app: [[440, 0, 0.05, 'triangle'], [660, 0.035, 0.08, 'triangle']]
        };
        for (const [freq, delay, dur, wave] of patterns[type] || patterns.click) makeTone(freq, delay, dur, wave);
    }

    soundDuration(type) {
        const durations = { boot: 0.42, install: 0.32, notify: 0.34, error: 0.34, save: 0.28, app: 0.2 };
        return durations[type] || 0.16;
    }

    loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return normalizeState(raw ? JSON.parse(raw) : null);
        } catch (error) {
            console.warn('PC OS state reset after load failure.', error);
            return createDefaultState();
        }
    }

    saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (error) {
            console.warn('Could not save PC OS state.', error);
        }
    }

    createOverlay() {
        if (document.getElementById('pc-os-overlay')) {
            this.overlay = document.getElementById('pc-os-overlay');
            this.root = this.overlay.querySelector('.pc-os-root');
            return;
        }

        this.overlay = document.createElement('div');
        this.overlay.id = 'pc-os-overlay';
        this.overlay.className = 'pc-hidden';
        this.overlay.innerHTML = `
            <div class="pc-shell">
                <div class="pc-frame-top">
                    <span class="pc-frame-dot"></span>
                    <span>Bedroom PC Monitor</span>
                    <button class="pc-close" type="button" data-action="close-pc">Close</button>
                </div>
                <div class="pc-os-root" tabindex="0"></div>
            </div>
        `;
        document.body.appendChild(this.overlay);
        this.root = this.overlay.querySelector('.pc-os-root');

        this.overlay.addEventListener('click', (event) => this.handleClick(event));
        this.overlay.addEventListener('submit', (event) => this.handleSubmit(event));
        this.overlay.addEventListener('input', (event) => this.handleInput(event));
        this.overlay.addEventListener('change', (event) => this.handleChange(event));
        this.overlay.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
        this.overlay.addEventListener('contextmenu', (event) => this.handleContextMenu(event));
        document.addEventListener('pointermove', (event) => this.handlePointerMove(event));
        document.addEventListener('pointerup', () => this.finishPointerAction());
        document.addEventListener('keydown', (event) => this.handleKeyDown(event), true);
    }

    open() {
        if (document.pointerLockElement) document.exitPointerLock();
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
        this.playSound('open');
        this.visible = true;
        document.body.classList.add('pc-open');
        this.overlay.classList.remove('pc-hidden', 'pc-closing');
        window.dispatchEvent(new CustomEvent('bedroom-pc-open'));
        this.root.focus({ preventScroll: true });
        this.render();
        this.showMessage('PC monitor opened.');
    }

    close(endSession = true) {
        if (!this.overlay) return;
        if (!this.visible && this.overlay.classList.contains('pc-hidden')) {
            if (endSession) this.endSession();
            return;
        }
        this.playSound('close');
        this.visible = false;
        if (endSession) this.endSession();
        this.render();
        this.renderPreview();
        this.overlay.classList.add('pc-closing');
        window.dispatchEvent(new CustomEvent('bedroom-pc-close'));
        if (this.closeTimer) clearTimeout(this.closeTimer);
        this.closeTimer = setTimeout(() => {
            document.body.classList.remove('pc-open');
            this.overlay.classList.add('pc-hidden');
            this.overlay.classList.remove('pc-closing');
            window.dispatchEvent(new CustomEvent('bedroom-pc-hidden'));
            this.closeTimer = null;
        }, 180);
    }

    shutdownExternalFrames() {
        if (!this.root) return;
        for (const frame of this.root.querySelectorAll('iframe')) {
            try { frame.src = 'about:blank'; } catch {}
            frame.remove();
        }
    }

    endSession() {
        for (const win of this.windows) this.rememberWindow(win);
        this.shutdownExternalFrames();
        this.windows = [];
        this.startOpen = false;
        this.quickOpen = false;
        this.contextMenu = null;
        this.selection = null;
        this.searchQuery = '';
        this.drag = null;
        this.resize = null;
        this.snakeClock = 0;
        this.previewClock = this.previewInterval();
        this.previewDirty = true;
    }

    getDebugState() {
        return {
            powered: this.state.machine.powered,
            phase: this.state.machine.phase,
            installed: this.state.os.installed,
            user: this.state.os.user.name,
            windows: this.windows.map((win) => ({ app: win.app, title: win.title, min: win.min, max: win.max })),
            installedApps: this.state.installedApps.slice(),
            fileCount: Object.keys(this.state.fs).length,
            browserHistoryCount: this.state.browser.history.length,
            hardware: {
                monitor: this.state.machine.monitor,
                video: this.state.machine.video,
                keyboard: this.state.machine.keyboard,
                mouse: this.state.machine.mouse,
                network: this.state.machine.network
            }
        };
    }

    consumePreviewDirty() {
        const dirty = this.previewTextureDirty;
        this.previewTextureDirty = false;
        return dirty;
    }

    markPreviewDirty() {
        this.previewDirty = true;
    }

    finishPreviewRender() {
        this.previewDirty = false;
        this.previewTextureDirty = true;
    }

    setPreviewMode(mode = 'still') {
        this.previewMode = ['still', 'slow', 'normal'].includes(mode) ? mode : 'still';
        this.previewDirty = true;
    }

    previewInterval() {
        if (this.previewMode === 'normal') return 0.16;
        if (this.previewMode === 'slow') return 0.55;
        return Number.POSITIVE_INFINITY;
    }

    isScreenLit() {
        return this.state.machine.monitor && this.state.machine.video && this.state.machine.powered;
    }

    update(dt) {
        if (this.pruneNotifications()) {
            if (this.visible) this.render();
        }

        if (this.state.machine.phase === 'boot') {
            this.bootTimer -= dt;
            if (this.bootTimer <= 0) {
                this.state.machine.phase = this.bootNextPhase || (this.state.os.installed ? 'login' : 'bootMenu');
                this.bootNextPhase = null;
                this.saveState();
                this.render();
            }
        }

        if (this.state.machine.phase === 'installer' && this.install.step === 'progress') {
            this.install.progress = Math.min(100, this.install.progress + dt * 32);
            this.install.stage = Math.min(3, Math.floor(this.install.progress / 28));
            if (this.install.progress >= 100) this.finishInstall();
            if (this.visible) this.render();
        }

        this.snakeClock += dt;
        if (this.snakeClock > 0.18) {
            this.snakeClock = 0;
            if (this.tickSnakeWindows()) {
                if (this.visible) this.render();
                this.previewDirty = true;
            }
        }

        this.previewClock += dt;
        if (!this.visible && (this.previewClock > this.previewInterval() || this.previewDirty)) {
            this.previewClock = 0;
            this.renderPreview();
        }
    }

    render() {
        if (!this.root) return;
        this.root.style.setProperty('--accent', this.state.os.accent);

        const phase = this.state.machine.phase;
        const desktopFullscreen = phase === 'desktop' && this.windows.some((win) => !win.min && win.max);
        this.root.className = `pc-os-root w12-${this.state.os.theme}${desktopFullscreen ? ' desktop-fullscreen-app' : ''}`;
        this.overlay?.classList.toggle('pc-app-fullscreen', desktopFullscreen);

        if (!this.state.machine.monitor || !this.state.machine.video) {
            this.root.innerHTML = this.renderNoSignal();
            this.previewDirty = true;
            return;
        }

        if (!this.state.machine.powered || phase === 'off') {
            this.root.innerHTML = this.renderPowerOff();
        } else if (phase === 'boot') {
            this.root.innerHTML = this.renderBoot();
        } else if (phase === 'bootMenu') {
            this.root.innerHTML = this.renderBootMenu();
        } else if (phase === 'firmware') {
            this.root.innerHTML = this.renderFirmware();
        } else if (phase === 'installer') {
            this.root.innerHTML = this.renderInstaller();
        } else if (phase === 'login') {
            this.root.innerHTML = this.renderLogin();
        } else if (phase === 'desktop') {
            this.root.innerHTML = this.renderDesktop();
        } else if (phase === 'sleep') {
            this.root.innerHTML = this.renderSleep();
        }
        this.previewDirty = true;
    }

    renderNoSignal() {
        const reason = !this.state.machine.monitor ? 'Monitor is off.' : 'No video signal.';
        return `
            <div class="w12-nosignal">
                <div class="scanlines"></div>
                <div class="nosignal-card">
                    <h1>No Signal</h1>
                    <p>${reason}</p>
                    <button type="button" data-action="repair-signal">Turn display path back on</button>
                    <button type="button" data-action="close-pc">Leave monitor</button>
                </div>
            </div>
        `;
    }

    renderPowerOff() {
        return `
            <div class="w12-power w12-stage wallpaper-${this.state.os.wallpaper}">
                <div class="lux-light lux-a"></div>
                <div class="lux-light lux-b"></div>
                <div class="power-card premium-card">
                    <div class="brand-row">
                        <span class="brand-chip">12</span>
                        <strong>Bedroom Glass PC</strong>
                    </div>
                    <div class="power-grid">
                        <section>
                            <div class="power-orb"><span></span></div>
                            <h1>Windows 12</h1>
                            <p>A cinematic local desktop for the glass tower. Boot internal storage, launch the USB installer, or tune firmware before startup.</p>
                            <div class="power-row">
                                <button class="primary-action" type="button" data-action="pc-power">Power On</button>
                                <button type="button" data-action="boot-menu-power">Boot Menu</button>
                                <button type="button" data-action="firmware-power">Firmware</button>
                            </div>
                        </section>
                        <aside class="device-preview">
                            <div class="device-screen">
                                <div class="preview-wall"></div>
                                <div class="preview-dock"></div>
                                <span></span><span></span><span></span>
                            </div>
                            <div class="device-specs">
                                <b>NovaCore 8</b>
                                <b>RGB Phantom GPU</b>
                                <b>512 GB NVMe</b>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        `;
    }

    renderBoot() {
        return `
            <div class="w12-boot w12-stage">
                <div class="lux-light lux-a"></div>
                <div class="boot-core">
                    <div class="boot-mark"><span>12</span></div>
                    <h1>Windows 12</h1>
                    <div class="boot-spinner"><span></span><span></span><span></span><span></span></div>
                    <p>Synchronizing display, keyboard, mouse, storage, network, and glass effects...</p>
                </div>
            </div>
        `;
    }

    renderBootMenu() {
        const installed = this.state.os.installed;
        return `
            <div class="w12-setup w12-stage wallpaper-grid">
                <div class="lux-light lux-a"></div>
                <div class="setup-panel boot-menu-panel premium-card">
                    <div class="setup-heading">
                        <p class="eyebrow">Bedroom PC Boot Manager</p>
                        <h1>Choose startup path</h1>
                        <p>Fast boot into your installed desktop or launch the polished USB setup environment.</p>
                    </div>
                    <div class="boot-layout">
                        <div class="boot-options">
                            <button type="button" data-action="boot-internal" ${installed ? '' : 'disabled'}>
                                <i class="option-icon drive-icon"></i>
                                <b>Internal NVMe Drive</b>
                                <span>${installed ? 'Windows 12 ready' : 'No OS installed'}</span>
                            </button>
                            <button type="button" data-action="boot-usb">
                                <i class="option-icon usb-icon"></i>
                                <b>USB Installer</b>
                                <span>Install, repair, or reinstall the OS</span>
                            </button>
                            <button type="button" data-action="firmware">
                                <i class="option-icon chip-icon"></i>
                                <b>Firmware Setup</b>
                                <span>Hardware status, boot order, reset tools</span>
                            </button>
                            <button type="button" data-action="reset-os">
                                <i class="option-icon wipe-icon"></i>
                                <b>Reset Installed OS</b>
                                <span>Erase local OS state and return to setup</span>
                            </button>
                        </div>
                        <aside class="boot-status-card">
                            <h2>Machine Status</h2>
                            <div><span>Display</span><strong>${this.state.machine.monitor && this.state.machine.video ? 'Online' : 'Signal issue'}</strong></div>
                            <div><span>Input</span><strong>${this.state.machine.keyboard && this.state.machine.mouse ? 'Ready' : 'Limited'}</strong></div>
                            <div><span>Network</span><strong>${this.state.machine.network ? 'Connected' : 'Offline'}</strong></div>
                            <div><span>OS</span><strong>${installed ? 'Installed' : 'Missing'}</strong></div>
                            <button type="button" data-action="power-off">Power Off</button>
                        </aside>
                    </div>
                </div>
            </div>
        `;
    }

    renderFirmware() {
        const hw = this.state.machine;
        const rows = [
            ['monitor', 'Monitor Panel', hw.monitor],
            ['video', 'Video Output', hw.video],
            ['keyboard', 'Keyboard', hw.keyboard],
            ['mouse', 'Mouse', hw.mouse],
            ['network', 'Network Adapter', hw.network]
        ];
        return `
            <div class="w12-setup w12-stage wallpaper-circuit">
                <div class="setup-panel firmware-panel premium-card">
                    <div class="setup-heading">
                        <p class="eyebrow">NovaBoard UEFI</p>
                        <h1>Firmware Studio</h1>
                        <p>Low-level controls for the physical glass PC, presented like an actual premium board utility.</p>
                    </div>
                    <div class="firmware-grid">
                        <section>
                            <h2>Boot</h2>
                            <label>Boot target
                                <select data-action="boot-target" ${hw.keyboard ? '' : 'disabled'}>
                                    <option value="auto" ${hw.bootTarget === 'auto' ? 'selected' : ''}>Auto</option>
                                    <option value="internal" ${hw.bootTarget === 'internal' ? 'selected' : ''}>Internal drive</option>
                                    <option value="usb" ${hw.bootTarget === 'usb' ? 'selected' : ''}>USB installer</option>
                                </select>
                            </label>
                            <button type="button" data-action="reboot">Save and Reboot</button>
                            <button type="button" data-action="boot-usb">Boot USB Now</button>
                        </section>
                        <section>
                            <h2>Hardware</h2>
                            ${rows.map(([key, label, on]) => `
                                <button type="button" class="toggle-row" data-action="toggle-hardware" data-key="${key}">
                                    <span>${label}</span><strong>${on ? 'Enabled' : 'Disabled'}</strong>
                                </button>
                            `).join('')}
                        </section>
                        <section>
                            <h2>Service</h2>
                            <p>Installed OS: <strong>${this.state.os.installed ? 'Yes' : 'No'}</strong></p>
                            <div class="firmware-chip-map">
                                <span></span><span></span><span></span><span></span>
                            </div>
                            <button type="button" data-action="reset-os">Erase OS install</button>
                            <button type="button" data-action="power-off">Power Off</button>
                        </section>
                    </div>
                </div>
            </div>
        `;
    }

    renderInstaller() {
        if (this.install.step === 'account') {
            return `
                <div class="w12-installer w12-stage wallpaper-grid">
                    <form class="installer-card premium-card setup-split" data-form="installer-account">
                        <div class="setup-main">
                            <p class="eyebrow">Windows 12 Setup</p>
                            <h1>Create your identity</h1>
                            <p class="setup-copy">Your account, files, app data, shell layout, browser history, and settings persist locally.</p>
                            <label>User name
                                <input name="name" autocomplete="off" value="${escapeHtml(this.state.os.user.name)}" ${this.state.machine.keyboard ? '' : 'disabled'}>
                            </label>
                            <label>Password
                                <input name="password" type="password" autocomplete="new-password" ${this.state.machine.keyboard ? '' : 'disabled'}>
                            </label>
                            <label>PIN (optional)
                                <input name="pin" inputmode="numeric" maxlength="12" ${this.state.machine.keyboard ? '' : 'disabled'}>
                            </label>
                            ${this.renderKeyboardWarning()}
                            <div class="installer-actions">
                                <button type="button" data-action="installer-back">Back</button>
                                <button class="primary-action" type="submit">Continue</button>
                            </div>
                        </div>
                        <aside class="setup-side identity-side">
                            <div class="profile-orbit">${escapeHtml(this.state.os.user.name.slice(0, 2).toUpperCase() || 'P')}</div>
                            <h2>Local-first profile</h2>
                            <p>No account service. No fake cloud login. Just your room PC state saved in the browser.</p>
                            <div class="side-metric"><span>Storage</span><b>VFS ready</b></div>
                            <div class="side-metric"><span>Security</span><b>PIN optional</b></div>
                            <div class="side-metric"><span>Restore</span><b>Firmware reset</b></div>
                        </aside>
                    </form>
                </div>
            `;
        }

        if (this.install.step === 'personalize') {
            return `
                <div class="w12-installer w12-stage wallpaper-circuit">
                    <form class="installer-card premium-card setup-split" data-form="installer-theme">
                        <div class="setup-main">
                            <p class="eyebrow">Windows 12 Setup</p>
                            <h1>Make it yours</h1>
                            <p class="setup-copy">Pick the glass tone, accent light, and desktop scene used by login, shell, windows, and monitor preview.</p>
                            <div class="choice-grid">
                                <label class="choice-card theme-choice dark-choice">
                                    <input type="radio" name="theme" value="dark" ${this.state.os.theme === 'dark' ? 'checked' : ''}>
                                    <span><b>Dark glass</b><small>Deep OLED panels and bright edge light.</small></span>
                                </label>
                                <label class="choice-card theme-choice light-choice">
                                    <input type="radio" name="theme" value="light" ${this.state.os.theme === 'light' ? 'checked' : ''}>
                                    <span><b>Light mist</b><small>Soft frosted panels and calmer contrast.</small></span>
                                </label>
                            </div>
                            <div class="swatches">
                                ${ACCENTS.map((color) => `
                                    <label style="--swatch:${color}">
                                        <input type="radio" name="accent" value="${color}" ${this.state.os.accent === color ? 'checked' : ''}>
                                        <span></span>
                                    </label>
                                `).join('')}
                            </div>
                            <label>Wallpaper
                                <select name="wallpaper">
                                    ${WALLPAPERS.map((wp) => `<option value="${wp.id}" ${this.state.os.wallpaper === wp.id ? 'selected' : ''}>${wp.name}</option>`).join('')}
                                </select>
                            </label>
                            <div class="installer-actions">
                                <button type="button" data-action="installer-back">Back</button>
                                <button class="primary-action" type="submit">Install</button>
                            </div>
                        </div>
                        <aside class="setup-side theme-side wallpaper-${this.state.os.wallpaper}">
                            <div class="mini-window one"></div>
                            <div class="mini-window two"></div>
                            <div class="mini-taskbar"></div>
                        </aside>
                    </form>
                </div>
            `;
        }

        if (this.install.step === 'progress') {
            const stages = ['Copying files', 'Preparing devices', 'Building desktop', 'Saving setup'];
            return `
                <div class="w12-installer w12-stage wallpaper-aurora">
                    <div class="installer-card progress-card premium-card">
                        <div class="install-ring" style="--progress:${this.install.progress}%"><span>${Math.round(this.install.progress)}%</span></div>
                        <div>
                            <p class="eyebrow">Installing Windows 12</p>
                            <h1>${stages[this.install.stage] || 'Finishing'}</h1>
                            <div class="progress-track"><span style="width:${this.install.progress}%"></span></div>
                            <div class="install-steps">
                                ${stages.map((stage, index) => `<span class="${index <= this.install.stage ? 'done' : ''}">${stage}</span>`).join('')}
                            </div>
                            <p>Your desktop, apps, files, browser data, theme, and window layout are being prepared for local persistence.</p>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="w12-installer w12-stage wallpaper-aurora">
                <form class="installer-card premium-card setup-split" data-form="installer-language">
                    <div class="setup-main">
                        <p class="eyebrow">Windows 12 Setup</p>
                        <h1>Install from USB</h1>
                        <p class="setup-copy">Prepare the virtual disk, account, theme, app shell, and persistent file system.</p>
                        <label>Language
                            <select name="language">
                                <option>English (US)</option>
                                <option>English (UK)</option>
                                <option>Sinhala / English</option>
                                <option>Japanese / English</option>
                            </select>
                        </label>
                        <label>Install drive
                            <select name="drive">
                                <option>NVMe 0 - 512 GB</option>
                                <option>SATA 1 - 1 TB Archive</option>
                            </select>
                        </label>
                        <div class="installer-actions">
                            <button type="button" data-action="boot-menu">Back to Boot Menu</button>
                            <button class="primary-action" type="submit">Next</button>
                        </div>
                    </div>
                    <aside class="setup-side install-side">
                        <div class="drive-stack">
                            <span></span><span></span><span></span>
                        </div>
                        <h2>USB installer</h2>
                        <p>Creates account, storage, apps, theme, wallpaper, and boot state in one flow.</p>
                        <div class="side-metric"><span>Disk</span><b>512 GB NVMe</b></div>
                        <div class="side-metric"><span>Mode</span><b>Local persistent</b></div>
                    </aside>
                </form>
            </div>
        `;
    }

    renderLogin() {
        return `
            <div class="w12-login w12-stage wallpaper-${this.state.os.wallpaper}">
                <div class="lux-light lux-a"></div>
                <form class="login-card premium-card" data-form="login">
                    <div class="login-avatar"><span>${escapeHtml(this.state.os.user.name.slice(0, 2).toUpperCase() || 'P')}</span></div>
                    <h1>${escapeHtml(this.state.os.user.name)}</h1>
                    <p>Windows 12 Bedroom Edition</p>
                    <input name="secret" type="password" placeholder="${this.state.os.user.pin ? 'PIN' : 'Password'}" ${this.state.machine.keyboard ? '' : 'disabled'}>
                    ${this.renderKeyboardWarning()}
                    <button class="primary-action" type="submit">Sign in</button>
                    <button type="button" data-action="boot-menu">Boot options</button>
                </form>
            </div>
        `;
    }

    renderSleep() {
        return `
            <div class="w12-sleep">
                <button type="button" data-action="wake-sleep">Wake PC</button>
                <p>Sleeping. Click to wake.</p>
            </div>
        `;
    }

    renderDesktop() {
        const openWindows = this.windows.filter((win) => !win.min);
        const notifications = this.visibleNotifications();
        const fullscreenApp = openWindows.some((win) => win.max);
        return `
            <div class="w12-desktop wallpaper-${this.state.os.wallpaper} ${fullscreenApp ? 'desktop-fullscreen-app' : ''}" data-action="desktop-area">
                <div class="desktop-noise"></div>
                <div class="desktop-light desktop-light-a"></div>
                <div class="desktop-light desktop-light-b"></div>
                <div class="desktop-icons">
                    ${this.renderDesktopIcons()}
                </div>
                <div class="window-layer">
                    ${openWindows.map((win) => this.renderWindow(win)).join('')}
                </div>
                ${this.startOpen ? this.renderStartMenu() : ''}
                ${this.quickOpen ? this.renderQuickSettings() : ''}
                ${this.contextMenu ? this.renderDesktopContext() : ''}
                ${this.selection ? this.renderSelectionBox() : ''}
                <div class="notification-stack">
                    ${notifications.slice(-3).map((item) => `
                        <div class="toast">
                            <strong>${escapeHtml(item.title)}</strong>
                            <span>${escapeHtml(item.body)}</span>
                        </div>
                    `).join('')}
                </div>
                ${this.renderTaskbar()}
            </div>
        `;
    }

    renderSelectionBox() {
        const left = Math.min(this.selection.startX, this.selection.x);
        const top = Math.min(this.selection.startY, this.selection.y);
        const width = Math.abs(this.selection.x - this.selection.startX);
        const height = Math.abs(this.selection.y - this.selection.startY);
        return `<div class="desktop-selection" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"></div>`;
    }

    renderKeyboardWarning() {
        return this.state.machine.keyboard ? '' : '<p class="hw-warning">Keyboard is disabled in firmware. Turn it back on from Firmware Setup if you need text input.</p>';
    }

    renderDesktopIcons() {
        const appIcons = [
            ['files', 'This PC'],
            ['browser', 'Nova Browser'],
            ['settings', 'Settings'],
            ['terminal', 'Terminal'],
            ['notepad', 'Notepad'],
            ['calculator', 'Calculator'],
            ['gamehub', 'Game Hub'],
            ['games', 'Mini Games'],
            ['taskmgr', 'Task Manager'],
            ['store', 'App Store']
        ];
        const folderIcons = ['/Documents', '/Downloads', '/Pictures', '/Music'];
        const desktopFiles = this.fsChildren('/Desktop').slice(0, 6);
        return [
            ...appIcons.map(([app, label]) => `
                <button type="button" class="desktop-icon" data-action="open-app" data-app="${app}">
                    ${this.renderGlyph(app, 'desktop')}
                    <em>${label}</em>
                </button>
            `),
            ...folderIcons.map((path) => `
                <button type="button" class="desktop-icon" data-action="open-path" data-path="${path}">
                    ${this.renderGlyph('folder', 'desktop')}
                    <em>${baseName(path)}</em>
                </button>
            `),
            ...desktopFiles.map((entry) => `
                <button type="button" class="desktop-icon" data-action="open-path" data-path="${escapeHtml(entry.path)}">
                    ${this.renderGlyph(entry.item.type === 'folder' ? 'folder' : entry.item.type === 'media' ? 'viewer' : 'document', 'desktop')}
                    <em>${escapeHtml(baseName(entry.path))}</em>
                </button>
            `)
        ].join('');
    }

    renderGlyph(appId, size = '') {
        const label = this.appIcon(appId);
        return `<span class="app-glyph glyph-${appId} ${size}" data-label="${escapeHtml(label)}"><i></i></span>`;
    }

    renderStatusChips() {
        const chips = [
            ['NET', this.state.machine.network ? 'Online' : 'Offline'],
            ['VOL', `${this.state.machine.volume}%`],
            ['BAT', `${this.state.machine.battery}%`]
        ];
        return chips.map(([key, value]) => `<span class="status-chip"><b>${key}</b>${value}</span>`).join('');
    }

    renderDesktopWidget() {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        return `
            <aside class="desktop-widget">
                <div>
                    <strong>${time}</strong>
                    <span>${date}</span>
                </div>
                <div class="widget-metrics">${this.renderStatusChips()}</div>
                <button type="button" data-action="open-app" data-app="settings">System Studio</button>
            </aside>
        `;
    }

    renderTaskbar() {
        const pinned = APP_DEFS.filter((app) => app.pinned && this.state.installedApps.includes(app.id));
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            ${this.renderDesktopWidget()}
            <div class="w12-taskbar">
                <button type="button" class="start-button ${this.startOpen ? 'active' : ''}" data-action="toggle-start"><span>12</span></button>
                <button type="button" class="task-search" data-action="toggle-start"><b></b>Search apps, files, settings</button>
                <div class="task-pins">
                    ${pinned.map((app) => `<button type="button" data-action="open-app" data-app="${app.id}" title="${app.title}">${this.renderGlyph(app.id, 'task')}</button>`).join('')}
                </div>
                <div class="task-running">
                    ${this.windows.map((win) => `
                        <button type="button" class="${win.min ? 'min' : 'live'}" data-action="task-window" data-window="${win.id}">
                            ${this.renderGlyph(win.app, 'run')} <span>${escapeHtml(win.title)}</span>
                        </button>
                    `).join('')}
                </div>
                <button type="button" class="tray" data-action="toggle-quick">
                    ${this.renderStatusChips()}
                    <strong>${time}</strong>
                </button>
            </div>
        `;
    }

    renderStartMenu() {
        const query = this.searchQuery.trim().toLowerCase();
        const apps = APP_DEFS
            .filter((app) => this.state.installedApps.includes(app.id))
            .filter((app) => !query || app.title.toLowerCase().includes(query));
        const files = Object.keys(this.state.fs)
            .filter((path) => path !== '/' && (!query || baseName(path).toLowerCase().includes(query)))
            .slice(0, 6);

        return `
            <div class="start-menu premium-card">
                <div class="start-top">
                    <div>
                        <strong>Windows 12</strong>
                        <span>${escapeHtml(this.state.os.user.name)} on Bedroom Glass PC</span>
                    </div>
                    <button type="button" data-action="power-menu">Power</button>
                </div>
                <input data-field="search" placeholder="Search apps, settings, files" value="${escapeHtml(this.searchQuery)}" ${this.state.machine.keyboard ? '' : 'disabled'}>
                <h2>Pinned Studio</h2>
                <div class="start-app-grid">
                    ${apps.map((app) => `
                        <button type="button" data-action="open-app" data-app="${app.id}">
                            ${this.renderGlyph(app.id, 'start')}
                            <span>${app.title}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="start-lower">
                    <section>
                        <h2>Recent Files</h2>
                        <div class="start-files">
                            ${files.map((path) => `<button type="button" data-action="open-path" data-path="${escapeHtml(path)}">${this.renderGlyph(this.state.fs[path]?.type === 'folder' ? 'folder' : 'document', 'file')}<span>${escapeHtml(baseName(path))}</span></button>`).join('')}
                        </div>
                    </section>
                    <section class="start-system">
                        <h2>System</h2>
                        ${this.renderStatusChips()}
                        <button type="button" data-action="open-app" data-app="taskmgr">Open Task Manager</button>
                    </section>
                </div>
                <div class="power-strip">
                    <button type="button" data-action="sleep">Sleep</button>
                    <button type="button" data-action="reboot">Restart</button>
                    <button type="button" data-action="power-off">Shut down</button>
                </div>
            </div>
        `;
    }

    renderQuickSettings() {
        return `
            <div class="quick-panel premium-card">
                <div class="quick-head">
                    <h2>Control Center</h2>
                    <span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="quick-grid">
                    <button type="button" class="${this.state.machine.network ? 'on' : ''}" data-action="toggle-hardware" data-key="network"><b>Network</b><span>${this.state.machine.network ? 'Online' : 'Offline'}</span></button>
                    <button type="button" class="${this.state.machine.keyboard ? 'on' : ''}" data-action="toggle-hardware" data-key="keyboard"><b>Keyboard</b><span>${this.state.machine.keyboard ? 'Ready' : 'Disabled'}</span></button>
                    <button type="button" class="${this.state.machine.mouse ? 'on' : ''}" data-action="toggle-hardware" data-key="mouse"><b>Mouse</b><span>${this.state.machine.mouse ? 'Ready' : 'Disabled'}</span></button>
                    <button type="button" class="${this.state.os.theme === 'dark' ? 'on' : ''}" data-action="toggle-theme"><b>Theme</b><span>${this.state.os.theme}</span></button>
                </div>
                <label>Volume ${this.state.machine.volume}
                    <input type="range" min="0" max="100" value="${this.state.machine.volume}" data-field="volume">
                </label>
                <p>Battery ${this.state.machine.battery}% - local desktop state is saved.</p>
            </div>
        `;
    }

    renderDesktopContext() {
        return `
            <div class="desktop-menu premium-card" style="left:${this.contextMenu.x}px;top:${this.contextMenu.y}px">
                <button type="button" data-action="refresh-desktop">Refresh</button>
                <button type="button" data-action="new-desktop-text">New text file</button>
                <button type="button" data-action="open-app" data-app="settings">Personalize</button>
                <button type="button" data-action="toggle-start">Open Start</button>
            </div>
        `;
    }

    renderWindow(win) {
        const style = win.max
            ? 'left:0;top:0;width:100%;height:100%;'
            : `left:${win.x}px;top:${win.y}px;width:${win.w}px;height:${win.h}px;`;
        return `
            <section class="w12-window ${win.max ? 'max' : ''}" style="${style}z-index:${win.z}" data-window-shell="${win.id}">
                <header class="window-titlebar" data-drag-window="${win.id}">
                    ${this.renderGlyph(win.app, 'window')}
                    <strong>${escapeHtml(win.title)}</strong>
                    <div class="window-controls">
                        <button class="win-min" type="button" data-action="min-window" data-window="${win.id}"><span></span></button>
                        <button class="win-max" type="button" data-action="max-window" data-window="${win.id}"><span></span></button>
                        <button class="win-close" type="button" data-action="close-window" data-window="${win.id}"><span></span></button>
                    </div>
                </header>
                <div class="window-body">${this.renderApp(win)}</div>
                ${win.max ? '' : `<span class="resize-handle" data-resize-window="${win.id}"></span>`}
            </section>
        `;
    }

    renderApp(win) {
        if (!this.state.installedApps.includes(win.app) && !STORE_APPS.some((app) => app.id === win.app)) {
            return '<div class="app-empty">This app is not installed.</div>';
        }
        if (win.app === 'files') return this.renderFiles(win);
        if (win.app === 'browser') return this.renderBrowser(win);
        if (win.app === 'settings') return this.renderSettings(win);
        if (win.app === 'terminal') return this.renderTerminal(win);
        if (win.app === 'notepad') return this.renderNotepad(win);
        if (win.app === 'calculator') return this.renderCalculator(win);
        if (win.app === 'viewer') return this.renderViewer(win);
        if (win.app === 'taskmgr') return this.renderTaskManager(win);
        if (win.app === 'store') return this.renderStore(win);
        if (win.app === 'gamehub') return this.renderGameHub(win);
        if (win.app === 'games') return this.renderGames(win);
        if (win.app === 'mines') return this.renderMines(win);
        if (win.app === 'snake') return this.renderSnake(win);
        return this.renderPlaceholderApp(win);
    }

    renderFiles(win) {
        const path = win.data.path || '/Desktop';
        const children = this.fsChildren(path);
        return `
            <div class="files-app">
                <div class="files-toolbar">
                    <button type="button" data-action="file-up" data-window="${win.id}" ${path === '/' ? 'disabled' : ''}>Up</button>
                    <button type="button" data-action="file-new-folder" data-window="${win.id}">New folder</button>
                    <button type="button" data-action="file-new-text" data-window="${win.id}">New text</button>
                    <span>${escapeHtml(path)}</span>
                </div>
                <div class="file-list">
                    ${children.length ? children.map((entry) => `
                        <div class="file-row">
                            ${this.renderGlyph(entry.item.type === 'folder' ? 'folder' : entry.item.type === 'media' ? 'viewer' : 'document', 'file')}
                            <button type="button" class="file-open" data-action="open-path" data-path="${escapeHtml(entry.path)}">${escapeHtml(baseName(entry.path))}</button>
                            <em>${entry.item.type}</em>
                            <i>
                                <button type="button" data-action="file-rename" data-path="${escapeHtml(entry.path)}">Rename</button>
                                <button type="button" data-action="file-delete" data-path="${escapeHtml(entry.path)}">Delete</button>
                            </i>
                        </div>
                    `).join('') : '<p class="empty-note">This folder is empty.</p>'}
                </div>
            </div>
        `;
    }

    renderBrowser(win) {
        const url = win.data.url || 'nova://start';
        const isInternal = url.startsWith('nova://') || !url.includes('://');
        const history = this.state.browser.history.slice(-5).reverse();
        return `
            <div class="browser-app">
                <form class="browser-bar" data-form="browser-nav" data-window="${win.id}">
                    <button type="button" data-action="browser-home" data-window="${win.id}">Home</button>
                    <input name="url" data-field="browser-url" data-window="${win.id}" value="${escapeHtml(url)}" ${this.state.machine.keyboard ? '' : 'disabled'}>
                    <button type="submit">Go</button>
                    <button type="button" data-action="browser-bookmark" data-window="${win.id}">Star</button>
                </form>
                <div class="browser-page">
                    ${isInternal ? this.renderNovaPage(url, history) : `
                        <iframe sandbox="allow-scripts allow-forms allow-same-origin" src="${escapeHtml(url)}"></iframe>
                        <p class="browser-hint">Some pages may block embedding. The address still saves to history.</p>
                    `}
                </div>
            </div>
        `;
    }

    renderNovaPage(url, history) {
        if (url.startsWith('nova://search')) {
            const query = this.searchQueryFromUrl(url);
            const encoded = encodeURIComponent(query);
            const results = [
                ['Web search', `https://www.google.com/search?q=${encoded}`, 'Search the public web in a new embeddable attempt or copy URL.'],
                ['Wikipedia', `https://en.wikipedia.org/wiki/Special:Search?search=${encoded}`, 'Look up encyclopedia results.'],
                ['MDN Docs', `https://developer.mozilla.org/search?q=${encoded}`, 'Search developer documentation.'],
                ['Example page', 'https://example.com', 'A reliable embeddable page for testing browser rendering.']
            ];
            return `
                <section class="nova-home nova-results">
                    <div class="nova-hero">
                        ${this.renderGlyph('browser', 'hero')}
                        <div>
                            <h1>Search results</h1>
                            <p>Nova handled "${escapeHtml(query)}" locally so the page does not look broken when search engines block embedding.</p>
                        </div>
                    </div>
                    <div class="nova-cards">
                        ${results.map(([title, target, desc]) => `
                            <button type="button" data-action="browser-quick" data-url="${escapeHtml(target)}">
                                <b>${escapeHtml(title)}</b>
                                <span>${escapeHtml(desc)}</span>
                            </button>
                        `).join('')}
                    </div>
                </section>
            `;
        }
        return `
            <section class="nova-home">
                <div class="nova-hero">
                    ${this.renderGlyph('browser', 'hero')}
                    <div>
                        <h1>Nova Browser</h1>
                        <p>Search, save bookmarks, and keep local history for this bedroom PC.</p>
                    </div>
                </div>
                <div class="nova-cards">
                    <button type="button" data-action="browser-quick" data-url="https://example.com"><b>Launchpad</b><span>example.com</span></button>
                    <button type="button" data-action="browser-quick" data-url="https://developer.mozilla.org"><b>Dev Docs</b><span>developer.mozilla.org</span></button>
                    <button type="button" data-action="browser-quick" data-url="https://www.wikipedia.org"><b>Library</b><span>wikipedia.org</span></button>
                </div>
                <h2>Bookmarks</h2>
                <div class="link-list">
                    ${this.state.browser.bookmarks.map((item) => `<button type="button" data-action="browser-quick" data-url="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}
                </div>
                <h2>Recent</h2>
                <div class="link-list">
                    ${history.map((item) => `<button type="button" data-action="browser-quick" data-url="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('') || '<span>No history yet.</span>'}
                </div>
            </section>
        `;
    }

    renderSettings() {
        const storageUsed = JSON.stringify(this.state.fs).length;
        return `
            <div class="settings-app">
                <aside>
                    <strong>Settings</strong>
                    <span>System</span>
                    <span>Personalization</span>
                    <span>Hardware</span>
                    <span>Storage</span>
                </aside>
                <main>
                    <section>
                        <h2>Personalization</h2>
                        <div class="seg-row">
                            <button type="button" class="${this.state.os.theme === 'dark' ? 'active' : ''}" data-action="set-theme" data-theme="dark">Dark</button>
                            <button type="button" class="${this.state.os.theme === 'light' ? 'active' : ''}" data-action="set-theme" data-theme="light">Light</button>
                        </div>
                        <div class="swatch-row">
                            ${ACCENTS.map((color) => `<button type="button" style="--swatch:${color}" class="${this.state.os.accent === color ? 'active' : ''}" data-action="set-accent" data-color="${color}"></button>`).join('')}
                        </div>
                        <div class="wallpaper-row">
                            ${WALLPAPERS.map((wp) => `<button type="button" class="wallpaper-tile wallpaper-${wp.id} ${this.state.os.wallpaper === wp.id ? 'active' : ''}" data-action="set-wallpaper" data-wallpaper="${wp.id}">${wp.name}</button>`).join('')}
                        </div>
                    </section>
                    <section>
                        <h2>Hardware</h2>
                        ${['monitor', 'video', 'keyboard', 'mouse', 'network'].map((key) => `
                            <button type="button" class="toggle-row" data-action="toggle-hardware" data-key="${key}">
                                <span>${key}</span><strong>${this.state.machine[key] ? 'Enabled' : 'Disabled'}</strong>
                            </button>
                        `).join('')}
                    </section>
                    <section>
                        <h2>Storage and reset</h2>
                        <p>${Object.keys(this.state.fs).length} virtual entries, about ${Math.round(storageUsed / 1024)} KB saved.</p>
                        <button type="button" data-action="reset-os">Reset or reinstall OS</button>
                    </section>
                    <section>
                        <h2>About</h2>
                        <p>Windows 12 Bedroom Edition, original shell. CPU NovaCore 8, GPU RGB Phantom, 16 GB RAM.</p>
                    </section>
                </main>
            </div>
        `;
    }

    renderTerminal(win) {
        const lines = this.state.terminal.history.slice(-80);
        return `
            <div class="terminal-app">
                <pre>${escapeHtml(lines.join('\n'))}</pre>
                <form data-form="terminal" data-window="${win.id}">
                    <span>${escapeHtml(this.state.terminal.cwd)}&gt;</span>
                    <input name="command" data-field="terminal-input" data-window="${win.id}" value="${escapeHtml(win.data.input || '')}" autocomplete="off" ${this.state.machine.keyboard ? '' : 'disabled'}>
                </form>
            </div>
        `;
    }

    renderNotepad(win) {
        const path = win.data.path || '';
        return `
            <div class="notepad-app">
                <div class="note-toolbar">
                    <span>${path ? escapeHtml(path) : 'Unsaved note'}</span>
                    <button type="button" data-action="note-save" data-window="${win.id}">Save</button>
                    <button type="button" data-action="note-save-as" data-window="${win.id}">Save as new</button>
                </div>
                <textarea data-field="notepad-content" data-window="${win.id}" ${this.state.machine.keyboard ? '' : 'disabled'}>${escapeHtml(win.data.content || '')}</textarea>
            </div>
        `;
    }

    renderCalculator(win) {
        const buttons = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+'];
        return `
            <div class="calculator-app">
                <input data-field="calc-expr" data-window="${win.id}" value="${escapeHtml(win.data.expr || '')}" ${this.state.machine.keyboard ? '' : 'disabled'}>
                <div class="calc-grid">
                    ${buttons.map((key) => `<button type="button" data-action="calc-key" data-window="${win.id}" data-key="${key}">${key}</button>`).join('')}
                    <button type="button" data-action="calc-clear" data-window="${win.id}">Clear</button>
                    <button type="button" data-action="calc-back" data-window="${win.id}">Back</button>
                </div>
                <p>${escapeHtml(win.data.result || 'Ready')}</p>
            </div>
        `;
    }

    renderViewer(win) {
        const media = win.data.media || 'aurora';
        return `
            <div class="viewer-app">
                <div class="viewer-art wallpaper-${media}"></div>
                <h2>${escapeHtml(win.data.title || 'Media Viewer')}</h2>
                <p>${escapeHtml(win.data.path || 'Generated Windows 12 media preview')}</p>
            </div>
        `;
    }

    renderTaskManager() {
        const cpu = 28 + Math.round(Math.sin(Date.now() / 900) * 12);
        const ram = 43 + this.windows.length * 4;
        return `
            <div class="taskmgr-app">
                <section>
                    <h2>Performance</h2>
                    <div class="meter"><span style="width:${cpu}%"></span></div><p>CPU ${cpu}%</p>
                    <div class="meter"><span style="width:${ram}%"></span></div><p>Memory ${ram}%</p>
                </section>
                <section>
                    <h2>Processes</h2>
                    ${this.windows.map((win) => `
                        <div class="process-row">
                            <span>${this.renderGlyph(win.app, 'file')} ${escapeHtml(win.title)}</span>
                            <button type="button" data-action="close-window" data-window="${win.id}">End task</button>
                        </div>
                    `).join('') || '<p>No app windows open.</p>'}
                </section>
            </div>
        `;
    }

    renderStore() {
        return `
            <div class="store-app">
                <div class="store-hero">
                    ${this.renderGlyph('store', 'hero')}
                    <div>
                        <h1>App Store</h1>
                        <p>Install compact local utilities. They persist in Start and the desktop shell.</p>
                    </div>
                </div>
                <div class="store-grid">
                    ${STORE_APPS.map((app) => {
                        const installed = this.state.installedApps.includes(app.id);
                        return `
                            <article>
                                ${this.renderGlyph(app.id, 'store')}
                                <h2>${app.title}</h2>
                                <p>${app.desc}</p>
                                <button type="button" data-action="${installed ? 'open-app' : 'store-install'}" data-app="${app.id}">
                                    ${installed ? 'Open' : 'Install'}
                                </button>
                            </article>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    renderGames() {
        return `
            <div class="games-app">
                <article>
                    ${this.renderGlyph('gamehub', 'hero')}
                    <h1>5ivesaw Game Hub</h1>
                    <p>Open the full local game library copied into this room PC.</p>
                    <button type="button" data-action="open-app" data-app="gamehub">Open Game Hub</button>
                </article>
                <article>
                    ${this.renderGlyph('mines', 'hero')}
                    <h1>Mine Tiles</h1>
                    <p>Reveal every safe tile. Right click or Alt-click flags a mine.</p>
                    <button type="button" data-action="open-app" data-app="mines">Play Mine Tiles</button>
                </article>
                <article>
                    ${this.renderGlyph('snake', 'hero')}
                    <h1>Neon Snake</h1>
                    <p>Use arrow keys while this monitor is open. Eat dots, avoid yourself.</p>
                    <button type="button" data-action="open-app" data-app="snake">Play Neon Snake</button>
                </article>
            </div>
        `;
    }

    renderGameHub() {
        return `
            <div class="gamehub-app">
                <iframe
                    class="gamehub-frame"
                    src="./gamehub/index.html"
                    title="5ivesaw Games Hub"
                    sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-modals"
                ></iframe>
            </div>
        `;
    }

    renderMines(win) {
        this.ensureMines(win);
        const game = win.data.mines;
        return `
            <div class="mines-app">
                <div class="game-toolbar">
                    <strong>Mines: ${game.mines}</strong>
                    <span>${game.status}</span>
                    <button type="button" data-action="mines-reset" data-window="${win.id}">Reset</button>
                </div>
                <div class="mines-grid" style="grid-template-columns:repeat(${game.size},1fr)">
                    ${game.cells.map((cell, index) => `
                        <button type="button" class="${cell.open ? 'open' : ''} ${cell.flag ? 'flag' : ''}" data-action="mines-cell" data-window="${win.id}" data-cell="${index}">
                            ${cell.open ? (cell.mine ? '*' : (cell.count || '')) : (cell.flag ? 'F' : '')}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    renderSnake(win) {
        this.ensureSnake(win);
        const game = win.data.snake;
        const cells = [];
        for (let y = 0; y < game.size; y++) {
            for (let x = 0; x < game.size; x++) {
                const bodyIndex = game.snake.findIndex((part) => part.x === x && part.y === y);
                const isFood = game.food.x === x && game.food.y === y;
                cells.push(`<span class="${bodyIndex === 0 ? 'head' : bodyIndex > -1 ? 'body' : isFood ? 'food' : ''}"></span>`);
            }
        }
        return `
            <div class="snake-app">
                <div class="game-toolbar">
                    <strong>Score: ${game.score}</strong>
                    <span>${game.status}</span>
                    <button type="button" data-action="snake-start" data-window="${win.id}">${game.running ? 'Pause' : 'Start'}</button>
                    <button type="button" data-action="snake-reset" data-window="${win.id}">Reset</button>
                </div>
                <div class="snake-grid" style="grid-template-columns:repeat(${game.size},1fr)">${cells.join('')}</div>
            </div>
        `;
    }

    renderPlaceholderApp(win) {
        const app = STORE_APPS.find((item) => item.id === win.app);
        return `
            <div class="placeholder-app">
                ${this.renderGlyph(win.app, 'hero')}
                <h1>${escapeHtml(app?.title || win.title)}</h1>
                <p>${escapeHtml(app?.desc || 'Installed placeholder app.')}</p>
                <div class="utility-grid">
                    <span>Installed</span>
                    <span>Start menu</span>
                    <span>Persistent</span>
                    <span>Local</span>
                </div>
            </div>
        `;
    }

    handleClick(event) {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl || !this.overlay.contains(actionEl)) return;
        const action = actionEl.dataset.action;

        if (!action.startsWith('file-')) event.stopPropagation();
        this.contextMenu = null;
        this.playSound(this.soundForAction(action));

        if (action === 'close-pc') return this.close();
        if (action === 'repair-signal') return this.repairSignal();
        if (action === 'pc-power') return this.powerOn();
        if (action === 'boot-menu-power') return this.powerOn('bootMenu');
        if (action === 'firmware-power') return this.powerOn('firmware');
        if (action === 'power-off') return this.powerOff();
        if (action === 'reboot') return this.reboot();
        if (action === 'boot-menu') return this.setPhase('bootMenu');
        if (action === 'boot-internal') return this.bootInternal();
        if (action === 'boot-usb') return this.startInstaller();
        if (action === 'firmware') return this.setPhase('firmware');
        if (action === 'reset-os') return this.resetOS();
        if (action === 'installer-back') return this.installerBack();
        if (action === 'wake-sleep') return this.setPhase('login');
        if (action === 'sleep') return this.sleep();
        if (action === 'toggle-start') return this.toggleStart();
        if (action === 'power-menu') return this.toggleQuick();
        if (action === 'toggle-quick') return this.toggleQuick();
        if (action === 'toggle-theme') return this.setTheme(this.state.os.theme === 'dark' ? 'light' : 'dark');
        if (action === 'set-theme') return this.setTheme(actionEl.dataset.theme);
        if (action === 'set-accent') return this.setAccent(actionEl.dataset.color);
        if (action === 'set-wallpaper') return this.setWallpaper(actionEl.dataset.wallpaper);
        if (action === 'toggle-hardware') return this.toggleHardware(actionEl.dataset.key);
        if (action === 'refresh-desktop') return this.render();
        if (action === 'new-desktop-text') return this.createTextFile('/Desktop');
        if (action === 'open-app') return this.openApp(actionEl.dataset.app);
        if (action === 'open-path') return this.openPath(actionEl.dataset.path);
        if (action === 'task-window') return this.toggleTaskWindow(Number(actionEl.dataset.window));
        if (action === 'close-window') return this.closeWindow(Number(actionEl.dataset.window));
        if (action === 'min-window') return this.minWindow(Number(actionEl.dataset.window));
        if (action === 'max-window') return this.maxWindow(Number(actionEl.dataset.window));
        if (action === 'file-up') return this.fileUp(Number(actionEl.dataset.window));
        if (action === 'file-new-folder') return this.createFolder(this.windowById(Number(actionEl.dataset.window))?.data.path || '/Desktop');
        if (action === 'file-new-text') return this.createTextFile(this.windowById(Number(actionEl.dataset.window))?.data.path || '/Desktop');
        if (action === 'file-delete') return this.deletePath(actionEl.dataset.path);
        if (action === 'file-rename') return this.renamePath(actionEl.dataset.path);
        if (action === 'browser-home') return this.navigateBrowser(Number(actionEl.dataset.window), 'nova://start');
        if (action === 'browser-bookmark') return this.bookmarkBrowser(Number(actionEl.dataset.window));
        if (action === 'browser-quick') return this.navigateFocusedBrowser(actionEl.dataset.url);
        if (action === 'note-save') return this.saveNote(Number(actionEl.dataset.window), false);
        if (action === 'note-save-as') return this.saveNote(Number(actionEl.dataset.window), true);
        if (action === 'calc-key') return this.calcKey(Number(actionEl.dataset.window), actionEl.dataset.key);
        if (action === 'calc-clear') return this.calcClear(Number(actionEl.dataset.window));
        if (action === 'calc-back') return this.calcBack(Number(actionEl.dataset.window));
        if (action === 'store-install') return this.installStoreApp(actionEl.dataset.app);
        if (action === 'mines-reset') return this.resetMines(Number(actionEl.dataset.window));
        if (action === 'mines-cell') return this.clickMine(Number(actionEl.dataset.window), Number(actionEl.dataset.cell), event);
        if (action === 'snake-start') return this.toggleSnake(Number(actionEl.dataset.window));
        if (action === 'snake-reset') return this.resetSnake(Number(actionEl.dataset.window));
    }

    soundForAction(action) {
        if (['pc-power', 'boot-menu-power', 'firmware-power', 'reboot', 'boot-internal', 'boot-usb'].includes(action)) return 'boot';
        if (['power-off', 'close-pc', 'close-window', 'sleep'].includes(action)) return 'close';
        if (['open-app', 'open-path', 'task-window', 'toggle-start', 'toggle-quick', 'power-menu'].includes(action)) return 'open';
        if (['set-theme', 'set-accent', 'set-wallpaper', 'toggle-hardware', 'toggle-theme'].includes(action)) return 'toggle';
        if (['note-save', 'note-save-as', 'browser-bookmark', 'file-new-folder', 'file-new-text'].includes(action)) return 'save';
        if (['reset-os', 'file-delete', 'calc-clear'].includes(action)) return 'error';
        if (['min-window', 'max-window'].includes(action)) return 'click';
        if (action.startsWith('installer') || action === 'repair-signal') return 'install';
        return 'click';
    }

    handleSubmit(event) {
        const form = event.target.closest('form[data-form]');
        if (!form || !this.overlay.contains(form)) return;
        event.preventDefault();
        event.stopPropagation();
        const type = form.dataset.form;
        const data = new FormData(form);
        this.playSound(type.startsWith('installer') ? 'install' : type === 'login' ? 'open' : type === 'terminal' ? 'type' : 'click');

        if (type === 'installer-language') {
            this.state.os.language = data.get('language') || 'English (US)';
            this.state.os.drive = data.get('drive') || 'NVMe 0 - 512 GB';
            this.install.step = 'account';
        } else if (type === 'installer-account') {
            const name = String(data.get('name') || 'Player').trim() || 'Player';
            this.state.os.user.name = name.slice(0, 32);
            this.state.os.user.password = String(data.get('password') || '');
            this.state.os.user.pin = String(data.get('pin') || '').trim();
            this.install.step = 'personalize';
        } else if (type === 'installer-theme') {
            this.state.os.theme = data.get('theme') || 'dark';
            this.state.os.accent = data.get('accent') || '#4cc9ff';
            this.state.os.wallpaper = data.get('wallpaper') || 'aurora';
            this.install.step = 'progress';
            this.install.progress = 0;
            this.install.stage = 0;
        } else if (type === 'login') {
            this.state.machine.phase = 'desktop';
            this.addNotification('Signed in', `Welcome back, ${this.state.os.user.name}.`);
        } else if (type === 'browser-nav') {
            const url = String(data.get('url') || 'nova://start');
            this.navigateBrowser(Number(form.dataset.window), url);
        } else if (type === 'terminal') {
            this.runTerminalCommand(Number(form.dataset.window), String(data.get('command') || ''));
        }

        this.saveState();
        this.render();
    }

    handleInput(event) {
        const field = event.target.dataset.field;
        if (!field) return;
        if (['search', 'browser-url', 'terminal-input', 'notepad-content', 'calc-expr'].includes(field)) this.playSound('type');
        if (field === 'search') {
            this.searchQuery = event.target.value;
            this.render();
        } else if (field === 'volume') {
            this.state.machine.volume = Number(event.target.value);
            this.saveState();
            this.render();
        } else if (field === 'browser-url') {
            const win = this.windowById(Number(event.target.dataset.window));
            if (win) win.data.url = event.target.value;
        } else if (field === 'terminal-input') {
            const win = this.windowById(Number(event.target.dataset.window));
            if (win) win.data.input = event.target.value;
        } else if (field === 'notepad-content') {
            const win = this.windowById(Number(event.target.dataset.window));
            if (win) win.data.content = event.target.value;
        } else if (field === 'calc-expr') {
            const win = this.windowById(Number(event.target.dataset.window));
            if (win) win.data.expr = event.target.value;
        }
        this.previewDirty = true;
    }

    handleChange(event) {
        const action = event.target.dataset.action;
        if (action === 'boot-target') {
            this.state.machine.bootTarget = event.target.value;
            this.saveState();
            this.previewDirty = true;
        }
    }

    handlePointerDown(event) {
        const winShell = event.target.closest('[data-window-shell]');
        if (winShell) this.focusWindow(Number(winShell.dataset.windowShell), false);

        const dragEl = event.target.closest('[data-drag-window]');
        const resizeEl = event.target.closest('[data-resize-window]');
        const desktop = event.target.closest('.w12-desktop');
        const actionEl = event.target.closest('[data-action]');
        const menuEl = event.target.closest('.start-menu, .quick-panel, .desktop-menu, .w12-taskbar, .desktop-widget, .notification-stack');

        if (resizeEl) {
            const win = this.windowById(Number(resizeEl.dataset.resizeWindow));
            if (win) {
                this.resize = {
                    id: win.id,
                    x: event.clientX,
                    y: event.clientY,
                    startW: win.w,
                    startH: win.h
                };
                this.playSound('resize');
                event.preventDefault();
            }
        } else if (dragEl && !event.target.closest('button')) {
            const win = this.windowById(Number(dragEl.dataset.dragWindow));
            if (win && !win.max) {
                this.drag = {
                    id: win.id,
                    x: event.clientX,
                    y: event.clientY,
                    startX: win.x,
                    startY: win.y
                };
                this.playSound('drag');
                event.preventDefault();
            }
        } else if (desktop && !winShell && !actionEl && !menuEl && event.button === 0 && this.state.machine.phase === 'desktop') {
            const pos = this.localPoint(event);
            this.selection = {
                startX: pos.x,
                startY: pos.y,
                x: pos.x,
                y: pos.y
            };
            this.startOpen = false;
            this.quickOpen = false;
            this.contextMenu = null;
            this.playSound('drag');
            this.render();
            event.preventDefault();
        }
    }

    handlePointerMove(event) {
        if (this.drag) {
            const win = this.windowById(this.drag.id);
            if (!win) return;
            win.x = clamp(this.drag.startX + event.clientX - this.drag.x, 0, Math.max(0, this.root.clientWidth - win.w));
            win.y = clamp(this.drag.startY + event.clientY - this.drag.y, 0, Math.max(0, this.root.clientHeight - win.h - 54));
            const shell = this.root.querySelector(`[data-window-shell="${win.id}"]`);
            if (shell) {
                shell.style.left = `${win.x}px`;
                shell.style.top = `${win.y}px`;
            }
            this.previewDirty = true;
        }
        if (this.resize) {
            const win = this.windowById(this.resize.id);
            if (!win) return;
            win.w = clamp(this.resize.startW + event.clientX - this.resize.x, 340, this.root.clientWidth - win.x);
            win.h = clamp(this.resize.startH + event.clientY - this.resize.y, 250, this.root.clientHeight - win.y - 54);
            const shell = this.root.querySelector(`[data-window-shell="${win.id}"]`);
            if (shell) {
                shell.style.width = `${win.w}px`;
                shell.style.height = `${win.h}px`;
            }
            this.previewDirty = true;
        }
        if (this.selection) {
            const pos = this.localPoint(event);
            this.selection.x = clamp(pos.x, 0, this.root.clientWidth);
            this.selection.y = clamp(pos.y, 0, this.root.clientHeight);
            const box = this.root.querySelector('.desktop-selection');
            if (box) {
                const left = Math.min(this.selection.startX, this.selection.x);
                const top = Math.min(this.selection.startY, this.selection.y);
                const width = Math.abs(this.selection.x - this.selection.startX);
                const height = Math.abs(this.selection.y - this.selection.startY);
                box.style.left = `${left}px`;
                box.style.top = `${top}px`;
                box.style.width = `${width}px`;
                box.style.height = `${height}px`;
            }
        }
    }

    finishPointerAction() {
        if (this.drag) {
            const win = this.windowById(this.drag.id);
            if (win) {
                if (win.x < 12) {
                    win.x = 0;
                    win.y = 0;
                    win.w = Math.floor(this.root.clientWidth / 2);
                    win.h = this.root.clientHeight - 54;
                } else if (win.x + win.w > this.root.clientWidth - 12) {
                    win.w = Math.floor(this.root.clientWidth / 2);
                    win.x = this.root.clientWidth - win.w;
                    win.y = 0;
                    win.h = this.root.clientHeight - 54;
                } else if (win.y < 8) {
                    win.max = true;
                }
                this.rememberWindow(win);
            }
            this.drag = null;
            this.render();
        }
        if (this.resize) {
            const win = this.windowById(this.resize.id);
            if (win) this.rememberWindow(win);
            this.resize = null;
            this.render();
        }
        if (this.selection) {
            const width = Math.abs(this.selection.x - this.selection.startX);
            const height = Math.abs(this.selection.y - this.selection.startY);
            if (width > 8 || height > 8) this.playSound('click');
            this.selection = null;
            this.render();
        }
    }

    localPoint(event) {
        const rect = this.root.getBoundingClientRect();
        return {
            x: clamp(event.clientX - rect.left, 0, rect.width),
            y: clamp(event.clientY - rect.top, 0, rect.height)
        };
    }

    handleContextMenu(event) {
        if (!this.visible || this.state.machine.phase !== 'desktop') return;
        const desktop = event.target.closest('.w12-desktop');
        const windowShell = event.target.closest('.w12-window');
        if (desktop && !windowShell) {
            event.preventDefault();
            this.contextMenu = { x: event.offsetX, y: event.offsetY };
            this.startOpen = false;
            this.quickOpen = false;
            this.selection = null;
            this.playSound('click');
            this.render();
        }
    }

    handleKeyDown(event) {
        if (!this.visible) return;
        const editable = event.target.closest && event.target.closest('input, textarea, select');
        if (!editable && event.key === 'Escape') {
            if (this.startOpen || this.quickOpen || this.contextMenu) {
                this.startOpen = false;
                this.quickOpen = false;
                this.contextMenu = null;
                this.render();
            } else {
                this.close();
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.altKey && event.key === 'Tab') {
            this.cycleWindows();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            const active = this.windows.reduce((best, win) => (!best || win.z > best.z ? win : best), null);
            if (active?.app === 'snake') {
                this.setSnakeDir(active, event.key);
                event.preventDefault();
            }
        }
        if (!editable) event.stopPropagation();
    }

    powerOn(nextPhase = null) {
        this.state.machine.powered = true;
        this.state.machine.phase = 'boot';
        this.bootTimer = 1.2;
        if (nextPhase) {
            this.bootNextPhase = nextPhase;
        } else if (this.state.machine.bootTarget === 'usb') {
            this.bootNextPhase = 'installer';
        } else if (this.state.machine.bootTarget === 'internal' && this.state.os.installed) {
            this.bootNextPhase = 'login';
        } else {
            this.bootNextPhase = this.state.os.installed ? 'login' : 'bootMenu';
        }
        this.saveState();
        this.render();
        this.playSound('boot');
    }

    powerOff() {
        this.state.machine.powered = false;
        this.state.machine.phase = 'off';
        this.shutdownExternalFrames();
        this.windows = [];
        this.startOpen = false;
        this.quickOpen = false;
        this.saveState();
        this.render();
        this.playSound('close');
    }

    reboot(nextPhase = null) {
        this.state.machine.powered = true;
        this.state.machine.phase = 'boot';
        this.bootTimer = 1.1;
        this.bootNextPhase = nextPhase || (this.state.os.installed ? 'login' : 'bootMenu');
        this.shutdownExternalFrames();
        this.windows = [];
        this.saveState();
        this.render();
        this.playSound('boot');
    }

    bootInternal() {
        if (!this.state.os.installed) return;
        this.reboot('login');
    }

    setPhase(phase) {
        this.state.machine.powered = true;
        this.state.machine.phase = phase;
        this.saveState();
        this.render();
    }

    startInstaller() {
        this.state.machine.powered = true;
        this.state.machine.phase = 'installer';
        this.install = { step: 'language', progress: 0, stage: 0 };
        this.saveState();
        this.render();
        this.playSound('install');
    }

    finishInstall() {
        if (this.install.step !== 'progress') return;
        const user = this.state.os.user.name || 'Player';
        this.state.os.installed = true;
        this.state.fs = defaultFs(user);
        this.state.browser = { history: [], bookmarks: ['nova://start'] };
        this.state.terminal = { cwd: '/Desktop', history: ['Install complete. Type help.'] };
        this.state.installedApps = APP_DEFS.map((app) => app.id);
        this.state.notifications = [{ id: `n${Date.now()}`, title: 'Install complete', body: 'Windows 12 is ready.', created: Date.now(), ttl: NOTIFICATION_TTL }];
        this.install.step = 'done';
        this.saveState();
        this.reboot('login');
        this.playSound('save');
    }

    installerBack() {
        if (this.install.step === 'account') this.install.step = 'language';
        else if (this.install.step === 'personalize') this.install.step = 'account';
        else this.state.machine.phase = 'bootMenu';
        this.render();
    }

    resetOS() {
        const keepMachine = clone(this.state.machine);
        const defaults = createDefaultState();
        defaults.machine = Object.assign(defaults.machine, keepMachine, { phase: 'bootMenu', powered: true });
        this.state = defaults;
        this.windows = [];
        this.startOpen = false;
        this.quickOpen = false;
        this.install = { step: 'language', progress: 0, stage: 0 };
        this.saveState();
        this.addNotification('Reset complete', 'The installed OS state was erased.');
        this.render();
        this.playSound('error');
    }

    repairSignal() {
        this.state.machine.monitor = true;
        this.state.machine.video = true;
        this.saveState();
        this.render();
    }

    sleep() {
        this.state.machine.phase = 'sleep';
        this.saveState();
        this.render();
        this.playSound('close');
    }

    toggleStart() {
        this.startOpen = !this.startOpen;
        this.quickOpen = false;
        this.searchQuery = '';
        this.render();
        this.playSound('open');
    }

    toggleQuick() {
        this.quickOpen = !this.quickOpen;
        this.startOpen = false;
        this.render();
        this.playSound('open');
    }

    setTheme(theme) {
        this.state.os.theme = theme === 'light' ? 'light' : 'dark';
        this.saveState();
        this.render();
        this.playSound('toggle');
    }

    setAccent(color) {
        if (ACCENTS.includes(color)) this.state.os.accent = color;
        this.saveState();
        this.render();
        this.playSound('toggle');
    }

    setWallpaper(wallpaper) {
        if (WALLPAPERS.some((wp) => wp.id === wallpaper)) this.state.os.wallpaper = wallpaper;
        this.saveState();
        this.render();
        this.playSound('toggle');
    }

    toggleHardware(key) {
        if (!Object.prototype.hasOwnProperty.call(this.state.machine, key)) return;
        this.state.machine[key] = !this.state.machine[key];
        this.saveState();
        this.render();
        this.playSound('toggle');
    }

    visibleNotifications() {
        const now = Date.now();
        return this.state.notifications.filter((item) => item.created && now - item.created < (item.ttl || NOTIFICATION_TTL));
    }

    pruneNotifications() {
        const before = this.state.notifications.length;
        this.state.notifications = this.visibleNotifications();
        if (this.state.notifications.length !== before) {
            this.saveState();
            this.previewDirty = true;
            return true;
        }
        return false;
    }

    addNotification(title, body, ttl = NOTIFICATION_TTL) {
        this.playSound('notify');
        this.state.notifications.push({ id: `n${Date.now()}`, title, body, created: Date.now(), ttl });
        this.state.notifications = this.state.notifications.slice(-5);
        this.previewDirty = true;
    }

    appIcon(appId) {
        const extras = {
            folder: 'FD',
            document: 'TX',
            pixelpaint: 'PP',
            weather: 'WT',
            radio: 'RR',
            codepad: 'CP'
        };
        return APP_DEFS.find((app) => app.id === appId)?.icon || STORE_APPS.find((app) => app.id === appId)?.icon || extras[appId] || 'AP';
    }

    appTitle(appId) {
        return APP_DEFS.find((app) => app.id === appId)?.title || STORE_APPS.find((app) => app.id === appId)?.title || 'App';
    }

    openApp(appId, data = {}) {
        if (!appId) return;
        this.playSound('app');
        if (!this.state.installedApps.includes(appId) && STORE_APPS.some((app) => app.id === appId)) {
            this.installStoreApp(appId);
        }
        const reusable = !['notepad', 'viewer', 'mines', 'snake'].includes(appId);
        const existing = reusable ? this.windows.find((win) => win.app === appId) : null;
        if (existing) {
            existing.min = false;
            Object.assign(existing.data, data);
            this.focusWindow(existing.id);
            return;
        }

        const pos = this.state.windowPositions[appId] || {};
        const offset = (this.windows.length % 4) * 26;
        const win = {
            id: this.nextWindowId++,
            app: appId,
            title: data.title || this.appTitle(appId),
            x: pos.x ?? 80 + offset,
            y: pos.y ?? 54 + offset,
            w: pos.w ?? this.defaultWindowSize(appId).w,
            h: pos.h ?? this.defaultWindowSize(appId).h,
            max: pos.max ?? false,
            min: false,
            z: ++this.zCounter,
            data: this.initAppData(appId, data)
        };
        this.windows.push(win);
        this.startOpen = false;
        this.quickOpen = false;
        this.render();
    }

    initAppData(appId, data) {
        if (appId === 'files') return { path: data.path || '/Desktop' };
        if (appId === 'browser') return { url: data.url || 'nova://start' };
        if (appId === 'terminal') return { input: '' };
        if (appId === 'notepad') return { path: data.path || '', content: data.content ?? '' };
        if (appId === 'calculator') return { expr: '', result: 'Ready' };
        if (appId === 'viewer') return { path: data.path || '', media: data.media || 'aurora', title: data.title || baseName(data.path || 'Media') };
        if (appId === 'mines') return {};
        if (appId === 'snake') return {};
        return clone(data);
    }

    defaultWindowSize(appId) {
        if (appId === 'settings') return { w: 760, h: 520 };
        if (appId === 'browser') return { w: 820, h: 540 };
        if (appId === 'terminal') return { w: 650, h: 420 };
        if (appId === 'calculator') return { w: 340, h: 440 };
        if (appId === 'gamehub') return { w: 1040, h: 650 };
        if (appId === 'mines' || appId === 'snake') return { w: 420, h: 500 };
        return { w: 640, h: 460 };
    }

    windowById(id) {
        return this.windows.find((win) => win.id === id);
    }

    focusWindow(id, rerender = true) {
        const win = this.windowById(id);
        if (!win) return;
        win.z = ++this.zCounter;
        if (rerender) this.render();
    }

    closeWindow(id) {
        const win = this.windowById(id);
        if (win) this.rememberWindow(win);
        this.windows = this.windows.filter((item) => item.id !== id);
        this.playSound('close');
        this.render();
    }

    minWindow(id) {
        const win = this.windowById(id);
        if (win) win.min = true;
        this.playSound('click');
        this.render();
    }

    maxWindow(id) {
        const win = this.windowById(id);
        if (!win) return;
        win.max = !win.max;
        this.rememberWindow(win);
        this.playSound('open');
        this.render();
    }

    toggleTaskWindow(id) {
        const win = this.windowById(id);
        if (!win) return;
        if (win.min) win.min = false;
        else this.focusWindow(id, false);
        this.playSound('open');
        this.render();
    }

    cycleWindows() {
        if (this.windows.length < 2) return;
        const sorted = this.windows.slice().sort((a, b) => b.z - a.z);
        const next = sorted[1];
        next.min = false;
        this.focusWindow(next.id);
    }

    rememberWindow(win) {
        this.state.windowPositions[win.app] = {
            x: win.x,
            y: win.y,
            w: win.w,
            h: win.h,
            max: win.max
        };
        this.saveState();
    }

    fsChildren(folder) {
        return Object.entries(this.state.fs)
            .filter(([path]) => path !== folder && parentPath(path) === folder)
            .map(([path, item]) => ({ path, item }))
            .sort((a, b) => {
                if (a.item.type === 'folder' && b.item.type !== 'folder') return -1;
                if (a.item.type !== 'folder' && b.item.type === 'folder') return 1;
                return baseName(a.path).localeCompare(baseName(b.path));
            });
    }

    openPath(path) {
        const item = this.state.fs[path];
        if (!item) return;
        if (item.type === 'folder') {
            const explorer = this.windows.find((win) => win.app === 'files');
            if (explorer) {
                explorer.data.path = path;
                this.focusWindow(explorer.id, false);
                this.render();
            } else {
                this.openApp('files', { path });
            }
        } else if (item.type === 'text') {
            this.openApp('notepad', { path, content: item.content || '', title: baseName(path) });
        } else if (item.type === 'media') {
            this.openApp('viewer', { path, media: item.media || 'aurora', title: baseName(path) });
        }
        this.state.recentFiles = [path].concat(this.state.recentFiles.filter((itemPath) => itemPath !== path)).slice(0, 10);
        this.saveState();
    }

    fileUp(id) {
        const win = this.windowById(id);
        if (!win) return;
        win.data.path = parentPath(win.data.path || '/Desktop');
        this.render();
    }

    createFolder(folder) {
        if (!this.state.fs[folder] || this.state.fs[folder].type !== 'folder') return;
        const path = uniquePath(this.state.fs, folder, 'New Folder');
        this.state.fs[path] = { type: 'folder', created: nowStamp(), modified: nowStamp() };
        this.playSound('save');
        this.saveState();
        this.render();
    }

    createTextFile(folder) {
        if (!this.state.fs[folder] || this.state.fs[folder].type !== 'folder') return;
        const path = uniquePath(this.state.fs, folder, 'New Note.txt');
        this.state.fs[path] = {
            type: 'text',
            content: 'New note',
            created: nowStamp(),
            modified: nowStamp()
        };
        this.playSound('save');
        this.saveState();
        this.render();
    }

    deletePath(path) {
        if (!path || path === '/') return;
        const remove = Object.keys(this.state.fs).filter((itemPath) => itemPath === path || itemPath.startsWith(`${path}/`));
        for (const itemPath of remove) delete this.state.fs[itemPath];
        this.playSound('error');
        this.saveState();
        this.render();
    }

    renamePath(path) {
        const item = this.state.fs[path];
        if (!item || path === '/') return;
        const newName = prompt('Rename item', baseName(path));
        if (!newName) return;
        const clean = newName.replace(/[\\/:*?"<>|]/g, '').trim();
        if (!clean) return;
        const nextPath = uniquePath(this.state.fs, parentPath(path), clean);
        const updates = Object.entries(this.state.fs)
            .filter(([itemPath]) => itemPath === path || itemPath.startsWith(`${path}/`));
        for (const [itemPath, value] of updates) {
            const tail = itemPath.slice(path.length);
            this.state.fs[nextPath + tail] = value;
            delete this.state.fs[itemPath];
        }
        this.playSound('save');
        this.saveState();
        this.render();
    }

    navigateBrowser(id, rawUrl) {
        const win = this.windowById(id) || this.windows.find((item) => item.app === 'browser');
        if (!win) return;
        const url = this.normalizeUrl(rawUrl);
        win.data.url = url;
        if (url !== 'nova://start') {
            this.state.browser.history.push(url);
            this.state.browser.history = this.state.browser.history.slice(-50);
        }
        this.playSound('open');
        this.saveState();
        this.render();
    }

    navigateFocusedBrowser(url) {
        const win = this.windows.find((item) => item.app === 'browser') || this.openApp('browser');
        const browserWin = this.windows.find((item) => item.app === 'browser');
        if (browserWin) this.navigateBrowser(browserWin.id, url);
        return win;
    }

    normalizeUrl(rawUrl) {
        let url = String(rawUrl || 'nova://start').trim();
        if (!url) return 'nova://start';
        if (url.startsWith('nova://')) return url;
        try {
            const parsed = new URL(url.includes('://') ? url : `https://${url}`);
            if (parsed.hostname.includes('google.') && parsed.pathname === '/search' && parsed.searchParams.get('q')) {
                return `nova://search?q=${encodeURIComponent(parsed.searchParams.get('q'))}`;
            }
        } catch {}
        if (!url.includes('://')) {
            if (url.includes('.') && !url.includes(' ')) url = `https://${url}`;
            else url = `nova://search?q=${encodeURIComponent(url)}`;
        }
        return url;
    }

    searchQueryFromUrl(url) {
        try {
            return new URL(url.replace('nova://search', 'https://nova.local/search')).searchParams.get('q') || '';
        } catch {
            return '';
        }
    }

    bookmarkBrowser(id) {
        const win = this.windowById(id);
        const url = win?.data.url || 'nova://start';
        if (!this.state.browser.bookmarks.includes(url)) this.state.browser.bookmarks.push(url);
        this.playSound('save');
        this.saveState();
        this.addNotification('Bookmark saved', url);
        this.render();
    }

    saveNote(id, forceNew) {
        const win = this.windowById(id);
        if (!win) return;
        let path = forceNew || !win.data.path ? uniquePath(this.state.fs, '/Documents', 'Untitled.txt') : win.data.path;
        this.state.fs[path] = {
            type: 'text',
            content: win.data.content || '',
            created: this.state.fs[path]?.created || nowStamp(),
            modified: nowStamp()
        };
        win.data.path = path;
        win.title = baseName(path);
        this.addNotification('Saved', path);
        this.playSound('save');
        this.saveState();
        this.render();
    }

    calcKey(id, key) {
        const win = this.windowById(id);
        if (!win) return;
        if (key === '=') return this.calcEval(win);
        win.data.expr = `${win.data.expr || ''}${key}`;
        this.playSound('click');
        this.render();
    }

    calcEval(win) {
        const expr = String(win.data.expr || '');
        if (!/^[\d+\-*/().\s]+$/.test(expr)) {
            win.data.result = 'Invalid expression';
        } else {
            try {
                win.data.result = String(Function(`"use strict";return (${expr})`)());
            } catch {
                win.data.result = 'Could not calculate';
            }
        }
        this.playSound('save');
        this.render();
    }

    calcClear(id) {
        const win = this.windowById(id);
        if (!win) return;
        win.data.expr = '';
        win.data.result = 'Ready';
        this.playSound('error');
        this.render();
    }

    calcBack(id) {
        const win = this.windowById(id);
        if (!win) return;
        win.data.expr = String(win.data.expr || '').slice(0, -1);
        this.playSound('click');
        this.render();
    }

    installStoreApp(appId) {
        if (!this.state.installedApps.includes(appId)) {
            this.state.installedApps.push(appId);
            this.addNotification('App installed', this.appTitle(appId));
            this.saveState();
        }
        this.playSound('install');
        this.openApp(appId);
    }

    runTerminalCommand(id, raw) {
        const win = this.windowById(id);
        if (!win) return;
        const command = raw.trim();
        if (!command) return;
        const out = this.executeCommand(command);
        this.state.terminal.history.push(`${this.state.terminal.cwd}> ${command}`);
        if (out) this.state.terminal.history.push(out);
        this.state.terminal.history = this.state.terminal.history.slice(-120);
        win.data.input = '';
        this.playSound(command === 'clear' ? 'close' : 'type');
        this.saveState();
        this.render();
    }

    executeCommand(command) {
        const [cmd, ...parts] = command.split(/\s+/);
        const rest = parts.join(' ');
        const cwd = this.state.terminal.cwd;
        if (cmd === 'help') return 'Commands: help, dir, ls, cd, pwd, clear, echo, date, time, systeminfo, ipconfig, ping, open, shutdown, reboot';
        if (cmd === 'clear') {
            this.state.terminal.history = [];
            return '';
        }
        if (cmd === 'pwd') return cwd;
        if (cmd === 'dir' || cmd === 'ls') return this.fsChildren(cwd).map((entry) => `${entry.item.type.padEnd(6)} ${baseName(entry.path)}`).join('\n') || '(empty)';
        if (cmd === 'cd') {
            const target = this.resolveTerminalPath(rest || '/');
            if (this.state.fs[target]?.type === 'folder') {
                this.state.terminal.cwd = target;
                return target;
            }
            return 'Folder not found.';
        }
        if (cmd === 'echo') return rest;
        if (cmd === 'date') return new Date().toDateString();
        if (cmd === 'time') return new Date().toLocaleTimeString();
        if (cmd === 'systeminfo') return `OS: Windows 12\nUser: ${this.state.os.user.name}\nFiles: ${Object.keys(this.state.fs).length}\nNetwork: ${this.state.machine.network ? 'online' : 'offline'}`;
        if (cmd === 'ipconfig') return this.state.machine.network ? 'NovaNet adapter: 192.168.12.24' : 'Network adapter disabled.';
        if (cmd === 'ping') return this.state.machine.network ? `Pinging ${rest || 'nova.local'}: reply in 2 ms` : 'Ping failed. Network disabled.';
        if (cmd === 'open') {
            this.openApp(rest || 'files');
            return `Opening ${rest || 'files'}.`;
        }
        if (cmd === 'shutdown') {
            this.powerOff();
            return 'Shutting down.';
        }
        if (cmd === 'reboot') {
            this.reboot();
            return 'Restarting.';
        }
        return `Unknown command: ${cmd}`;
    }

    resolveTerminalPath(input) {
        if (!input || input === '.') return this.state.terminal.cwd;
        if (input === '..') return parentPath(this.state.terminal.cwd);
        if (input.startsWith('/')) return input;
        return joinPath(this.state.terminal.cwd, input);
    }

    ensureMines(win) {
        if (win.data.mines) return;
        const size = 8;
        const mines = 10;
        const cells = Array.from({ length: size * size }, () => ({ mine: false, open: false, flag: false, count: 0 }));
        const picks = new Set();
        while (picks.size < mines) picks.add(Math.floor(Math.random() * cells.length));
        for (const index of picks) cells[index].mine = true;
        for (let i = 0; i < cells.length; i++) {
            if (cells[i].mine) continue;
            const x = i % size;
            const y = Math.floor(i / size);
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && ny >= 0 && nx < size && ny < size && cells[ny * size + nx].mine) count += 1;
                }
            }
            cells[i].count = count;
        }
        win.data.mines = { size, mines, cells, status: 'Reveal safe tiles.' };
    }

    clickMine(id, index, event) {
        const win = this.windowById(id);
        if (!win) return;
        this.ensureMines(win);
        const game = win.data.mines;
        const cell = game.cells[index];
        if (!cell || game.status.startsWith('Game')) return;
        if (event.altKey || event.button === 2) {
            cell.flag = !cell.flag;
            this.playSound('toggle');
        } else if (!cell.flag) {
            this.revealMineCell(game, index);
            this.playSound(cell.mine ? 'error' : 'click');
        }
        const safeClosed = game.cells.filter((item) => !item.mine && !item.open).length;
        if (safeClosed === 0) {
            game.status = 'Game won.';
            this.playSound('save');
        }
        this.render();
    }

    revealMineCell(game, index) {
        const cell = game.cells[index];
        if (!cell || cell.open || cell.flag) return;
        cell.open = true;
        if (cell.mine) {
            game.status = 'Game over.';
            for (const item of game.cells) item.open = true;
            return;
        }
        if (cell.count === 0) {
            const x = index % game.size;
            const y = Math.floor(index / game.size);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && ny >= 0 && nx < game.size && ny < game.size) {
                        this.revealMineCell(game, ny * game.size + nx);
                    }
                }
            }
        }
    }

    resetMines(id) {
        const win = this.windowById(id);
        if (!win) return;
        delete win.data.mines;
        this.ensureMines(win);
        this.playSound('install');
        this.render();
    }

    ensureSnake(win) {
        if (win.data.snake) return;
        win.data.snake = {
            size: 14,
            snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }],
            dir: { x: 1, y: 0 },
            nextDir: { x: 1, y: 0 },
            food: { x: 10, y: 8 },
            score: 0,
            running: false,
            status: 'Press Start, then use arrow keys.'
        };
    }

    toggleSnake(id) {
        const win = this.windowById(id);
        if (!win) return;
        this.ensureSnake(win);
        win.data.snake.running = !win.data.snake.running;
        win.data.snake.status = win.data.snake.running ? 'Running.' : 'Paused.';
        this.focusWindow(id, false);
        this.playSound(win.data.snake.running ? 'open' : 'close');
        this.render();
    }

    resetSnake(id) {
        const win = this.windowById(id);
        if (!win) return;
        delete win.data.snake;
        this.ensureSnake(win);
        this.playSound('install');
        this.render();
    }

    setSnakeDir(win, key) {
        this.ensureSnake(win);
        const dirs = {
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 }
        };
        const next = dirs[key];
        const game = win.data.snake;
        if (next && !(next.x === -game.dir.x && next.y === -game.dir.y)) {
            game.nextDir = next;
            this.playSound('click');
        }
    }

    tickSnakeWindows() {
        let changed = false;
        for (const win of this.windows) {
            if (win.app !== 'snake') continue;
            this.ensureSnake(win);
            const game = win.data.snake;
            if (!game.running) continue;
            game.dir = game.nextDir;
            const head = game.snake[0];
            const next = {
                x: (head.x + game.dir.x + game.size) % game.size,
                y: (head.y + game.dir.y + game.size) % game.size
            };
            if (game.snake.some((part) => part.x === next.x && part.y === next.y)) {
                game.running = false;
                game.status = 'Crashed. Reset to play again.';
                this.playSound('error');
                changed = true;
                continue;
            }
            game.snake.unshift(next);
            if (next.x === game.food.x && next.y === game.food.y) {
                game.score += 1;
                this.playSound('save');
                do {
                    game.food = { x: Math.floor(Math.random() * game.size), y: Math.floor(Math.random() * game.size) };
                } while (game.snake.some((part) => part.x === game.food.x && part.y === game.food.y));
            } else {
                game.snake.pop();
            }
            changed = true;
        }
        return changed;
    }

    renderPreview() {
        const ctx = this.previewCanvas.getContext('2d');
        const w = this.previewCanvas.width;
        const h = this.previewCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#020308';
        ctx.fillRect(0, 0, w, h);

        if (!this.state.machine.monitor || !this.state.machine.video) {
            ctx.fillStyle = '#101215';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#7b8898';
            ctx.font = 'bold 52px sans-serif';
            ctx.fillText('NO SIGNAL', 360, 290);
            this.finishPreviewRender();
            return;
        }

        if (!this.state.machine.powered || this.state.machine.phase === 'off') {
            ctx.fillStyle = '#05060a';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#151a24';
            ctx.fillRect(410, 230, 204, 94);
            ctx.strokeStyle = '#4cc9ff';
            ctx.strokeRect(410, 230, 204, 94);
            ctx.fillStyle = '#4cc9ff';
            ctx.font = 'bold 34px sans-serif';
            ctx.fillText('PC OFF', 455, 288);
            this.finishPreviewRender();
            return;
        }

        if (this.state.machine.phase === 'boot') {
            this.drawWallpaper(ctx, w, h, 'aurora');
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 64px sans-serif';
            ctx.fillText('Windows 12', 335, 260);
            ctx.strokeStyle = this.state.os.accent;
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(512, 330, 34, Date.now() / 350, Date.now() / 350 + 4.4);
            ctx.stroke();
        } else if (this.state.machine.phase === 'bootMenu' || this.state.machine.phase === 'firmware') {
            this.drawWallpaper(ctx, w, h, 'grid');
            ctx.fillStyle = 'rgba(7,12,20,0.88)';
            ctx.fillRect(250, 110, 524, 340);
            ctx.strokeStyle = '#4cc9ff';
            ctx.strokeRect(250, 110, 524, 340);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 42px sans-serif';
            ctx.fillText(this.state.machine.phase === 'firmware' ? 'Firmware Setup' : 'Boot Manager', 308, 180);
            ctx.font = '28px sans-serif';
            ctx.fillText(this.state.os.installed ? 'Internal Drive: Windows 12' : 'Internal Drive: empty', 308, 250);
            ctx.fillText('USB Installer ready', 308, 305);
            ctx.fillText('Reset and hardware tools available', 308, 360);
        } else if (this.state.machine.phase === 'installer') {
            this.drawWallpaper(ctx, w, h, 'circuit');
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(292, 132, 440, 312);
            ctx.fillStyle = '#101522';
            ctx.font = 'bold 42px sans-serif';
            ctx.fillText('Windows 12 Setup', 340, 210);
            ctx.font = '26px sans-serif';
            ctx.fillText(this.install.step === 'progress' ? `${Math.round(this.install.progress)}% installing` : 'USB installer', 340, 270);
            ctx.fillStyle = '#d8e2f0';
            ctx.fillRect(340, 320, 344, 24);
            ctx.fillStyle = this.state.os.accent;
            ctx.fillRect(340, 320, 344 * (this.install.progress / 100 || 0.2), 24);
        } else if (this.state.machine.phase === 'login') {
            this.drawWallpaper(ctx, w, h, this.state.os.wallpaper);
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 54px sans-serif';
            ctx.fillText(this.state.os.user.name, 420, 280);
            ctx.font = '26px sans-serif';
            ctx.fillText('Sign in to Windows 12', 398, 330);
        } else if (this.state.machine.phase === 'desktop') {
            this.drawWallpaper(ctx, w, h, this.state.os.wallpaper);
            ctx.fillStyle = 'rgba(5,8,14,0.9)';
            ctx.fillRect(0, h - 58, w, 58);
            ctx.fillStyle = this.state.os.accent;
            ctx.fillRect(24, h - 43, 42, 28);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px sans-serif';
            ctx.fillText('12', 34, h - 23);
            let x = 90;
            for (const app of APP_DEFS.filter((item) => item.pinned).slice(0, 6)) {
                ctx.fillStyle = 'rgba(255,255,255,0.14)';
                ctx.fillRect(x, h - 45, 36, 34);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(app.icon, x + 7, h - 23);
                x += 48;
            }
            for (const win of this.windows.filter((item) => !item.min).slice(0, 3)) {
                ctx.fillStyle = 'rgba(14,20,34,0.88)';
                ctx.fillRect(win.x * 0.75 + 40, win.y * 0.75 + 20, win.w * 0.75, win.h * 0.75);
                ctx.fillStyle = this.state.os.accent;
                ctx.fillRect(win.x * 0.75 + 40, win.y * 0.75 + 20, win.w * 0.75, 24);
                ctx.fillStyle = '#ffffff';
                ctx.font = '18px sans-serif';
                ctx.fillText(win.title, win.x * 0.75 + 52, win.y * 0.75 + 40);
            }
        } else if (this.state.machine.phase === 'sleep') {
            ctx.fillStyle = '#020308';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#46566f';
            ctx.font = 'bold 40px sans-serif';
            ctx.fillText('Sleeping', 430, 292);
        }
        this.finishPreviewRender();
    }

    drawWallpaper(ctx, w, h, wallpaper) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (wallpaper === 'sunrise') {
            grad.addColorStop(0, '#f8c38b');
            grad.addColorStop(0.45, '#d47093');
            grad.addColorStop(1, '#1a2f68');
        } else if (wallpaper === 'circuit') {
            grad.addColorStop(0, '#06131f');
            grad.addColorStop(0.5, '#10284d');
            grad.addColorStop(1, '#210b38');
        } else if (wallpaper === 'grid') {
            grad.addColorStop(0, '#08111e');
            grad.addColorStop(0.5, '#111827');
            grad.addColorStop(1, '#050810');
        } else {
            grad.addColorStop(0, '#0d1028');
            grad.addColorStop(0.45, '#243b76');
            grad.addColorStop(1, '#3b0d54');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 2;
        for (let x = -w; x < w * 2; x += 80) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + w * 0.45, h);
            ctx.stroke();
        }
        ctx.fillStyle = this.state.os.accent;
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.ellipse(w * 0.78, h * 0.22, w * 0.24, h * 0.18, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}
