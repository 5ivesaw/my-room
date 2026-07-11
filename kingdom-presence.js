import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const VALID_STATUSES = new Set(['online', 'busy', 'sleeping', 'offline']);
// The desktop companion refreshes every five seconds from Electron's main
// process. Explicit status changes arrive immediately; this timeout only handles
// crashes, forced termination, lost power, or network failure.
const STALE_AFTER_MS = 25_000;
const RECHECK_MS = 1_000;

function normalizePresence(data = {}) {
    const heartbeat = Math.max(
        data.heartbeatAt?.toMillis?.() || 0,
        Number(data.heartbeatMs) || 0
    );
    const stale = !heartbeat || Date.now() - heartbeat > STALE_AFTER_MS;
    const requestedStatus = VALID_STATUSES.has(data.status) ? data.status : 'offline';
    const status = stale ? 'offline' : requestedStatus;
    return {
        status,
        online: !stale && status !== 'offline',
        message: stale
            ? 'The sovereign is away from the throne.'
            : String(data.message || '').slice(0, 120),
        contactUid: String(data.contactUid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128),
        updatedAt: heartbeat
    };
}

export function startKingdomPresence(onChange) {
    const config = window.VEIL_FIREBASE_CONFIG;
    if (!config?.apiKey || String(config.apiKey).includes('PASTE_')) {
        onChange?.(normalizePresence());
        return () => {};
    }

    let cachedData = {};
    let lastSignature = '';
    let unsubscribe = () => {};

    const emit = () => {
        const presence = normalizePresence(cachedData);
        const signature = `${presence.status}|${presence.online}|${presence.message}|${presence.contactUid}|${presence.updatedAt}`;
        if (signature === lastSignature) return;
        lastSignature = signature;
        window.kingdomPresence = presence;
        window.dispatchEvent(new CustomEvent('kingdom-presence', { detail: presence }));
        onChange?.(presence);
    };

    try {
        const app = getApps()[0] || initializeApp(config);
        const db = getFirestore(app);
        unsubscribe = onSnapshot(doc(db, 'kingdom', 'presence'), (snapshot) => {
            cachedData = snapshot.exists() ? snapshot.data() : {};
            emit();
        }, (error) => {
            console.warn('Kingdom presence unavailable:', error.message);
            cachedData = {};
            emit();
        });
    } catch (error) {
        console.warn('Kingdom presence failed to initialize:', error.message);
        cachedData = {};
        emit();
    }

    // Firestore does not emit a new snapshot merely because an old heartbeat has
    // become stale, so re-evaluate the cached timestamp locally once per second.
    const staleTimer = window.setInterval(emit, RECHECK_MS);
    emit();

    return () => {
        window.clearInterval(staleTimer);
        unsubscribe?.();
    };
}
