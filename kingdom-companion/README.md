# Kingdom Companion

This tray app publishes the sovereign's status to the throne and keeps the existing encrypted Veil Chat page alive in a sandboxed Electron window. It opens no listening ports, enables no remote-control features, uses context isolation, disables Node.js in all web content, and permits media/notification access only for the configured HTTPS chat origin.

## First-time setup

1. Enable Email/Password authentication in Firebase Authentication and create your owner account.
2. Copy `firebase-config.sample.js` to `firebase-config.js` and paste the same public Firebase web config used by Veil Chat. You can also directly copy `../veil-chat/firebase-config.js`.
3. In Firestore, create `kingdom/config` with one field: `ownerUid`, containing the Firebase Authentication UID of your owner account.
4. Deploy the updated `firestore.rules`.
5. Run `npm install`, then `npm start` in this directory.
6. Open Audience Messages once, copy your Veil friend link, and paste its UID into the companion. Visitors can then request a direct encrypted audience without exposing a shared room secret.
7. Publish a status and save the HTTPS URL of your deployed `veil-chat/index.html?audience=1` page.
8. Enable system notifications in Veil Chat. Its persisted session continues in the tray app; notifications are bundled and suppressed while busy, sleeping, or offline.

The startup checkbox uses Electron's operating-system login-item API. Quit from the tray menu when you want the companion fully stopped.
