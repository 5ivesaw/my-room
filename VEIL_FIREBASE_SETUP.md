# Veil Chat Firebase Setup

This folder adds a private encrypted chat app inside the in-room PC. It can also be opened directly at:

`https://5ivesaw.github.io/my-room/veil-chat/`

## What stays public

These are okay in GitHub:

- `veil-chat/index.html`
- `veil-chat/app.js`
- `veil-chat/styles.css`
- `veil-chat/firebase-config.js`
- Firebase Web App config values such as `apiKey`, `authDomain`, `projectId`, and `appId`

These are NOT okay in GitHub:

- Firebase service account private keys
- Google Cloud admin keys
- room secrets/passwords
- real plaintext chat exports
- real addresses/meetup plans outside encrypted messages

## Step 1: Create Firebase project

1. Go to Firebase Console.
2. Create a new project.
3. Keep it on the Spark/no-cost plan for now.
4. Do not add billing unless you understand quotas and costs.

## Step 2: Add a Web App

1. Project Overview -> Add app -> Web.
2. Name it `Veil Chat`.
3. Copy the config object Firebase gives you.

## Step 3: Add config file

Copy:

`veil-chat/firebase-config.sample.js`

to:

`veil-chat/firebase-config.js`

Then paste your real config:

```js
window.VEIL_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  appId: "1:123:web:abc"
};
```

## Step 4: Enable Anonymous Auth

1. Firebase Console -> Authentication.
2. Get started.
3. Sign-in method.
4. Enable Anonymous.

This lets every friend get a different hidden UID without email/password.

## Step 5: Create Firestore

1. Firebase Console -> Firestore Database.
2. Create database.
3. Start in production mode.
4. Pick the closest region you can.

## Step 6: Publish Security Rules

Open the included root file:

`firestore.rules`

Copy it into:

Firestore Database -> Rules

Then Publish.

## Step 7: Deploy to GitHub Pages

```bat
git status
git add index.html main.js world.js pc-os.js pc-os.css veil-chat firestore.rules VEIL_FIREBASE_SETUP.md
git commit -m "Add encrypted Veil Chat PC app"
git push origin main
```

Then open:

`https://5ivesaw.github.io/my-room/?v=54`

or directly:

`https://5ivesaw.github.io/my-room/veil-chat/`

## How to use with friends

1. Open the room website.
2. Sit at the PC.
3. Open `Veil Chat`.
4. Pick a display name.
5. Create a room.
6. Use a strong secret with 8+ characters.
7. Copy the room ID.
8. Send friends the room ID and the secret through different messages if possible.
9. Everyone joins with the same room ID + secret.

The database stores encrypted blobs. The room secret is what decrypts messages in the browser.

## Important limitations

- This v1 is text-only.
- No image/video storage on purpose.
- If someone screenshots, the web app cannot stop that.
- If someone leaks the room secret, they can join.
- If someone loses the room secret, old messages cannot be decrypted.
- The app includes `expiresAt`, but automatic deletion needs Firestore TTL configured separately or manual cleanup later.

## Recommended rules for real-life meetups

- Do not post exact home addresses unless needed.
- Prefer public meetup spots.
- Delete sensitive messages after plans are done.
- Change room secret if someone leaves the friend group.

## v56 rich-message notes

Veil Chat v56 adds emoji/GIF panels, YouTube embeds, reply/copy actions, and encrypted inline attachments. Because this project is designed to stay on Firebase Spark without Cloud Storage, attachments are intentionally small and are encrypted into the message document itself.

Recommended use:

- Text, emojis, GIF-style stickers, and YouTube links: normal use.
- Pasted images/files: keep them small. The app compresses pasted images before encrypting them.
- Videos and large media: not recommended for the free Firestore-only version.

After replacing v56 files, publish the updated `firestore.rules` file in Firebase Console. The message ciphertext limit was raised to allow small encrypted attachments.

## v57 Friends and DMs

Veil now supports contact links, friend requests, and direct messages without asking people to manually create a group or type a room ID.

How it works:

1. Each browser creates an anonymous Firebase user.
2. Veil creates a local RSA-OAEP key pair for that browser.
3. The public key is saved in `users/{uid}`.
4. The private key stays in that browser's local storage.
5. When a friend request is accepted, Veil creates a DM room and encrypts that DM key separately for both users.
6. Messages are still encrypted with AES-GCM before Firestore sees them.

Important limitations:

- A different browser/device is a different anonymous account.
- If a user clears browser data, their private DM key is lost and they need a new friend request.
- For real account portability later, add email login or passkey login.
- Publish the updated `firestore.rules` after replacing the v57 files.

Friend flow:

1. Open Veil Chat.
2. Click **Copy my contact link**.
3. Send that one website link to a friend.
4. Friend opens it and clicks **Send request**.
5. You accept the request inside Veil.
6. The DM appears under **Direct messages**.
