import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const config = window.KINGDOM_FIREBASE_CONFIG || window.VEIL_FIREBASE_CONFIG;
const notice = document.getElementById('notice');
const say = (text) => { notice.textContent = text; };
const validConfig = config?.apiKey && !String(config.apiKey).includes('PASTE_');
let auth = null;
let db = null;

const desktopSettings = await window.kingdomDesktop.getSettings();
document.getElementById('startup').checked = desktopSettings.startup;
document.getElementById('chatUrl').value = desktopSettings.chatUrl || '';
document.getElementById('status').value = localStorage.getItem('kingdom.status') || 'offline';
document.getElementById('message').value = localStorage.getItem('kingdom.message') || '';
document.getElementById('contactUid').value = localStorage.getItem('kingdom.contactUid') || '';
await window.kingdomDesktop.setStatusMode(document.getElementById('status').value);

document.getElementById('startup').addEventListener('change', async (event) => {
  event.target.checked = await window.kingdomDesktop.setStartup(event.target.checked);
  say(event.target.checked ? 'Startup enabled.' : 'Startup disabled.');
});
document.getElementById('saveChat').addEventListener('click', async () => {
  try { await window.kingdomDesktop.setChatUrl(document.getElementById('chatUrl').value); say('Encrypted chat URL saved. Open it once and join your room.'); }
  catch (error) { say(error.message); }
});
document.getElementById('openChat').addEventListener('click', () => window.kingdomDesktop.openChat());
document.getElementById('status').addEventListener('change', (event) => window.kingdomDesktop.setStatusMode(event.target.value));

if (!validConfig) {
  say('Copy firebase-config.sample.js to firebase-config.js and add your Firebase web configuration.');
} else {
  const firebaseApp = initializeApp(config);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, (user) => {
    document.getElementById('authCard').classList.toggle('hidden', Boolean(user));
    document.getElementById('presenceCard').classList.toggle('hidden', !user);
    if (user) document.getElementById('ownerEmail').textContent = user.email || user.uid;
  });
}

document.getElementById('signIn').addEventListener('click', async () => {
  if (!auth) return;
  try { await signInWithEmailAndPassword(auth, document.getElementById('email').value.trim(), document.getElementById('password').value); document.getElementById('password').value = ''; say('Owner authenticated.'); }
  catch (error) { say(`Sign-in failed: ${error.message}`); }
});
document.getElementById('signOut').addEventListener('click', () => auth && signOut(auth));
document.getElementById('publish').addEventListener('click', async () => {
  if (!auth?.currentUser || !db) return;
  const status = document.getElementById('status').value;
  const message = document.getElementById('message').value.trim().slice(0, 120);
  const contactUid = document.getElementById('contactUid').value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  try {
    await window.kingdomDesktop.setStatusMode(status);
    localStorage.setItem('kingdom.status', status);
    localStorage.setItem('kingdom.message', message);
    localStorage.setItem('kingdom.contactUid', contactUid);
    await setDoc(doc(db, 'kingdom', 'presence'), { status, message, contactUid, heartbeatAt: serverTimestamp(), heartbeatMs: Date.now() }, { merge: true });
    say(`Throne status published: ${status}.`);
  } catch (error) { say(`Publish blocked: ${error.message}`); }
});

setInterval(async () => {
  if (!auth?.currentUser || !db) return;
  const status = document.getElementById('status').value;
  const message = document.getElementById('message').value.trim().slice(0, 120);
  const contactUid = document.getElementById('contactUid').value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  try { await setDoc(doc(db, 'kingdom', 'presence'), { status, message, contactUid, heartbeatAt: serverTimestamp(), heartbeatMs: Date.now() }, { merge: true }); } catch {}
}, 60000);
