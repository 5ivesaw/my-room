import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const appRoot = document.getElementById('app');
const CONFIG = window.VEIL_FIREBASE_CONFIG || null;
const LS_NAME = 'veil.displayName.v1';
const LS_LAST_ROOM = 'veil.lastRoom.v1';

let firebaseApp = null;
let auth = null;
let db = null;
let user = null;
let room = null;
let roomSecret = '';
let cryptoKey = null;
let unsubMessages = null;
let unsubMembers = null;
let sending = false;
let selectedTtlHours = 24;

const state = {
  status: 'setup',
  displayName: localStorage.getItem(LS_NAME) || `Friend-${Math.floor(100 + Math.random() * 900)}`,
  members: [],
  messages: []
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function sha256Base64(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64(new Uint8Array(hash));
}

async function deriveRoomKey(secret, saltBase64) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltBase64),
      iterations: 210000,
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    text,
    name: state.displayName,
    sentAt: Date.now()
  }));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, payload);
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptMessage(docData) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(docData.iv) },
      cryptoKey,
      base64ToBytes(docData.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return {
      text: '[Could not decrypt — wrong room secret or corrupted message]',
      name: 'Locked',
      sentAt: Date.now(),
      locked: true
    };
  }
}

function hasFirebaseConfig() {
  return CONFIG && CONFIG.apiKey && CONFIG.projectId && CONFIG.appId;
}

function setStatus(status, detail = '') {
  state.status = status;
  render(detail);
}

async function initFirebase() {
  if (!hasFirebaseConfig()) {
    renderSetup();
    return;
  }

  try {
    firebaseApp = initializeApp(CONFIG);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);

    onAuthStateChanged(auth, async (nextUser) => {
      user = nextUser;
      if (user) {
        state.status = 'ready';
        render();
      }
    });

    await signInAnonymously(auth);
  } catch (error) {
    renderSetup(`Firebase failed: ${error.message}`);
  }
}

function roomPath(id) {
  return doc(db, 'rooms', id);
}

function memberPath(id, uid = user.uid) {
  return doc(db, 'rooms', id, 'members', uid);
}

function messagesPath(id) {
  return collection(db, 'rooms', id, 'messages');
}

function cleanRoomId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function newRoomId() {
  const left = Math.random().toString(36).slice(2, 6);
  const right = Math.random().toString(36).slice(2, 6);
  return `room-${left}-${right}`;
}

async function joinRoom(id, secret, label = '') {
  if (!user) return;
  const cleanId = cleanRoomId(id);
  const cleanSecret = String(secret || '').trim();
  if (!cleanId || cleanSecret.length < 8) {
    toast('Room ID and 8+ character secret required.');
    return;
  }

  setStatus('joining');
  const snap = await getDoc(roomPath(cleanId));
  if (!snap.exists()) {
    setStatus('ready');
    toast('Room not found. Create it first or check the invite.');
    return;
  }

  const roomData = snap.data();
  const inviteHash = await sha256Base64(`${cleanId}:${cleanSecret}`);
  if (inviteHash !== roomData.inviteHash) {
    setStatus('ready');
    toast('Wrong room secret.');
    return;
  }

  roomSecret = cleanSecret;
  cryptoKey = await deriveRoomKey(roomSecret, roomData.salt);
  room = { id: cleanId, ...roomData, label: label || cleanId };
  localStorage.setItem(LS_LAST_ROOM, cleanId);

  await setDoc(memberPath(cleanId), {
    uid: user.uid,
    displayName: state.displayName,
    inviteHash,
    joinedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  }, { merge: true });

  subscribeRoom();
  setStatus('chat');
}

async function createRoom(label, secret) {
  if (!user) return;
  const id = newRoomId();
  const cleanSecret = String(secret || '').trim();
  if (cleanSecret.length < 8) {
    toast('Use a room secret with at least 8 characters.');
    return;
  }

  setStatus('creating');
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const inviteHash = await sha256Base64(`${id}:${cleanSecret}`);
  await setDoc(roomPath(id), {
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    label: String(label || 'Private Room').slice(0, 44),
    salt,
    inviteHash,
    ttlHours: selectedTtlHours
  });

  await joinRoom(id, cleanSecret, label);
}

