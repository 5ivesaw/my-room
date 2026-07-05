<p align="center">
  <img src="assets/my-room-icon.svg" width="96" height="96" alt="My Room icon">
</p>

<h1 align="center">My Room</h1>

<p align="center">
  A playable 3D bedroom with an interactive piano, a physical gaming setup, and a desktop PC that boots into a local game hub.
</p>

<p align="center">
  <img alt="Static site" src="https://img.shields.io/badge/static-site-111827?style=for-the-badge">
  <img alt="Three.js" src="https://img.shields.io/badge/three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white">
  <img alt="Vanilla JavaScript" src="https://img.shields.io/badge/vanilla-js-f7df1e?style=for-the-badge&logo=javascript&logoColor=111111">
</p>

## What It Is

**My Room** is a browser game built as a detailed first-person bedroom. It mixes room exploration, small interactions, a playable piano songbook, and an in-room PC with a fictional desktop interface. The PC includes a bundled **Game Hub** app, so the extra games are playable from inside the room instead of living as separate pages.

## Features

- First-person 3D bedroom built with Three.js.
- Interactive furniture, fridge, window, cat, fan, door, lights, and gaming setup.
- Playable piano with a songbook and local recordings.
- In-room gaming PC with boot flow, setup flow, desktop, windows, file explorer, settings, browser, sounds, and mini apps.
- Game Hub app inside the PC with five bundled games:
  - Sawline
  - Snare
  - Void Echo
  - Wake Weaver
  - Inkstain
- Static-file friendly: no build step, no backend, no package install.

## Controls

| Action | Control |
| --- | --- |
| Look around | Mouse |
| Move | `W` `A` `S` `D` or arrow keys |
| Interact | `E` |
| Stand up from chair or piano | `Space` |
| Piano notes | Use the labeled keyboard keys while seated |
| Piano book | Mouse clicks while seated |
| PC access | Sit in the gaming chair and look at the monitor |
| Chair spin | Look slightly sideways or nudge with left/right arrows |

## Run Locally

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Project Structure

```text
.
|-- index.html              # Main game entry
|-- main.js                 # Renderer and game loop
|-- world.js                # Room scene, meshes, and interactables
|-- player.js               # First-person movement
|-- interactions.js         # Interaction targeting and prompts
|-- sounds.js               # Room audio
|-- pc-os.js                # In-room PC operating system
|-- pc-os.css               # PC desktop/setup styling
|-- styles.css              # Bedroom HUD/start styling
|-- assets/                 # Audio, recordings, icon, credits
`-- gamehub/                # Bundled playable game hub
```

## Publish

This repo is ready for GitHub Pages. Push it to GitHub, then enable Pages from the repository settings using:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

The site will publish at:

```text
https://5ivesaw.github.io/-my-room/
```

## Credits

Piano recording attribution is listed in [`assets/recording-credits.md`](assets/recording-credits.md).

This project is a fan-made personal browser room. The in-game desktop is fictional and not affiliated with Microsoft.
