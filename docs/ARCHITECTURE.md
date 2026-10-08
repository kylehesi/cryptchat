# CryptChat — Architecture

> Status: **draft for review**. Nothing here is implemented yet.

## 1. Goals

- Two people (later 3–4) talk, chat and share screens **directly, peer-to-peer**.
- **No backend we operate.** No accounts, no database, no signaling server of our own.
  The only third-party infrastructure is STUN (public) and TURN (user-provided, optional).
- Small, auditable codebase: Electron + WebRTC + vanilla JS (ES modules). No UI framework.
- Terminal aesthetic: black background, `#00ff00`, monospace, English "system" vocabulary.
- Windows only for v1.
- License: GPL-3.0.

### Non-goals (v1)

- Camera, group calls, file transfer, other OSes, localisation. (See roadmap "Later".)

## 2. Honest security model

What we promise, and what we do **not** promise. This goes into the README verbatim.

| Property | Status |
|---|---|
| Media + chat encrypted in transit | **Yes.** WebRTC mandates DTLS-SRTP (media) and DTLS-SCTP (DataChannel). No plaintext mode exists. |
| No server reads your content | **Yes.** STUN only sees your IP. TURN relays already-encrypted packets and cannot decrypt them. |
| Protection against man-in-the-middle | **Only if the payload exchange is trusted, or you verify the SAS code.** The payload contains the DTLS fingerprint. If an attacker swaps it in transit, they can sit in the middle. The **verification code** (section 6) detects this. |
| Hides your IP from the peer | **No by default.** Your *public* IP is in the payload (`srflx` candidate). Your LAN IP is hidden behind a random `.local` mDNS name by Chromium. **Relay-only mode** hides both: the peer only sees the TURN server's IP. |
| Anonymous / untraceable | **No.** We do not claim this. STUN/TURN operators see IPs, and the way you exchange payloads (WhatsApp, etc.) has its own metadata. |

## 3. Process layout (Electron)

```
┌──────────────────────── main process (Node) ────────────────────────┐
│ main.js          window creation, secure webPreferences, CSP         │
│ capture.js       setDisplayMediaRequestHandler → screen/window list  │
│ secure-store.js  safeStorage-encrypted settings (TURN credentials)   │
│ pip.js           (only if native PiP is not good enough)             │
└──────────────▲───────────────────────────────────────────────────────┘
               │ IPC (ipcMain.handle / ipcRenderer.invoke)
┌──────────────┴──────── preload.js (contextBridge) ──────────────────┐
│ exposes a tiny, explicit API: window.cc.{listSources, pickSource,    │
│ settings.get/set, ...}  — no raw ipcRenderer, no Node in the page    │
└──────────────▲───────────────────────────────────────────────────────┘
               │
┌──────────────┴──────────── renderer (Chromium) ─────────────────────┐
│ all WebRTC, audio, UI. Plain ES modules, no bundler.                 │
└──────────────────────────────────────────────────────────────────────┘
```

Security defaults: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
strict CSP (`default-src 'self'`), no remote URLs loaded, navigation and `window.open` blocked.
The renderer is served from a privileged custom scheme `app://cryptchat` (not `file://`). This
gives it a secure origin and clean ES-module loading, and lets permission handlers grant `media`
only to our own origin. Every other permission is denied.

## 4. Directory layout

```
cryptchat/
├─ package.json
├─ electron-builder.yml
├─ LICENSE                      GPL-3.0
├─ README.md
├─ docs/
│  ├─ ARCHITECTURE.md           (this file)
│  └─ ROADMAP.md                phased pipeline + checkboxes
└─ src/
   ├─ main/
   │  ├─ main.js
   │  ├─ capture.js
   │  └─ secure-store.js
   ├─ preload/
   │  └─ preload.js
   └─ renderer/
      ├─ index.html
      ├─ styles/
      │  ├─ theme.css           color tokens, fonts
      │  ├─ layout.css          the 4-panel grid
      │  └─ components.css      buttons, inputs, modal, log lines
      └─ js/
         ├─ app.js              bootstrap: wires modules together
         ├─ core/
         │  ├─ events.js        tiny event bus (EventTarget wrapper)
         │  ├─ logger.js        → KERNEL_LOG panel + console
         │  └─ settings.js      renderer-side settings access
         ├─ net/
         │  ├─ peer-session.js  one RTCPeerConnection + its channels (one per remote peer)
         │  ├─ negotiation.js   "perfect negotiation" over the control channel
         │  ├─ ice-config.js    builds iceServers / iceTransportPolicy from settings
         │  ├─ payload.js       SDP ⇄ compact copy-paste string
         │  ├─ stats.js         getStats → connection type, RTT, bitrate, loss
         │  └─ signaling/
         │     └─ manual.js     copy-paste signaling (v1)
         ├─ media/
         │  ├─ microphone.js    device list, constraints, mute, device hot-swap
         │  ├─ playback.js      remote audio element, deafen, output volume
         │  ├─ voice-activity.js  AnalyserNode → "speaking" indicator
         │  └─ screen.js        start/stop share, replaceTrack, contentHint, bitrate
         ├─ chat/
         │  └─ chat.js          alias, message protocol, rendering
         ├─ security/
         │  └─ verify.js        SAS verification code from DTLS fingerprints
         └─ ui/
            ├─ connection-panel.js
            ├─ av-panel.js
            ├─ chat-panel.js
            ├─ log-panel.js
            ├─ source-picker.js
            └─ settings-modal.js
```