function subscribeRoom() {
  if (!room) return;
  if (unsubMessages) unsubMessages();
  if (unsubMembers) unsubMembers();

  unsubMembers = onSnapshot(collection(db, 'rooms', room.id, 'members'), (snapshot) => {
    state.members = snapshot.docs.map((entry) => entry.data()).slice(0, 24);
    if (state.status === 'chat') render();
  });

  const q = query(messagesPath(room.id), orderBy('createdAt', 'asc'), limit(80));
  unsubMessages = onSnapshot(q, async (snapshot) => {
    const decrypted = [];
    for (const entry of snapshot.docs) {
      const data = entry.data();
      const body = await decryptMessage(data);
      decrypted.push({ id: entry.id, senderId: data.senderId, createdAt: data.createdAt, ...body });
    }
    state.messages = decrypted;
    if (state.status === 'chat') render();
    queueMicrotask(scrollChatBottom);
  }, (error) => {
    toast(`Messages blocked: ${error.message}`);
  });
}

async function sendMessage(text) {
  if (!room || !cryptoKey || sending) return;
  const clean = String(text || '').trim();
  if (!clean) return;
  sending = true;
  try {
    const encrypted = await encryptText(clean.slice(0, 1800));
    const expiresAt = Date.now() + Math.max(1, Number(room.ttlHours || selectedTtlHours || 24)) * 60 * 60 * 1000;
    await addDoc(messagesPath(room.id), {
      senderId: user.uid,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      type: 'text',
      createdAt: serverTimestamp(),
      expiresAt
    });
  } finally {
    sending = false;
  }
}

async function deleteOwnMessage(messageId, senderId) {
  if (!room || senderId !== user.uid) return;
  await deleteDoc(doc(db, 'rooms', room.id, 'messages', messageId));
}

function leaveRoom() {
  if (unsubMessages) unsubMessages();
  if (unsubMembers) unsubMembers();
  unsubMessages = null;
  unsubMembers = null;
  room = null;
  roomSecret = '';
  cryptoKey = null;
  state.messages = [];
  state.members = [];
  setStatus('ready');
}

function toast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function renderSetup(error = '') {
  appRoot.innerHTML = `
    <section class="setup-screen">
      <div class="setup-card">
        <div class="veil-mark">VC</div>
        <h1>Veil Chat setup needed</h1>
        <p>This app is installed, but Firebase is not connected yet. Create <code>veil-chat/firebase-config.js</code> from the sample file and paste your Firebase Web App config.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <ol>
          <li>Create a Firebase project.</li>
          <li>Enable Anonymous Authentication.</li>
          <li>Create a Cloud Firestore database.</li>
          <li>Publish the included Firestore rules.</li>
          <li>Copy <code>firebase-config.sample.js</code> to <code>firebase-config.js</code>.</li>
        </ol>
      </div>
    </section>
  `;
}

