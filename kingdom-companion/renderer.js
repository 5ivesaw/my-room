import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const config = window.KINGDOM_FIREBASE_CONFIG || window.VEIL_FIREBASE_CONFIG;
const $ = (id) => document.getElementById(id);
const validConfig = config?.apiKey && config?.projectId && config?.appId && !String(config.apiKey).includes('PASTE_');
const ONLINE_WINDOW_MS = 90_000;
const MAX_REPLY_MS = 86_400_000;

const els = {
  notice: $('notice'), authCard: $('authCard'), workspace: $('workspace'),
  email: $('email'), password: $('password'), signIn: $('signIn'), signOut: $('signOut'),
  ownerEmail: $('ownerEmail'), presenceDot: $('presenceDot'),
  status: $('status'), message: $('message'), contactUid: $('contactUid'), publish: $('publish'),
  threadList: $('threadList'), threadCount: $('threadCount'),
  conversationTitle: $('conversationTitle'), conversationMeta: $('conversationMeta'),
  conversationMessages: $('conversationMessages'), copyActiveCode: $('copyActiveCode'),
  replyForm: $('replyForm'), replyText: $('replyText'), replyTtl: $('replyTtl'), sendReply: $('sendReply'),
  onlineUsers: $('onlineUsers'), onlineCount: $('onlineCount'), userSearch: $('userSearch'),
  chatUrl: $('chatUrl'), saveChat: $('saveChat'), openChat: $('openChat'), startup: $('startup')
};

let auth = null;
let db = null;
let currentUser = null;
let audienceMessages = [];
let publicUsers = [];
let activeUid = '';
let outgoingMessages = [];
let stopAudience = null;
let stopUsers = null;
let stopOutgoing = null;
let firstAudienceSnapshot = true;
let refreshTimer = null;

