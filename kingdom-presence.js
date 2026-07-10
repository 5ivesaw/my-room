import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const VALID_STATUSES = new Set(['online', 'busy', 'sleeping', 'offline']);
const STALE_AFTER_MS = 150000;

function normalizePresence(data = {}) {
    const heartbeat = data.heartbeatAt?.toMillis?.() || Number(data.heartbeatMs) || 0;
    const stale = !heartbeat || Date.now() - heartbeat > STALE_AFTER_MS;
    const status = VALID_STATUSES.has(data.status) ? data.status : 'offline';
    return {
        status: stale ? 'offline' : status,
        online: !stale && status !== 'offline',
        message: stale ? 'The sovereign is away from the throne.' : String(data.message || '').slice(0, 120),
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
    try {
        const app = getApps()[0] || initializeApp(config);
        const db = getFirestore(app);
        return onSnapshot(doc(db, 'kingdom', 'presence'), (snapshot) => {
            const presence = normalizePresence(snapshot.exists() ? snapshot.data() : {});
            window.kingdomPresence = presence;
            window.dispatchEvent(new CustomEvent('kingdom-presence', { detail: presence }));
            onChange?.(presence);
        }, (error) => {
            console.warn('Kingdom presence unavailable:', error.message);
            onChange?.(normalizePresence());
        });
    } catch (error) {
        console.warn('Kingdom presence failed to initialize:', error.message);
        onChange?.(normalizePresence());
        return () => {};
    }
}
