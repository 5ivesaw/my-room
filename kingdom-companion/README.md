# Kingdom Companion

Kingdom Companion is the owner's Windows tray application for My Kingdom. It publishes throne presence, groups audience petitions by visitor, lists recently active visitors, sends temporary Royal Mail, and opens the existing encrypted Veil Chat in a separate sandboxed Electron window.

The companion opens no listening ports and exposes no remote-control API. Its windows use context isolation, disabled Node.js integration, and sandboxed web content. Media and notification permissions are limited to the configured HTTPS Veil Chat origin.

## Firebase setup

1. In **Authentication → Sign-in method**, enable **Anonymous** for visitors and **Email/Password** for the owner.
2. Create the owner account under **Authentication → Users**.
3. In Firestore, create collection `kingdom`, document `config`, with a string field named `ownerUid` containing the owner's Firebase Authentication UID.
4. Keep `kingdom-companion/firebase-config.js` aligned with `veil-chat/firebase-config.js`. This is the standard public Firebase Web configuration, not an Admin SDK key.
5. Publish the root `firestore.rules` file.
6. Optionally create a Firestore TTL policy for collection group `lordMessages` using field `expiresAt`. The clients hide expired Royal Mail immediately; TTL is only delayed server cleanup.
7. Open the companion, sign in as the owner, save the deployed HTTPS Veil Chat URL, and paste the owner's Veil UID into **Owner Veil UID**.

## Visitor identity

Each visitor's stable code is their Firebase Authentication UID. It remains stable in that browser while Firebase's local authentication state remains present. Clearing browser storage or using another device creates a different anonymous account. For a truly portable account, link the anonymous Firebase user to an email, Google, or another permanent sign-in provider later.

The project deliberately does not collect IP addresses or attempt hardware fingerprinting. Those signals are unstable, privacy-invasive, and do not provide reliable account ownership.

Display names are limited to 2–24 characters and accept letters, numbers, spaces, underscores, periods, and hyphens.

## Local development

```powershell
cd kingdom-companion
npm install
npm start
```

## Automatic Windows builds

Pushing a change under `kingdom-companion/` starts `.github/workflows/build-kingdom-companion.yml`. The workflow produces:

- a normal Windows installer
- a portable Windows executable

Download them from **GitHub → Actions → Build Kingdom Companion → latest run → Artifacts → Kingdom-Companion-Windows**.

The artifact is retained for 30 days. Source files remain in the repository, so a new build can always be triggered manually with **Run workflow**.

## Security boundary

Safe to commit:

- Firebase Web App configuration
- Electron source code
- GitHub Actions workflow

Never commit:

- service-account JSON
- Firebase Admin SDK private keys
- OAuth client secrets
- signing certificates/private keys
- passwords, access tokens, or exported plaintext chats