**Rule:** `net/`, `media/`, `chat/` and `security/` never touch the DOM. `ui/` never touches
`RTCPeerConnection`. They communicate through the event bus. Each part can then be understood
and tested on its own.

## 5. Connection design

### 5.1 One `PeerSession` per remote peer

Everything about one remote peer (its `RTCPeerConnection`, channels, transceivers, stats) lives in
one `PeerSession` object. The app keeps a `Map<peerId, PeerSession>`.

v1 only ever has one entry. Groups (3–4 people, full mesh) later just mean more entries, so the
core does not need a rewrite. This costs almost nothing now.

### 5.2 Everything is created before the first offer

So the first SDP already describes every slot, and adding media later never needs a new copy-paste:

| Item | How | Purpose |
|---|---|---|
| audio transceiver | `addTransceiver('audio', sendrecv)` | microphone |
| video transceiver | `addTransceiver('video', sendrecv)` | screen share (empty until used) |
| audio transceiver #2 | `addTransceiver('audio', sendrecv)` | screen/system audio (empty until used) |
| `control` DataChannel | `negotiated: true, id: 0`, reliable, ordered | signaling, state sync, pings |
| `chat` DataChannel | `negotiated: true, id: 1`, reliable, ordered | chat messages |

Starting a screen share is then just `videoSender.replaceTrack(screenTrack)`. No renegotiation, no
crash, and **no dummy black canvas track**. Stopping is `replaceTrack(null)`.

### 5.3 Signaling: bootstrap once, then go in-band

1. **Bootstrap (manual, v1):** offer → copy/paste → answer → copy/paste. We use
   non-trickle ICE: we wait for `iceGatheringState === 'complete'` (with a 4 s timeout)
   so each payload is self-contained.
   The **answerer holds back the offer's candidates** until its own gathering finishes, and
   only then adds them with `addIceCandidate`. Without this, a fast path (e.g. same PC or LAN)
   connects within milliseconds, Chromium stops gathering, and the answer ships without its
   public `srflx` candidate.
   The UI state machine lives in `net/connection.js`: `idle → gathering → awaiting-answer |
   awaiting-peer → connecting → connected | failed`. TERMINATE_LINK sends `bye` on the control
   channel, so the other side drops immediately instead of waiting for an ICE timeout.
2. **After connect:** any further negotiation (ICE restart after a network change, codec changes,
   future camera) uses the **"perfect negotiation" pattern over the `control` channel**. The
   user never copies anything again for that session. The answerer is the *polite* peer: on an
   offer collision it rolls back and accepts the other side's offer. Incoming `sdp`/`ice`
   messages are processed strictly in order.
3. **Recovery:** `disconnected` → wait 4 s (most blips heal by themselves) → `restartIce()`.
   `failed` → restart immediately. If the link is not back within 30 s, the session closes with
   "Link lost". **Limit:** the restart offer travels through the same tunnel. If the only path
   is gone for good, nothing can deliver it without a signaling server, so new payloads are
   needed. Room-code signaling (v2) would remove this limit.

Signaling sits behind a small interface (`send(msg)`, `onMessage`), so a "room code" transport can
be added later without touching `PeerSession`. See the open decision in ROADMAP.

### 5.4 Payload format

```
CC1.<base64url( deflate-raw( JSON{ t: "offer"|"answer", sdp: "...", v: 1 } ) )>
```

- `CC1.` prefix: version, and it lets us reject garbage pasted by mistake with a clear error.
- `CompressionStream('deflate-raw')` is built into Chromium, so no dependency is needed.
  Measured: about 2.6k characters per payload (3 media slots + data). That is fine for chat
  apps. If needed, we can strip unused SDP lines later.
- Whitespace is stripped before decoding, because chat apps often wrap long strings.
  Decompression is capped at 256 KB (decompression-bomb guard).
- The payload is auto-copied through the main process (`cc.clipboard.writeText` → IPC).
  `navigator.clipboard` would fail, because gathering takes longer than the click's
  user-activation window.
- Optional QR rendering later.

### 5.5 ICE configuration

- STUN: 2 servers (one Google, one Cloudflare). More only slows down gathering.
- TURN: **user-provided** (BYOS) through the settings modal, stored with Electron `safeStorage`.
  No credentials are shipped in source code.
- **Relay-only mode** toggle → `iceTransportPolicy: 'relay'` (hides your IP, requires TURN).
- A "TEST_TURN" button that gathers candidates and reports whether a `relay` candidate appeared,
  which proves the credentials work.