function render(detail = '') {
  if (!hasFirebaseConfig()) return renderSetup(detail);
  if (state.status === 'chat') return renderChat();

  const lastRoom = localStorage.getItem(LS_LAST_ROOM) || '';
  appRoot.innerHTML = `
    <section class="home-screen">
      <aside class="brand-panel">
        <div class="veil-mark">VC</div>
        <h1>Veil Chat</h1>
        <p>Private friend rooms. Firebase stores encrypted blobs; the browser decrypts locally with the room secret.</p>
        <div class="trust-grid">
          <span>Anonymous login</span>
          <span>AES-GCM messages</span>
          <span>No media storage</span>
          <span>Mobile ready</span>
        </div>
      </aside>

      <section class="room-panel">
        <label>Display name
          <input id="displayName" maxlength="24" value="${escapeHtml(state.displayName)}">
        </label>

        <div class="split">
          <form id="createRoomForm" class="glass-form">
            <h2>Create room</h2>
            <label>Room name
              <input name="label" maxlength="44" placeholder="Friday Squad">
            </label>
            <label>Secret / invite password
              <input name="secret" type="password" minlength="8" placeholder="8+ characters">
            </label>
            <label>Auto-delete hint
              <select name="ttl">
                <option value="1">1 hour</option>
                <option value="24" selected>24 hours</option>
                <option value="168">7 days</option>
              </select>
            </label>
            <button type="submit">Create encrypted room</button>
          </form>

          <form id="joinRoomForm" class="glass-form">
            <h2>Join room</h2>
            <label>Room ID
              <input name="roomId" value="${escapeHtml(lastRoom)}" placeholder="room-ab12-cd34">
            </label>
            <label>Secret
              <input name="secret" type="password" minlength="8" placeholder="same secret your friend gives you">
            </label>
            <button type="submit">Join securely</button>
          </form>
        </div>

        <p class="fine-print">Do not share exact home addresses unless needed. For meetups, use public places and disappearing messages.</p>
      </section>
    </section>
  `;

  document.getElementById('displayName')?.addEventListener('input', (event) => {
    state.displayName = event.target.value.trim().slice(0, 24) || 'Friend';
    localStorage.setItem(LS_NAME, state.displayName);
  });

  document.getElementById('createRoomForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    selectedTtlHours = Number(data.get('ttl') || 24);
    await createRoom(data.get('label'), data.get('secret'));
  });

  document.getElementById('joinRoomForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await joinRoom(data.get('roomId'), data.get('secret'));
  });
}

function renderChat() {
  const inviteText = `${room.id}  +  your secret`;
  const memberNames = state.members.map((member) => escapeHtml(member.displayName || 'Friend')).join(', ') || 'Only you';
  appRoot.innerHTML = `
    <section class="chat-shell">
      <header class="chat-topbar">
        <div>
          <strong>${escapeHtml(room.label || room.id)}</strong>
          <span>${escapeHtml(room.id)}</span>
        </div>
        <div class="top-actions">
          <button id="copyInvite" type="button">Copy room ID</button>
          <button id="leaveRoom" type="button">Leave</button>
        </div>
      </header>

      <aside class="member-strip">
        <span>Online room members</span>
        <strong>${memberNames}</strong>
      </aside>

      <section id="messageList" class="message-list">
        ${state.messages.length ? state.messages.map((message) => `
          <article class="bubble ${message.senderId === user.uid ? 'mine' : ''} ${message.locked ? 'locked' : ''}">
            <div class="bubble-meta">
              <strong>${escapeHtml(message.name || 'Friend')}</strong>
              ${message.senderId === user.uid ? `<button data-delete="${message.id}">Delete</button>` : ''}
            </div>
            <p>${linkify(escapeHtml(message.text || ''))}</p>
          </article>
        `).join('') : `<div class="empty-state">No messages yet. Send the first encrypted message.</div>`}
      </section>

      <form id="composer" class="composer">
        <textarea name="message" rows="1" maxlength="1800" placeholder="Type encrypted message..."></textarea>
        <button type="submit">Send</button>
      </form>
    </section>
  `;

  document.getElementById('leaveRoom')?.addEventListener('click', leaveRoom);
  document.getElementById('copyInvite')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(inviteText);
    toast('Copied room ID. Send the secret separately.');
  });

  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const msg = state.messages.find((item) => item.id === button.dataset.delete);
      deleteOwnMessage(button.dataset.delete, msg?.senderId);
    });
  });

  document.getElementById('composer')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const area = event.currentTarget.elements.message;
    const value = area.value;
    area.value = '';
    await sendMessage(value);
  });

  const area = document.querySelector('.composer textarea');
  area?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const value = area.value;
      area.value = '';
      await sendMessage(value);
    }
  });

  scrollChatBottom();
}

function linkify(safeHtml) {
  return safeHtml.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function scrollChatBottom() {
  const list = document.getElementById('messageList');
  if (list) list.scrollTop = list.scrollHeight;
}

window.addEventListener('beforeunload', () => {
  if (unsubMessages) unsubMessages();
  if (unsubMembers) unsubMembers();
});

initFirebase();
