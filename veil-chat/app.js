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
const LS_AVATAR = 'veil.avatar.v1';
const LS_SOUND = 'veil.sound.v1';
const LS_BROWSER_NOTICES = 'veil.browserNotices.v1';
const LS_PRIVATE_KEY = 'veil.privateKey.v1';
const LS_PUBLIC_KEY = 'veil.publicKey.v1';
const AVATAR_COLORS = ['#101626', '#7c5cff', '#25d0ff', '#50f2a0', '#ffcb6b', '#ff4d6d', '#ffffff', '#ff8bd2'];
const MAX_ATTACHMENT_BYTES = 380 * 1024;
const MAX_ENCRYPTED_TEXT = 1600;
const SEND_COOLDOWN_MS = 4000;
const SENDS_PER_MINUTE = 6;
const AUDIENCE_MODE = new URLSearchParams(location.search).get('audience') === '1';
const EMOJI_SET = ['😀','😂','😭','🔥','💀','❤️','👍','🙏','👀','😳','😎','🤝','✨','🎉','💯','😈','😴','🤯','😤','🥶','🙄','😐','😔','🫡','🍕','☕','🎮','📍','⚠️','✅','❌','🔒'];
const GIF_PRESETS = [
  { id: 'party', label: 'Party', emoji: '🎉', caption: 'party time' },
  { id: 'skull', label: 'Dead', emoji: '💀', caption: 'I am dead' },
  { id: 'fire', label: 'Fire', emoji: '🔥', caption: 'that was fire' },
  { id: 'sus', label: 'Sus', emoji: '👀', caption: 'caught in 4k' },
  { id: 'bruh', label: 'Bruh', emoji: '😐', caption: 'bruh moment' },
  { id: 'lock', label: 'Secure', emoji: '🔒', caption: 'encrypted transmission' }
];

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
let seenMessageIds = new Set();
let firstMessageSnapshot = true;
let audioContext = null;
let selectedAvatarColor = 1;
let lastRenderHadComposerFocus = false;
let privateKey = null;
let publicKeyJwk = null;
let unsubFriendRequests = null;
let unsubFriends = null;
let recentSendTimes = [];
let activeRecorder = null;
let lastSystemNoticeAt = 0;
let suppressedSystemNotices = 0;

const state = {
  status: 'setup',
  displayName: localStorage.getItem(LS_NAME) || `Friend-${Math.floor(100 + Math.random() * 900)}`,
  avatar: normalizeAvatar(localStorage.getItem(LS_AVATAR) || randomAvatar()),
  soundEnabled: localStorage.getItem(LS_SOUND) !== 'off',
  browserNotices: localStorage.getItem(LS_BROWSER_NOTICES) === 'on',
  avatarEditorOpen: false,
  picker: null,
  draft: '',
  replyTo: null,
  members: [],
  messages: [],
  friendRequests: [],
  friends: [],
  friendInput: ''
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

function normalizeAvatar(value) {
  const clean = String(value || '').replace(/[^0-7]/g, '').slice(0, 64);
  return clean.padEnd(64, '0');
}

function randomAvatar() {
  const cells = Array.from({ length: 64 }, () => '0');
  const palette = [1, 2, 3, 4, 5, 7];
  const pick = palette[Math.floor(Math.random() * palette.length)];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const value = Math.random() > 0.46 ? String(pick) : (Math.random() > 0.78 ? '6' : '0');
      cells[y * 8 + x] = value;
      cells[y * 8 + (7 - x)] = value;
    }
  }
  return cells.join('');
}

function saveAvatar(value) {
  state.avatar = normalizeAvatar(value);
  localStorage.setItem(LS_AVATAR, state.avatar);
  syncMemberProfile().catch(() => {});
  syncPublicProfile().catch(() => {});
}

function renderAvatar(code = state.avatar, className = '') {
  const cells = normalizeAvatar(code).split('');
  return `<span class="avatar-grid ${className}" aria-hidden="true">${cells.map((item, index) => `<i data-avatar-cell="${index}" style="--c:${AVATAR_COLORS[Number(item)] || AVATAR_COLORS[0]}"></i>`).join('')}</span>`;
}

function memberByUid(uid) {
  return state.members.find((member) => member.uid === uid) || null;
}

function avatarForMessage(message) {
  return memberByUid(message.senderId)?.avatar || message.avatar || state.avatar;
}

function nameForMessage(message) {
  return memberByUid(message.senderId)?.displayName || message.name || 'Friend';
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

async function ensureIdentityKeys() {
  const savedPrivate = localStorage.getItem(LS_PRIVATE_KEY);
  const savedPublic = localStorage.getItem(LS_PUBLIC_KEY);
  if (savedPrivate && savedPublic) {
    privateKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(savedPrivate),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
    publicKeyJwk = JSON.parse(savedPublic);
    return;
  }

  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );
  privateKey = pair.privateKey;
  publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  localStorage.setItem(LS_PRIVATE_KEY, JSON.stringify(privateJwk));
  localStorage.setItem(LS_PUBLIC_KEY, JSON.stringify(publicKeyJwk));
}

async function importFriendPublicKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

async function encryptDmSecretFor(publicJwk, secretBase64) {
  const key = await importFriendPublicKey(publicJwk);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(secretBase64)
  );
  return bytesToBase64(new Uint8Array(encrypted));
}

async function decryptDmSecret(encryptedSecret) {
  if (!privateKey) throw new Error('This browser lost its private contact key. Re-add this device as a friend.');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBytes(encryptedSecret)
  );
  return new TextDecoder().decode(decrypted);
}