const say = (text = '') => { els.notice.textContent = text; };
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const cleanUid = (value = '') => String(value).trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
const cleanName = (value = '', uid = '') => {
  const cleaned = String(value).replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (cleaned.length >= 2) return cleaned;
  const suffix = cleanUid(uid).slice(0, 4).toUpperCase() || '0000';
  return `Friend-${suffix}`;
};
const shortCode = (uid = '') => uid ? `${uid.slice(0, 6)}…${uid.slice(-5)}` : 'No code';
const initials = (name = 'F') => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2) || 'F';
const formatTime = (ms) => Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'just now';
const relativeTime = (ms) => {
  const difference = Math.max(0, Date.now() - Number(ms || 0));
  if (difference < 60_000) return 'now';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h`;
  return `${Math.floor(difference / 86_400_000)}d`;
};
const safeMedia = (attachment) => {
  if (!attachment?.dataUrl || !attachment?.type) return '';
  const type = String(attachment.type).toLowerCase();
  const url = String(attachment.dataUrl);
  if (type.startsWith('image/') && /^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return `<img src="${url}" alt="Audience attachment">`;
  if (type.startsWith('audio/') && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(url)) return `<audio controls src="${url}"></audio>`;
  if (type.startsWith('video/') && /^data:video\/[a-z0-9.+-]+;base64,/i.test(url)) return `<video controls src="${url}"></video>`;
  return '';
};

const desktopSettings = await window.kingdomDesktop.getSettings();
els.startup.checked = Boolean(desktopSettings.startup);
els.chatUrl.value = desktopSettings.chatUrl || '';
els.status.value = localStorage.getItem('kingdom.status') || 'offline';
els.message.value = localStorage.getItem('kingdom.message') || '';
els.contactUid.value = localStorage.getItem('kingdom.contactUid') || '';
await window.kingdomDesktop.setStatusMode(els.status.value);
updatePresenceDot();

els.startup.addEventListener('change', async (event) => {
  event.target.checked = await window.kingdomDesktop.setStartup(event.target.checked);
  say(event.target.checked ? 'Startup enabled.' : 'Startup disabled.');
});
els.saveChat.addEventListener('click', async () => {
  try {
    await window.kingdomDesktop.setChatUrl(els.chatUrl.value);
    say('Veil Chat URL saved.');
  } catch (error) {
    say(error.message);
  }
});
els.openChat.addEventListener('click', () => window.kingdomDesktop.openChat());
els.status.addEventListener('change', async () => {
  await window.kingdomDesktop.setStatusMode(els.status.value);
  updatePresenceDot();
});
els.userSearch.addEventListener('input', renderOnlineUsers);
els.copyActiveCode.addEventListener('click', copyActiveCode);

function updatePresenceDot() {
  els.presenceDot.className = currentUser ? els.status.value : '';
}

if (!validConfig) {
  say('Add the Firebase web configuration to kingdom-companion/firebase-config.js.');
} else {
  const firebaseApp = initializeApp(config);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, handleAuthChange);
}

async function handleAuthChange(user) {
  currentUser = user;
  els.authCard.classList.toggle('hidden', Boolean(user));
  els.workspace.classList.toggle('hidden', !user);
  els.ownerEmail.textContent = user?.email || 'Signed out';
  updatePresenceDot();
  stopAllListeners();
  if (!user) {
    audienceMessages = [];
    publicUsers = [];
    outgoingMessages = [];
    activeUid = '';
    return;
  }
  say('Owner authenticated. Loading the court…');
  startAudienceListener();
  startUsersListener();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    renderThreads();
    renderOnlineUsers();
    renderConversation();
  }, 10_000);
}

function stopAllListeners() {
  for (const stop of [stopAudience, stopUsers, stopOutgoing]) {
    if (typeof stop === 'function') stop();
  }
  stopAudience = stopUsers = stopOutgoing = null;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

function startAudienceListener() {
  const inboxQuery = query(
    collection(db, 'kingdom', 'audienceMessages', 'items'),
    orderBy('createdMs', 'desc'),
    limit(250)
  );
  firstAudienceSnapshot = true;
  stopAudience = onSnapshot(inboxQuery, (snapshot) => {
    audienceMessages = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    if (!firstAudienceSnapshot) {
      const newest = snapshot.docChanges().find((change) => change.type === 'added')?.doc?.data();
      if (newest) window.kingdomDesktop.notifyAudience(`${cleanName(newest.displayName, newest.senderUid)}: ${newest.text || 'New petition'}`);
    }
    firstAudienceSnapshot = false;
    renderThreads();
    renderConversation();
    say('Court data synchronized.');
  }, (error) => say(`Audience inbox blocked: ${error.message}`));
}

function startUsersListener() {
  const usersQuery = query(collection(db, 'users'), orderBy('lastSeenMs', 'desc'), limit(250));
  stopUsers = onSnapshot(usersQuery, (snapshot) => {
    publicUsers = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    renderOnlineUsers();
    renderThreads();
    renderConversation();
  }, (error) => say(`Online-user list blocked: ${error.message}`));
}

function buildThreads() {
  const groups = new Map();
  for (const message of audienceMessages) {
    const uid = cleanUid(message.senderUid || message.publicCode);
    if (!uid) continue;
    if (!groups.has(uid)) groups.set(uid, { uid, messages: [] });
    groups.get(uid).messages.push(message);
  }
  return [...groups.values()]
    .map((thread) => {
      thread.messages.sort((a, b) => Number(a.createdMs || 0) - Number(b.createdMs || 0));
      thread.latest = thread.messages.at(-1);
      const profile = publicUsers.find((candidate) => candidate.uid === thread.uid || candidate.id === thread.uid);
      thread.name = cleanName(profile?.displayName || thread.latest?.displayName, thread.uid);
      thread.avatar = profile?.avatar || '';
      return thread;
    })
    .sort((a, b) => Number(b.latest?.createdMs || 0) - Number(a.latest?.createdMs || 0));
}

function renderThreads() {
  const threads = buildThreads();
  els.threadCount.textContent = String(threads.length);
  if (!threads.length) {
    els.threadList.innerHTML = '<p class="empty-state">No audience petitions yet.</p>';
    return;
  }
  els.threadList.innerHTML = threads.map((thread) => {
    const preview = String(thread.latest?.text || '').replace(/^My Lord,\s*/i, '').slice(0, 58);
    return `<button type="button" class="thread-button ${thread.uid === activeUid ? 'active' : ''}" data-thread-uid="${escapeHtml(thread.uid)}">
      <span class="avatar">${escapeHtml(initials(thread.name))}</span>
      <span class="thread-copy"><strong>${escapeHtml(thread.name)}</strong><span>${escapeHtml(preview)}</span></span>
      <time class="thread-time">${escapeHtml(relativeTime(thread.latest?.createdMs))}</time>
    </button>`;
  }).join('');
  els.threadList.querySelectorAll('[data-thread-uid]').forEach((button) => {
    button.addEventListener('click', () => selectUser(button.dataset.threadUid));
  });
}

function onlineProfiles() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const search = els.userSearch.value.trim().toLowerCase();
  return publicUsers
    .filter((profile) => profile.uid !== currentUser?.uid && Number(profile.lastSeenMs || 0) >= cutoff)
    .filter((profile) => {
      if (!search) return true;
      return `${profile.displayName || ''} ${profile.publicCode || profile.uid || profile.id || ''}`.toLowerCase().includes(search);
    })
    .sort((a, b) => Number(b.lastSeenMs || 0) - Number(a.lastSeenMs || 0));
}

function renderOnlineUsers() {
  const users = onlineProfiles();
  els.onlineCount.textContent = String(users.length);
  if (!users.length) {
    els.onlineUsers.innerHTML = '<p class="empty-state">No recently active visitors match this search.</p>';
    return;
  }
  els.onlineUsers.innerHTML = users.map((profile) => {
    const uid = cleanUid(profile.uid || profile.publicCode || profile.id);
    const name = cleanName(profile.displayName, uid);
    return `<button type="button" class="user-button ${uid === activeUid ? 'active' : ''}" data-user-uid="${escapeHtml(uid)}">
      <span class="avatar">${escapeHtml(initials(name))}</span>
      <span class="user-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(shortCode(uid))}</span></span>
      <i class="online-dot" aria-label="Online"></i>
    </button>`;
  }).join('');
  els.onlineUsers.querySelectorAll('[data-user-uid]').forEach((button) => {
    button.addEventListener('click', () => selectUser(button.dataset.userUid));
  });
}

function selectUser(uid) {
  const nextUid = cleanUid(uid);
  if (!nextUid || nextUid === activeUid) return;
  activeUid = nextUid;
  outgoingMessages = [];
  if (stopOutgoing) stopOutgoing();
  const outgoingQuery = query(
    collection(db, 'users', activeUid, 'lordMessages'),
    orderBy('createdMs', 'asc'),
    limit(100)
  );
  stopOutgoing = onSnapshot(outgoingQuery, (snapshot) => {
    const now = Date.now();
    outgoingMessages = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    for (const message of outgoingMessages) {
      if (Number(message.expiresMs || 0) <= now && currentUser) {
        deleteDoc(doc(db, 'users', activeUid, 'lordMessages', message.id)).catch(() => {});
      }
    }
    renderConversation();
  }, (error) => say(`Royal Mail thread blocked: ${error.message}`));
  renderThreads();
  renderOnlineUsers();
  renderConversation();
}

function activeProfile() {
  return publicUsers.find((profile) => (profile.uid || profile.publicCode || profile.id) === activeUid) || null;
}

function activePetitions() {
  return audienceMessages.filter((message) => cleanUid(message.senderUid || message.publicCode) === activeUid);
}

function renderConversation() {
  const enabled = Boolean(activeUid && currentUser);
  els.replyText.disabled = !enabled;
  els.replyTtl.disabled = !enabled;
  els.sendReply.disabled = !enabled;
  els.copyActiveCode.disabled = !enabled;
  if (!enabled) return;

  const profile = activeProfile();
  const petitions = activePetitions();
  const latestPetition = petitions.slice().sort((a, b) => Number(b.createdMs || 0) - Number(a.createdMs || 0))[0];
  const name = cleanName(profile?.displayName || latestPetition?.displayName, activeUid);
  const online = Number(profile?.lastSeenMs || 0) >= Date.now() - ONLINE_WINDOW_MS;
  els.conversationTitle.textContent = name;
  els.conversationMeta.textContent = `${online ? 'Online now' : 'Not currently online'} · ${shortCode(activeUid)} · ${petitions.length} petition${petitions.length === 1 ? '' : 's'}`;

  const now = Date.now();
  const timeline = [
    ...petitions.map((message) => ({ ...message, direction: 'incoming', sortMs: Number(message.createdMs || 0) })),
    ...outgoingMessages
      .filter((message) => Number(message.expiresMs || 0) > now)
      .map((message) => ({ ...message, direction: 'outgoing', sortMs: Number(message.createdMs || 0) }))
  ].sort((a, b) => a.sortMs - b.sortMs);

  if (!timeline.length) {
    els.conversationMessages.innerHTML = '<div class="conversation-placeholder"><span>♜</span><h3>No messages yet</h3><p>Send Royal Mail to begin this temporary audience.</p></div>';
    return;
  }
  els.conversationMessages.innerHTML = timeline.map((entry) => {
    const outgoing = entry.direction === 'outgoing';
    const expiry = outgoing ? `<span class="expiry">expires ${relativeExpiry(entry.expiresMs)}</span>` : '';
    return `<div class="bubble-row ${outgoing ? 'outgoing' : 'incoming'}">
      <article class="message-bubble">
        <div class="meta"><span>${outgoing ? 'Sovereign' : escapeHtml(name)} · ${escapeHtml(formatTime(entry.createdMs))}</span>${expiry}</div>
        <p>${escapeHtml(entry.text || '')}</p>
        ${outgoing ? '' : safeMedia(entry.attachment)}
      </article>
    </div>`;
  }).join('');
  els.conversationMessages.scrollTop = els.conversationMessages.scrollHeight;
}

function relativeExpiry(expiresMs) {
  const remaining = Math.max(0, Number(expiresMs || 0) - Date.now());
  if (remaining < 60_000) return `in ${Math.ceil(remaining / 1000)}s`;
  if (remaining < 3_600_000) return `in ${Math.ceil(remaining / 60_000)}m`;
  return `in ${Math.ceil(remaining / 3_600_000)}h`;
}

async function copyActiveCode() {
  if (!activeUid) return;
  try {
    await navigator.clipboard.writeText(activeUid);
    say('Permanent Veil code copied.');
  } catch {
    say(activeUid);
  }
}

els.signIn.addEventListener('click', async () => {
  if (!auth) return;
  try {
    await signInWithEmailAndPassword(auth, els.email.value.trim(), els.password.value);
    els.password.value = '';
    say('Owner authenticated.');
  } catch (error) {
    say(`Sign-in failed: ${error.message}`);
  }
});
els.password.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') els.signIn.click();
});
els.signOut.addEventListener('click', () => auth && signOut(auth));

els.publish.addEventListener('click', publishPresence);
async function publishPresence() {
  if (!currentUser || !db) return;
  const status = ['online','busy','sleeping','offline'].includes(els.status.value) ? els.status.value : 'offline';
  const message = els.message.value.trim().slice(0, 120);
  const contactUid = cleanUid(els.contactUid.value);
  try {
    await window.kingdomDesktop.setStatusMode(status);
    localStorage.setItem('kingdom.status', status);
    localStorage.setItem('kingdom.message', message);
    localStorage.setItem('kingdom.contactUid', contactUid);
    await setDoc(doc(db, 'kingdom', 'presence'), {
      status, message, contactUid, heartbeatAt: serverTimestamp(), heartbeatMs: Date.now()
    }, { merge: true });
    updatePresenceDot();
    say(`Throne status published: ${status}.`);
  } catch (error) {
    say(`Publish blocked: ${error.message}`);
  }
}

els.replyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUser || !db || !activeUid) return;
  const text = els.replyText.value.trim().slice(0, 500);
  if (!text) return;
  const requestedTtl = Number(els.replyTtl.value || 900_000);
  const ttl = Math.min(MAX_REPLY_MS, Math.max(60_000, requestedTtl));
  const createdMs = Date.now();
  const expiresMs = createdMs + ttl;
  const contactUid = cleanUid(els.contactUid.value);
  els.sendReply.disabled = true;
  try {
    await addDoc(collection(db, 'users', activeUid, 'lordMessages'), {
      recipientUid: activeUid,
      senderUid: currentUser.uid,
      text,
      contactUid,
      createdMs,
      expiresMs,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresMs)
    });
    els.replyText.value = '';
    say(`Royal Mail sent to ${cleanName(activeProfile()?.displayName, activeUid)}.`);
  } catch (error) {
    say(`Message blocked: ${error.message}`);
  } finally {
    els.sendReply.disabled = false;
  }
});

setInterval(() => {
  if (!currentUser || !db) return;
  const status = ['online','busy','sleeping','offline'].includes(els.status.value) ? els.status.value : 'offline';
  const message = els.message.value.trim().slice(0, 120);
  const contactUid = cleanUid(els.contactUid.value);
  setDoc(doc(db, 'kingdom', 'presence'), {
    status, message, contactUid, heartbeatAt: serverTimestamp(), heartbeatMs: Date.now()
  }, { merge: true }).catch(() => {});
}, 60_000);