- The README will include a short guide for running your own `coturn` on a cheap VPS.

## 6. Verification code (SAS)

Each side reads both DTLS fingerprints from the SDP, sorts them, hashes them (SHA-256) and maps the
first bits to a word list. Example: `RAVEN-COBALT-ECHO-71`. Both users read it aloud. If it
matches, nobody is in the middle. It is shown in the UI after connecting.

## 7. Audio design

### Microphone

- `getUserMedia({ audio: { deviceId, echoCancellation, noiseSuppression, autoGainControl } })`.
  Each processing option can be toggled in settings. For a "music mode" all of them are off and
  Opus is set to stereo with a higher bitrate.
- Toggle mic = `track.enabled = false`. The track keeps running, so unmuting is instant.
- Device hot-swap via `devicechange` + `replaceTrack`.

### System audio (replaces the VB-Cable setup)

- Electron's display-media handler can return `audio: 'loopback'` on Windows, which captures
  everything the PC plays, without any virtual cable driver.
- **Known risk (needs a spike in phase 6):** full-system loopback also captures *our own
  playback*, so the remote voice would be echoed back to the peer. Options to evaluate, in order:
  1. Chromium's own-audio suppression constraints (`suppressLocalAudioPlayback`,
     `restrictOwnAudio`, `systemAudio: 'include'`) — check what our Electron version honors.
  2. Windows **process loopback** (exclude our own process tree), via a small native module.
  3. Fallback: allow system audio only when the user is wearing headphones, plus a warning.
- System audio goes on its **own** transceiver (5.2), separate from the mic, so the peer can
  control its volume separately.

### Remote side

- One `<audio>` element per remote audio track. Deafen = mute all remote playback **and** mute
  your own mic (Discord semantics). The state is sent to the peer over `control`.
- Speaking indicator: `AnalyserNode` RMS with a threshold, used for both local and remote cards.

## 8. Screen share

- The main process lists sources via `desktopCapturer.getSources` and the renderer shows a
  **terminal-styled source picker** (screens + windows with thumbnails).
- The pick is passed back through `setDisplayMediaRequestHandler`, and the renderer simply calls
  `navigator.mediaDevices.getDisplayMedia()`. This is the modern API.
- Quality presets: `contentHint = 'detail'` (text/code, high res, low fps) or `'motion'`
  (games/video, 60 fps). Bitrate is capped with `sender.setParameters`.
- `[FULL]` → Fullscreen API on the video element.
- `[ PIP ]` → try native `video.requestPictureInPicture()` first (zero extra code). We only build a
  custom always-on-top `BrowserWindow` if native PiP falls short.

## 9. Message protocol (DataChannels)

All messages are JSON with a version and a type:

```json
{ "v": 1, "type": "chat",    "id": "uuid", "alias": "NEO", "text": "hello" }
{ "v": 1, "type": "profile", "alias": "NEO" }
{ "v": 1, "type": "bye" }
{ "v": 1, "type": "state",   "mic": true, "deaf": false }
{ "v": 1, "type": "sdp",   "description": { "type": "offer", "sdp": "..." } }
{ "v": 1, "type": "ice",   "candidate": { ... } }
```

- Unknown `type` or `v` → ignore and log. Size limits are enforced, and over-long messages are
  dropped.
- Chat text is always rendered with `textContent`, **never** `innerHTML`. This prevents XSS from
  the peer.
- Aliases are sanitized (length, charset) on both sides: `A–Z 0–9 _ . -`, max 16 characters.
- Chat text: control characters and bidi overrides (e.g. U+202E) are stripped, max 2000 chars.
  Messages are timestamped with the **local receive time**, because the peer's clock is not
  trusted.

## 10. UI

Same 4-panel layout as the original:

```
┌ CONNECTION_MATRIX ─────────┐┌ A.V._INTERFACE ──────────────────────┐
│ 1. LOCAL_PAYLOAD           ││ [L] LOCAL_USR  🎙🎧  [R] REMOTE_USR 🎙🎧│
│ [GENERATE_PAYLOAD]         ││ MIC_SRC [............]                │
│ 2. REMOTE_PAYLOAD          ││ [TOGGLE_MIC][DEAFEN][SHARE_SCR]       │
│ [EXECUTE_CONNECT]          ││ ┌ remote screen ──────────── [PIP] ┐  │
├ ENCRYPTED_CHAT ────────────┤│ └──────────────────────────────────┘  │
│ > SET ALIAS                │├ KERNEL_LOG ───────────────────────────┤
│ [ messages ]               ││ [time] ...                            │
│ > TYPE MESSAGE [SEND]      ││                                       │
└────────────────────────────┘└───────────────────────────────────────┘
```

- `<html lang="en">`. This fixes the `PİP` dotted-İ bug that `text-transform: uppercase`
  produced under a Turkish system locale.
- All strings, including logs, are in English.
- Colors live in CSS custom properties in `theme.css`. Window size will be tuned at the end.