async function importDmAesKey(secretBase64) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(secretBase64),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function safeUid(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

function dmRoomIdFor(a, b) {
  return `dm-${[safeUid(a), safeUid(b)].sort().join('-')}`;
}

function userPath(uid = user?.uid) {
  return doc(db, 'users', uid);
}

function friendRequestPath(targetUid, fromUid = user?.uid) {
  return doc(db, 'users', targetUid, 'requests', fromUid);
}

function friendPath(ownerUid, friendUid) {
  return doc(db, 'users', ownerUid, 'friends', friendUid);
}

function dmKeyPath(roomId, uid = user?.uid) {
  return doc(db, 'rooms', roomId, 'keys', uid);
}

async function encryptPayload(payloadData = {}) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    text: String(payloadData.text || ''),
    name: state.displayName,
    avatar: state.avatar,
    sentAt: Date.now(),
    reply: payloadData.reply || null,
    attachment: payloadData.attachment || null,
    gif: payloadData.gif || null
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

function safeFileName(name = 'file') {
  return String(name || 'file').replace(/[\/:*?"<>|]/g, '_').slice(0, 80) || 'file';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.readAsDataURL(file);
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image.'));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function compressImageFile(file) {
  if (file.type === 'image/gif' && file.size <= MAX_ATTACHMENT_BYTES) {
    return {
      kind: 'image',
      name: safeFileName(file.name || 'image.gif'),
      mime: file.type,
      size: file.size,
      data: await fileToBase64(file)
    };
  }

  const img = await readImage(file);
  const maxSide = 960;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#07101b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let blob = null;
  for (const quality of [0.78, 0.66, 0.54, 0.44]) {
    blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= MAX_ATTACHMENT_BYTES) break;
  }
  if (!blob || blob.size > MAX_ATTACHMENT_BYTES) throw new Error('Image is too large even after compression. Try a smaller image.');
  return {
    kind: 'image',
    name: safeFileName((file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'),
    mime: 'image/jpeg',
    size: blob.size,
    data: await fileToBase64(blob)
  };
}

async function fileToAttachment(file) {
  if (!file) return null;
  if (file.type.startsWith('image/')) return compressImageFile(file);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`File too large. Max ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB because this free version stores encrypted attachments inside Firestore messages.`);
  return {
    kind: file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'file',
    name: safeFileName(file.name || 'attachment.bin'),
    mime: file.type || 'application/octet-stream',
    size: file.size,
    data: await fileToBase64(file)
  };
}

async function sendAttachment(file, caption = '') {
  if (!file) return;
  try {
    toast('Encrypting attachment...');
    const attachment = await fileToAttachment(file);
    await sendMessage(caption, { attachment });
  } catch (error) {
    toast(`Attachment failed: ${error.message}`);
  }
}

function youtubeIdFromUrl(url) {
  const value = String(url || '');
  const match = value.match(/(?:youtube\.com\/(?:watch\?[^\s#]*v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : '';
}

function urlsFromText(text = '') {
  return Array.from(String(text).matchAll(/https?:\/\/[^\s<]+/g)).map((match) => match[0]);
}

function renderEmbeds(text = '') {
  const urls = urlsFromText(text).slice(0, 3);
  const cards = [];
  const seenYoutube = new Set();
  for (const url of urls) {
    const youtubeId = youtubeIdFromUrl(url);
    if (youtubeId && !seenYoutube.has(youtubeId)) {
      seenYoutube.add(youtubeId);
      cards.push(`<figure class="embed-card youtube-card"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/${youtubeId}" title="YouTube preview" allow="accelerometer; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe><figcaption>YouTube preview</figcaption></figure>`);
      continue;
    }
    if (/\.(png|jpe?g|gif|webp)(\?[^\s]*)?$/i.test(url)) {
      cards.push(`<figure class="embed-card image-link-card"><img loading="lazy" src="${escapeHtml(url)}" alt="Linked image preview"><figcaption>Image link</figcaption></figure>`);
    }
  }
  return cards.join('');
}

function renderAttachment(attachment) {
  if (!attachment || !attachment.data) return '';
  const name = escapeHtml(attachment.name || 'attachment');
  const mime = escapeHtml(attachment.mime || 'application/octet-stream');
  const dataUrl = `data:${mime};base64,${attachment.data}`;
  const size = attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : '';
  if (attachment.kind === 'image') {
    return `<figure class="attachment-card image-attachment"><img src="${dataUrl}" alt="${name}" loading="lazy"><figcaption><span>${name}</span><a href="${dataUrl}" download="${name}">Save</a></figcaption></figure>`;
  }
  if (attachment.kind === 'audio') {
    return `<figure class="attachment-card media-attachment"><audio controls preload="metadata" src="${dataUrl}"></audio><figcaption>${name} · ${size}</figcaption></figure>`;
  }
  if (attachment.kind === 'video') {
    return `<figure class="attachment-card media-attachment"><video controls playsinline preload="metadata" src="${dataUrl}"></video><figcaption>${name} · ${size}</figcaption></figure>`;
  }
  return `<a class="attachment-card file-attachment" href="${dataUrl}" download="${name}"><b>Attachment</b><span>${name}</span><em>${size}</em></a>`;
}

function renderGif(gif) {
  if (!gif) return '';
  const safeId = String(gif.id || 'party').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  return `<figure class="gif-message gif-${safeId}"><b>${escapeHtml(gif.emoji || '✨')}</b><figcaption>${escapeHtml(gif.caption || gif.label || 'GIF')}</figcaption></figure>`;
}

function renderReply(reply) {
  if (!reply) return '';
  return `<blockquote class="reply-card"><strong>${escapeHtml(reply.name || 'Friend')}</strong><span>${escapeHtml(String(reply.text || '').slice(0, 140))}</span></blockquote>`;
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
        await ensureIdentityKeys();
        await syncPublicProfile();
        subscribeSocial();
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

async function syncMemberProfile() {
  if (!room || !user) return;
  await setDoc(memberPath(room.id), {
    uid: user.uid,
    displayName: state.displayName,
    avatar: state.avatar,
    lastSeenAt: serverTimestamp()
  }, { merge: true });
}

async function syncPublicProfile() {
  if (!user || !publicKeyJwk) return;
  await setDoc(userPath(user.uid), {
    uid: user.uid,
    displayName: state.displayName,
    avatar: state.avatar,
    publicKey: publicKeyJwk,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function subscribeSocial() {
  if (!user || !db) return;
  if (unsubFriendRequests) unsubFriendRequests();
  if (unsubFriends) unsubFriends();

  unsubFriendRequests = onSnapshot(collection(db, 'users', user.uid, 'requests'), (snapshot) => {
    state.friendRequests = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    if (state.status !== 'chat') render();
  }, (error) => toast(`Friend requests blocked: ${error.message}`));

  unsubFriends = onSnapshot(collection(db, 'users', user.uid, 'friends'), (snapshot) => {
    state.friends = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    if (state.status !== 'chat') render();
  }, (error) => toast(`Friends blocked: ${error.message}`));
}

async function sendFriendRequest(targetValue) {
  if (!user) return;
  const targetUid = extractFriendUid(targetValue);
  if (!targetUid || targetUid === user.uid) {
    toast('Paste a friend link or code from another person.');
    return;
  }

  try {
    await syncPublicProfile();
    const target = await getDoc(userPath(targetUid));
    if (!target.exists()) {
      toast('Friend code not found. Ask them to open Veil Chat once first.');
      return;
    }
    await setDoc(friendRequestPath(targetUid, user.uid), {
      fromUid: user.uid,
      displayName: state.displayName,
      avatar: state.avatar,
      createdAt: serverTimestamp()
    });
    toast('Friend request sent inside Veil.');
  } catch (error) {
    toast(`Friend request failed: ${error.message}`);
  }
}

async function acceptFriendRequest(fromUid) {
  if (!user) return;
  try {
    await syncPublicProfile();
    const [fromSnap, meSnap] = await Promise.all([getDoc(userPath(fromUid)), getDoc(userPath(user.uid))]);
    if (!fromSnap.exists() || !meSnap.exists()) {
      toast('Could not load friend profile.');
      return;
    }

    const fromData = fromSnap.data();
    const meData = meSnap.data();
    const dmRoomId = dmRoomIdFor(user.uid, fromUid);
    const secretBase64 = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    const [secretForMe, secretForFriend] = await Promise.all([
      encryptDmSecretFor(meData.publicKey, secretBase64),
      encryptDmSecretFor(fromData.publicKey, secretBase64)
    ]);

    await setDoc(roomPath(dmRoomId), {
      mode: 'dm',
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      label: `DM: ${state.displayName} / ${fromData.displayName || 'Friend'}`,
      ttlHours: 168
    }, { merge: true });

    await Promise.all([
      setDoc(dmKeyPath(dmRoomId, user.uid), { uid: user.uid, encryptedSecret: secretForMe, createdAt: serverTimestamp() }),
      setDoc(dmKeyPath(dmRoomId, fromUid), { uid: fromUid, encryptedSecret: secretForFriend, createdAt: serverTimestamp() }),
      setDoc(memberPath(dmRoomId, user.uid), { uid: user.uid, displayName: state.displayName, avatar: state.avatar, joinedAt: serverTimestamp(), lastSeenAt: serverTimestamp() }, { merge: true }),
      setDoc(memberPath(dmRoomId, fromUid), { uid: fromUid, displayName: fromData.displayName || 'Friend', avatar: fromData.avatar || randomAvatar(), joinedAt: serverTimestamp(), lastSeenAt: serverTimestamp() }, { merge: true }),
      setDoc(friendPath(user.uid, fromUid), { uid: fromUid, displayName: fromData.displayName || 'Friend', avatar: fromData.avatar || '', dmRoomId, createdAt: serverTimestamp() }, { merge: true }),
      setDoc(friendPath(fromUid, user.uid), { uid: user.uid, displayName: state.displayName, avatar: state.avatar, dmRoomId, createdAt: serverTimestamp() }, { merge: true }),
      deleteDoc(friendRequestPath(user.uid, fromUid))
    ]);
    toast('Friend added. DM is ready.');
    await openDmRoom({ uid: fromUid, displayName: fromData.displayName || 'Friend', avatar: fromData.avatar || '', dmRoomId });
  } catch (error) {
    toast(`Accept failed: ${error.message}`);
  }
}

async function openDmRoom(friend) {
  if (!user || !friend?.dmRoomId) return;
  setStatus('joining');
  try {
    const keySnap = await getDoc(dmKeyPath(friend.dmRoomId, user.uid));
    if (!keySnap.exists()) throw new Error('DM key missing. Send/accept a new friend request.');
    const secretBase64 = await decryptDmSecret(keySnap.data().encryptedSecret);
    cryptoKey = await importDmAesKey(secretBase64);
    roomSecret = '[automatic-dm-key]';
    room = { id: friend.dmRoomId, label: friend.displayName || 'Direct Message', ttlHours: 168, mode: 'dm' };
    localStorage.setItem(LS_LAST_ROOM, room.id);
    await syncMemberProfile();
    subscribeRoom();
    setStatus('chat');
    requestAnimationFrame(focusComposer);
  } catch (error) {
    setStatus('ready');
    toast(`Open DM failed: ${error.message}`);
  }
}

async function removeFriend(friendUid) {
  if (!user) return;
  try {
    await deleteDoc(friendPath(user.uid, friendUid));
    toast('Friend removed from this device.');
  } catch (error) {
    toast(`Remove failed: ${error.message}`);
  }
}

function extractFriendUid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const paramMatch = raw.match(/[?&]friend=([^&#]+)/i);
  if (paramMatch) return safeUid(decodeURIComponent(paramMatch[1]));
  try {
    const url = new URL(raw);
    return safeUid(url.searchParams.get('friend') || raw);
  } catch {
    return safeUid(raw.replace(/^veil:/i, ''));
  }
}

function myFriendLink() {
  return `${location.origin}${location.pathname}?friend=${encodeURIComponent(user?.uid || '')}`;
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
  try {
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
    room = { id: cleanId, ...roomData, label: label || roomData.label || cleanId };
    localStorage.setItem(LS_LAST_ROOM, cleanId);

    await setDoc(memberPath(cleanId), {
      uid: user.uid,
      displayName: state.displayName,
      avatar: state.avatar,
      inviteHash,
      joinedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp()
    }, { merge: true });

    subscribeRoom();
    setStatus('chat');
    requestAnimationFrame(focusComposer);
  } catch (error) {
    setStatus('ready');
    toast(`Join failed: ${error.message}`);
  }
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
  try {
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
  } catch (error) {
    setStatus('ready');
    toast(`Create failed: ${error.message}`);
  }
}

function subscribeRoom() {
  if (!room) return;
  if (unsubMessages) unsubMessages();
  if (unsubMembers) unsubMembers();
  seenMessageIds = new Set();
  firstMessageSnapshot = true;

  unsubMembers = onSnapshot(collection(db, 'rooms', room.id, 'members'), (snapshot) => {
    state.members = snapshot.docs.map((entry) => entry.data()).slice(0, 24);
    if (state.status === 'chat') render();
  });

  const q = query(messagesPath(room.id), orderBy('createdAt', 'asc'), limit(100));
  unsubMessages = onSnapshot(q, async (snapshot) => {
    const decrypted = [];
    const incoming = [];
    for (const entry of snapshot.docs) {
      const data = entry.data();
      const body = await decryptMessage(data);
      const item = { id: entry.id, senderId: data.senderId, createdAt: data.createdAt, expiresAt: data.expiresAt, ...body };
      decrypted.push(item);
      if (!firstMessageSnapshot && !seenMessageIds.has(item.id) && item.senderId !== user.uid) incoming.push(item);
    }

    state.messages = decrypted;
    for (const item of decrypted) seenMessageIds.add(item.id);
    firstMessageSnapshot = false;

    if (state.status === 'chat') render();
    queueMicrotask(scrollChatBottom);
    for (const item of incoming.slice(-3)) notifyIncoming(item);
  }, (error) => {
    toast(`Messages blocked: ${error.message}`);
  });
}

async function sendMessage(text, extras = {}) {
  if (!room || !cryptoKey || sending) return;
  let clean = String(text || '').trim();
  if (!clean && !extras.attachment && !extras.gif) return;
  const now = Date.now();
  recentSendTimes = recentSendTimes.filter((time) => now - time < 60000);
  const waitMs = recentSendTimes.length ? SEND_COOLDOWN_MS - (now - recentSendTimes.at(-1)) : 0;
  if (waitMs > 0) {
    toast(`The throne accepts one message every ${Math.ceil(SEND_COOLDOWN_MS / 1000)} seconds.`);
    return;
  }
  if (recentSendTimes.length >= SENDS_PER_MINUTE) {
    toast('Audience limit reached. Wait before addressing My Lord again.');
    return;
  }
  if (AUDIENCE_MODE && clean && !/^my lord\b[,:-]?/i.test(clean)) clean = `My Lord, ${clean}`;
  sending = true;
  try {
    const encrypted = await encryptPayload({
      text: clean.slice(0, MAX_ENCRYPTED_TEXT),
      reply: extras.reply || state.replyTo || null,
      attachment: extras.attachment || null,
      gif: extras.gif || null
    });
    const expiresAt = Date.now() + Math.max(1, Number(room.ttlHours || selectedTtlHours || 24)) * 60 * 60 * 1000;
    await addDoc(messagesPath(room.id), {
      senderId: user.uid,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      type: 'text',
      createdAt: serverTimestamp(),
      expiresAt
    });
    recentSendTimes.push(Date.now());
    state.replyTo = null;
    state.picker = null;
    playSendSound();
  } catch (error) {
    toast(`Send failed: ${error.message}`);
  } finally {
    sending = false;
  }
}

async function toggleVoiceRecording(button) {
  if (activeRecorder) {
    activeRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Voice recording is not supported in this browser.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    const chunks = [];
    const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
    activeRecorder = recorder;
    button.textContent = 'Stop voice';
    button.classList.add('recording');
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      activeRecorder = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        toast('Voice message was too large. Keep it under 15 seconds.');
      } else if (blob.size) {
        await sendAttachment(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }), AUDIENCE_MODE ? 'My Lord, a voice message.' : 'Voice message');
        renderChat();
      }
    }, { once: true });
    recorder.start(500);
    toast('Recording voice — maximum 15 seconds.');
    window.setTimeout(() => { if (activeRecorder === recorder && recorder.state === 'recording') recorder.stop(); }, 15000);
  } catch (error) {
    activeRecorder = null;
    toast(`Microphone unavailable: ${error.message}`);
  }
}

async function deleteOwnMessage(messageId, senderId) {
  if (!room || senderId !== user.uid) return;
  try {
    await deleteDoc(doc(db, 'rooms', room.id, 'messages', messageId));
  } catch (error) {
    toast(`Delete failed: ${error.message}`);
  }
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
  state.avatarEditorOpen = false;
  state.picker = null;
  state.replyTo = null;
  setStatus('ready');
}

function unlockAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
}

function blip(frequencies = [660], duration = 0.12, gainValue = 0.035) {
  if (!state.soundEnabled) return;
  try {
    unlockAudio();
    const now = audioContext.currentTime;
    frequencies.forEach((freq, index) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + index * 0.055);
      gain.gain.linearRampToValueAtTime(gainValue, now + index * 0.055 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.055 + duration);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now + index * 0.055);
      osc.stop(now + index * 0.055 + duration + 0.02);
    });
  } catch {}
}

function playSendSound() {
  blip([580, 780], 0.11, 0.025);
}

function playIncomingSound() {
  blip([880, 660, 990], 0.12, 0.03);
}

function ensureNoticeStack() {
  let stack = document.querySelector('.notice-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'notice-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function notifyIncoming(message) {
  playIncomingSound();
  const stack = ensureNoticeStack();
  const node = document.createElement('button');
  node.className = 'side-notice';
  node.type = 'button';
  node.innerHTML = `
    ${renderAvatar(avatarForMessage(message), 'mini')}
    <span><strong>${escapeHtml(nameForMessage(message))}</strong><em>${escapeHtml(String(message.text || '').slice(0, 90))}</em></span>
  `;
  node.addEventListener('click', () => {
    scrollChatBottom();
    focusComposer();
    node.remove();
  });
  stack.appendChild(node);
  setTimeout(() => node.remove(), 5200);

  if (state.browserNotices && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const now = Date.now();
    if (now - lastSystemNoticeAt < 5 * 60 * 1000) {
      suppressedSystemNotices++;
      return;
    }
    try {
      new Notification(`${nameForMessage(message)} in ${room?.label || 'Veil Chat'}`, {
        body: `${String(message.text || message.attachment?.name || 'New encrypted message').slice(0, 105)}${suppressedSystemNotices ? ` · ${suppressedSystemNotices} quieter messages` : ''}`,
        tag: `veil-${room?.id || 'room'}`
      });
      lastSystemNoticeAt = now;
      suppressedSystemNotices = 0;
    } catch {}
  }
}

async function requestBrowserNotices() {
  if (!('Notification' in window)) {
    toast('This browser does not support system notifications here.');
    return;
  }
  const result = await Notification.requestPermission();
  state.browserNotices = result === 'granted';
  localStorage.setItem(LS_BROWSER_NOTICES, state.browserNotices ? 'on' : 'off');
  toast(state.browserNotices ? 'System notifications enabled.' : 'System notifications not enabled.');
  render();
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

  const params = new URLSearchParams(location.search);
  const lastRoom = params.get('room') || localStorage.getItem(LS_LAST_ROOM) || '';
  const friendPrefill = params.get('friend') || state.friendInput || '';
  appRoot.innerHTML = `
    <section class="home-screen">
      <aside class="brand-panel">
        <div class="veil-mark">VC</div>
        <h1>Veil Chat</h1>
        <p>Private friend rooms. Firebase stores encrypted blobs; the browser decrypts locally with the room secret.</p>
        <div class="trust-grid">
          <span>Anonymous login</span>
          <span>AES-GCM messages</span>
          <span>Profile pixels</span>
          <span>Mobile ready</span>
          <span>Paste images/files</span>
          <span>YouTube embeds</span>
        </div>
      </aside>

      <section class="room-panel">
        <div class="profile-card">
          ${renderAvatar(state.avatar, 'profile')}
          <label>Display name
            <input id="displayName" maxlength="24" value="${escapeHtml(state.displayName)}">
          </label>
          <button id="toggleAvatarEditor" type="button">Draw avatar</button>
        </div>
        ${state.avatarEditorOpen ? renderAvatarEditor() : ''}

        <div class="quick-settings">
          <button id="soundToggle" type="button">Sound: ${state.soundEnabled ? 'On' : 'Off'}</button>
          <button id="browserNoticeToggle" type="button">System notifications: ${state.browserNotices ? 'On' : 'Off'}</button>
        </div>

        ${renderSocialPanel(friendPrefill)}

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

        <p class="fine-print">Tip: Ctrl/⌘ + K jumps to typing. Room secrets are never uploaded; they only unlock local decryption.</p>
      </section>
    </section>
  `;

  bindSharedControls();
  bindSocialControls();

  document.getElementById('createRoomForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    unlockAudio();
    const data = new FormData(event.currentTarget);
    selectedTtlHours = Number(data.get('ttl') || 24);
    await createRoom(data.get('label'), data.get('secret'));
  });

  document.getElementById('joinRoomForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    unlockAudio();
    const data = new FormData(event.currentTarget);
    await joinRoom(data.get('roomId'), data.get('secret'));
  });
}

function renderSocialPanel(friendPrefill = '') {
  const link = user ? myFriendLink() : '';
  const requests = state.friendRequests.length
    ? state.friendRequests.map((request) => `
        <article class="social-card request-card">
          ${renderAvatar(request.avatar || randomAvatar(), 'mini')}
          <div><strong>${escapeHtml(request.displayName || 'Friend')}</strong><span>wants to message you</span></div>
          <button type="button" data-accept-friend="${escapeHtml(request.fromUid || request.id)}">Accept</button>
          <button type="button" data-decline-friend="${escapeHtml(request.fromUid || request.id)}">Ignore</button>
        </article>
      `).join('')
    : '<p class="social-empty">No pending requests.</p>';

  const friends = state.friends.length
    ? state.friends.map((friend) => `
        <article class="social-card friend-card">
          ${renderAvatar(friend.avatar || randomAvatar(), 'mini')}
          <div><strong>${escapeHtml(friend.displayName || 'Friend')}</strong><span>Direct message ready</span></div>
          <button type="button" data-open-dm="${escapeHtml(friend.uid || friend.id)}">Message</button>
          <button type="button" data-remove-friend="${escapeHtml(friend.uid || friend.id)}">Remove</button>
        </article>
      `).join('')
    : '<p class="social-empty">No friends yet. Share your contact link or paste theirs.</p>';

  return `
    <section class="social-panel">
      <div class="social-head">
        <div>
          <h2>Friends & DMs</h2>
          <p>Share one link once, accept requests here, then message without room IDs or group setup.</p>
        </div>
        <button id="copyFriendLink" type="button">Copy my contact link</button>
      </div>
      <div class="contact-code"><span>My code</span><code>${escapeHtml(user?.uid || 'loading')}</code></div>
      <form id="friendRequestForm" class="friend-form">
        <input name="friendCode" value="${escapeHtml(friendPrefill)}" placeholder="Paste friend link or code">
        <button type="submit">Send request</button>
      </form>
      <div class="social-grid">
        <section><h3>Requests</h3>${requests}</section>
        <section><h3>Direct messages</h3>${friends}</section>
      </div>
    </section>
  `;
}

function renderAvatarEditor() {
  return `
    <section class="avatar-editor" aria-label="Avatar editor">
      <div class="avatar-toolbar">
        <strong>Draw profile pixels</strong>
        <span>Click cells to paint. Tiny, safe, and fast.</span>
      </div>
      <div class="palette-row">
        ${AVATAR_COLORS.map((color, index) => `<button type="button" class="palette-dot ${selectedAvatarColor === index ? 'active' : ''}" data-avatar-color="${index}" style="--c:${color}" aria-label="Avatar color ${index}"></button>`).join('')}
      </div>
      <div class="avatar-canvas" role="grid">
        ${normalizeAvatar(state.avatar).split('').map((item, index) => `<button type="button" data-paint-cell="${index}" style="--c:${AVATAR_COLORS[Number(item)] || AVATAR_COLORS[0]}"></button>`).join('')}
      </div>
      <div class="avatar-actions">
        <button type="button" id="randomAvatar">Random</button>
        <button type="button" id="clearAvatar">Clear</button>
        <button type="button" id="closeAvatarEditor">Done</button>
      </div>
    </section>
  `;
}

function renderChat() {
  const activeElement = document.activeElement;
  lastRenderHadComposerFocus = Boolean(activeElement && activeElement.closest?.('.composer'));
  const inviteLink = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.id)}`;
  const memberNames = state.members.map((member) => escapeHtml(member.displayName || 'Friend')).join(', ') || 'Only you';
  appRoot.innerHTML = `
    <section class="chat-shell ${state.picker ? 'has-picker' : ''} ${state.replyTo ? 'has-reply' : ''}">
      <header class="chat-topbar">
        <div class="room-title-wrap">
          ${renderAvatar(state.avatar, 'mini')}
          <div>
            <strong>${escapeHtml(room.label || room.id)}</strong>
            <span>${escapeHtml(room.id)}</span>
          </div>
        </div>
        <div class="top-actions">
          <button id="profileButton" type="button">Profile</button>
          <button id="copyInvite" type="button">Copy invite</button>
          <button id="leaveRoom" type="button">Leave</button>
        </div>
      </header>

      <aside class="member-strip">
        <span>Online room members</span>
        <strong>${memberNames}</strong>
      </aside>
      ${state.avatarEditorOpen ? renderAvatarEditor() : ''}

      <section id="messageList" class="message-list">
        ${state.messages.length ? state.messages.map((message) => `
          <article class="bubble-row ${message.senderId === user.uid ? 'mine' : ''}">
            ${message.senderId === user.uid ? '' : renderAvatar(avatarForMessage(message), 'mini')}
            <article class="bubble ${message.senderId === user.uid ? 'mine' : ''} ${message.locked ? 'locked' : ''}">
              <div class="bubble-meta">
                <strong>${escapeHtml(nameForMessage(message))}</strong>
                <button data-reply="${message.id}">Reply</button>
                ${message.text ? `<button data-copy="${message.id}">Copy</button>` : ''}
                ${message.senderId === user.uid ? `<button data-delete="${message.id}">Delete</button>` : ''}
              </div>
              ${renderReply(message.reply)}
              ${message.text ? `<p>${linkify(escapeHtml(message.text || ''))}</p>` : ''}
              ${renderEmbeds(message.text || '')}
              ${renderAttachment(message.attachment)}
              ${renderGif(message.gif)}
            </article>
            ${message.senderId === user.uid ? renderAvatar(avatarForMessage(message), 'mini') : ''}
          </article>
        `).join('') : `<div class="empty-state">No messages yet. Paste an image, drop a file, send a GIF, or type the first encrypted message.</div>`}
      </section>

      ${state.picker === 'emoji' ? renderEmojiPicker() : ''}
      ${state.picker === 'gif' ? renderGifPicker() : ''}

      <form id="composer" class="composer ${state.picker ? 'picker-open' : ''}">
        ${state.replyTo ? `<div class="composer-reply"><span>Replying to <b>${escapeHtml(state.replyTo.name || 'Friend')}</b>: ${escapeHtml(String(state.replyTo.text || '').slice(0, 80))}</span><button type="button" id="clearReply">×</button></div>` : ''}
        <div class="composer-tools">
          <button type="button" id="emojiButton" class="${state.picker === 'emoji' ? 'active' : ''}">Emoji</button>
          <button type="button" id="gifButton" class="${state.picker === 'gif' ? 'active' : ''}">GIF</button>
          <button type="button" id="attachButton">Attach</button>
          <button type="button" id="voiceButton">Voice</button>
          <span>${AUDIENCE_MODE ? 'Messages are automatically addressed to My Lord' : 'Paste screenshots, short videos/files, GIF URLs, or YouTube links'}</span>
        </div>
        <div class="composer-row">
          <textarea name="message" rows="1" maxlength="${MAX_ENCRYPTED_TEXT}" placeholder="${AUDIENCE_MODE ? 'Address My Lord…' : 'Type encrypted message, paste image, or drop a file…'}" autocomplete="off">${escapeHtml(state.draft)}</textarea>
          <button type="submit">Send</button>
        </div>
        <input id="fileInput" type="file" hidden>
      </form>
    </section>
  `;

  bindSharedControls();
  document.getElementById('profileButton')?.addEventListener('click', () => {
    state.avatarEditorOpen = !state.avatarEditorOpen;
    renderChat();
  });
  document.getElementById('leaveRoom')?.addEventListener('click', leaveRoom);
  document.getElementById('copyInvite')?.addEventListener('click', async () => {
    const text = `Veil room: ${room.id}\nLink: ${inviteLink}\nSecret: send separately`;
    await navigator.clipboard?.writeText(text);
    toast('Copied invite. Send the secret separately.');
  });

  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const msg = state.messages.find((item) => item.id === button.dataset.delete);
      deleteOwnMessage(button.dataset.delete, msg?.senderId);
    });
  });

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const msg = state.messages.find((item) => item.id === button.dataset.copy);
      await navigator.clipboard?.writeText(msg?.text || '');
      toast('Copied message.');
      focusComposer();
    });
  });

  document.querySelectorAll('[data-reply]').forEach((button) => {
    button.addEventListener('click', () => {
      const msg = state.messages.find((item) => item.id === button.dataset.reply);
      if (!msg) return;
      state.replyTo = { id: msg.id, name: nameForMessage(msg), text: msg.text || (msg.gif?.caption || msg.attachment?.name || 'attachment') };
      renderChat();
    });
  });

  const composer = document.getElementById('composer');
  const area = composer?.elements.message;
  const fileInput = document.getElementById('fileInput');

  document.getElementById('clearReply')?.addEventListener('click', () => {
    state.replyTo = null;
    renderChat();
  });

  document.getElementById('emojiButton')?.addEventListener('click', () => {
    state.draft = area?.value || state.draft;
    state.picker = state.picker === 'emoji' ? null : 'emoji';
    renderChat();
  });

  document.getElementById('gifButton')?.addEventListener('click', () => {
    state.draft = area?.value || state.draft;
    state.picker = state.picker === 'gif' ? null : 'gif';
    renderChat();
  });

  document.querySelectorAll('[data-picker-close]').forEach((button) => {
    button.addEventListener('click', () => {
      state.draft = area?.value || state.draft;
      state.picker = null;
      renderChat();
    });
  });

  document.getElementById('gifUrlForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.gifUrl;
    const url = String(input?.value || '').trim();
    if (!url) return;
    state.picker = null;
    await sendMessage(url);
    state.draft = area?.value || state.draft;
    renderChat();
  });

  document.getElementById('attachButton')?.addEventListener('click', () => fileInput?.click());
  document.getElementById('voiceButton')?.addEventListener('click', (event) => toggleVoiceRecording(event.currentTarget));
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    await sendAttachment(file, area?.value || '');
    if (area) area.value = '';
    state.draft = '';
    renderChat();
  });

  document.querySelectorAll('[data-emoji]').forEach((button) => {
    button.addEventListener('click', () => {
      insertAtCursor(area, button.dataset.emoji || '');
      state.draft = area?.value || state.draft;
      autoGrow(area);
      focusComposer();
    });
  });

  document.querySelectorAll('[data-gif]').forEach((button) => {
    button.addEventListener('click', async () => {
      const gif = GIF_PRESETS.find((item) => item.id === button.dataset.gif);
      if (!gif) return;
      await sendMessage('', { gif });
      renderChat();
    });
  });

  composer?.addEventListener('submit', async (event) => {
    event.preventDefault();
    unlockAudio();
    const value = area.value;
    area.value = '';
    state.draft = '';
    autoGrow(area);
    await sendMessage(value);
    area.focus({ preventScroll: true });
  });

  composer?.addEventListener('dragover', (event) => {
    event.preventDefault();
    composer.classList.add('drag-ready');
  });
  composer?.addEventListener('dragleave', () => composer.classList.remove('drag-ready'));
  composer?.addEventListener('drop', async (event) => {
    event.preventDefault();
    composer.classList.remove('drag-ready');
    const file = event.dataTransfer?.files?.[0];
    await sendAttachment(file, area?.value || '');
    if (area) area.value = '';
    state.draft = '';
    renderChat();
  });

  area?.addEventListener('paste', async (event) => {
    const file = Array.from(event.clipboardData?.files || [])[0];
    if (!file) return;
    event.preventDefault();
    await sendAttachment(file, area.value || '');
    area.value = '';
    state.draft = '';
    renderChat();
  });

  area?.addEventListener('input', () => {
    state.draft = area.value;
    autoGrow(area);
  });
  area?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const value = area.value;
      area.value = '';
      state.draft = '';
      autoGrow(area);
      await sendMessage(value);
      area.focus({ preventScroll: true });
    }
  });

  if (area) autoGrow(area);
  scrollChatBottom();
  if (lastRenderHadComposerFocus || window.innerWidth > 820) requestAnimationFrame(focusComposer);
}

function renderEmojiPicker() {
  return `<section class="picker-panel picker-window emoji-panel" aria-label="Emoji picker"><header><strong>Emoji</strong><button type="button" data-picker-close>Close</button></header><div class="emoji-grid">${EMOJI_SET.map((emoji) => `<button type="button" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`).join('')}</div></section>`;
}

function renderGifPicker() {
  return `<section class="picker-panel picker-window gif-panel" aria-label="GIF picker">
    <header><strong>GIFs / Stickers</strong><button type="button" data-picker-close>Close</button></header>
    <form id="gifUrlForm" class="gif-url-form">
      <input name="gifUrl" placeholder="Paste direct GIF/image URL or YouTube link" autocomplete="off">
      <button type="submit">Send link</button>
    </form>
    <div class="gif-grid">${GIF_PRESETS.map((gif) => `<button type="button" class="gif-tile gif-${gif.id}" data-gif="${gif.id}"><b>${escapeHtml(gif.emoji)}</b><span>${escapeHtml(gif.label)}</span></button>`).join('')}</div>
    <p class="gif-note">Tenor API search is no longer reliable for third-party apps; paste direct GIF links here.</p>
  </section>`;
}

function bindSocialControls() {
  document.getElementById('copyFriendLink')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(myFriendLink());
    toast('Copied your contact link. They can request you from inside Veil.');
  });

  document.getElementById('friendRequestForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('friendCode');
    state.friendInput = String(value || '');
    await sendFriendRequest(value);
  });

  document.querySelectorAll('[data-accept-friend]').forEach((button) => {
    button.addEventListener('click', () => acceptFriendRequest(button.dataset.acceptFriend));
  });

  document.querySelectorAll('[data-decline-friend]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await deleteDoc(friendRequestPath(user.uid, button.dataset.declineFriend));
        toast('Request ignored.');
      } catch (error) {
        toast(`Ignore failed: ${error.message}`);
      }
    });
  });

  document.querySelectorAll('[data-open-dm]').forEach((button) => {
    button.addEventListener('click', () => {
      const friend = state.friends.find((item) => (item.uid || item.id) === button.dataset.openDm);
      openDmRoom(friend);
    });
  });

  document.querySelectorAll('[data-remove-friend]').forEach((button) => {
    button.addEventListener('click', () => removeFriend(button.dataset.removeFriend));
  });
}

function bindSharedControls() {
  document.getElementById('displayName')?.addEventListener('input', (event) => {
    state.displayName = event.target.value.trim().slice(0, 24) || 'Friend';
    localStorage.setItem(LS_NAME, state.displayName);
    syncMemberProfile().catch(() => {});
    syncPublicProfile().catch(() => {});
  });
  document.getElementById('toggleAvatarEditor')?.addEventListener('click', () => {
    state.avatarEditorOpen = !state.avatarEditorOpen;
    render();
  });
  document.getElementById('closeAvatarEditor')?.addEventListener('click', () => {
    state.avatarEditorOpen = false;
    render();
  });
  document.getElementById('randomAvatar')?.addEventListener('click', () => {
    saveAvatar(randomAvatar());
    render();
  });
  document.getElementById('clearAvatar')?.addEventListener('click', () => {
    saveAvatar('0'.repeat(64));
    render();
  });
  document.querySelectorAll('[data-avatar-color]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedAvatarColor = Number(button.dataset.avatarColor || 0);
      render();
    });
  });
  document.querySelectorAll('[data-paint-cell]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.paintCell);
      const cells = normalizeAvatar(state.avatar).split('');
      cells[index] = String(selectedAvatarColor);
      saveAvatar(cells.join(''));
      render();
    });
  });
  document.getElementById('soundToggle')?.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem(LS_SOUND, state.soundEnabled ? 'on' : 'off');
    if (state.soundEnabled) blip([660, 880], 0.1, 0.03);
    render();
  });
  document.getElementById('browserNoticeToggle')?.addEventListener('click', requestBrowserNotices);
}

function insertAtCursor(area, text) {
  if (!area) return;
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? area.value.length;
  area.value = `${area.value.slice(0, start)}${text}${area.value.slice(end)}`;
  const next = start + text.length;
  area.setSelectionRange(next, next);
}

function autoGrow(area) {
  if (!area) return;
  area.style.height = 'auto';
  area.style.height = `${Math.min(132, Math.max(44, area.scrollHeight))}px`;
}

function focusComposer() {
  const area = document.querySelector('.composer textarea');
  if (!area) return;
  if (window.innerWidth <= 820 && !lastRenderHadComposerFocus) return;
  area.focus({ preventScroll: true });
}

function linkify(safeHtml) {
  return safeHtml.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function scrollChatBottom() {
  const list = document.getElementById('messageList');
  if (list) list.scrollTop = list.scrollHeight;
}

document.addEventListener('pointerdown', () => unlockAudio(), { once: true });
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    focusComposer();
  }
  if (event.key === 'Escape' && state.avatarEditorOpen) {
    state.avatarEditorOpen = false;
    render();
  }
});

window.addEventListener('beforeunload', () => {
  if (unsubMessages) unsubMessages();
  if (unsubMembers) unsubMembers();
});

initFirebase();
