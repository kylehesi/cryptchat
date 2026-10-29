# CryptChat — Architecture

> Status: **draft for review**. Nothing here is implemented yet.

## 1. Goals

- Two people (later 3–4) talk, chat and share screens **directly, peer-to-peer**.
- **No backend we operate.** No accounts, no database, no signaling server of our own.
  The only third-party infrastructure is STUN (public) and TURN (user-provided, optional).
- Small, auditable codebase: Electron + WebRTC + vanilla JS (ES modules). No UI framework.
- Terminal aesthetic: black background, `#00ff00`, monospace, English "system" vocabulary.
- Windows only for v1.
- License: MIT (GPL-3.0 up to v0.2.3).

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

One instance per profile (`app.requestSingleInstanceLock()`, which is tied to the userData
folder): a second launch quits at once and brings the running window to the front, so two
processes never write the same settings and storage. `--profile=x` uses its own userData, so
it still runs side by side (that is how two copies connect on one PC during development).

## 4. Directory layout

```
cryptchat/
├─ package.json
├─ electron-builder.yml
├─ LICENSE                      MIT
├─ README.md
├─ docs/
│  ├─ ARCHITECTURE.md           (this file)
│  ├─ RELEASING.md              building and publishing the installer
│  └─ TURN.md                   when a relay is needed, and how to set one up
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
   channel, so the other side drops immediately instead of waiting for an ICE timeout. The app
   goes idle at once, but the transport is only closed after `bye` has left the send buffer
   (max 2 s). Otherwise a busy link (a file transfer) would drop it.
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
be added later without touching `PeerSession`. Planned: contacts that meet over public Nostr relays.

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

- STUN: 2 servers by default (one Google, one Cloudflare), editable. More only slows down gathering.
- TURN: **user-provided** (BYOS) through the settings modal. No credentials are shipped in source code.
  Two kinds can be combined:
  - **Cloudflare TURN:** the user stores a TURN key ID + API token. Before each link,
    `src/main/cloudflare-turn.js` calls `POST rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers`
    (`ttl` 24 h, cached and reused until less than 1 h is left) and passes back only TURN URLs
    with credentials. **Port 53 URLs are dropped**: browsers block that port, and with
    non-trickle gathering a dead URL would only add a timeout. This is the app's only outbound
    HTTP request, and it runs in the main process (the renderer's CSP allows none).
  - **Custom TURN** (e.g. coturn): static URL + username + password.
- **Storage:** `src/main/secure-store.js` validates the settings (URL schemes, lengths, "RELAY_ONLY
  needs TURN") and writes them encrypted with Electron `safeStorage` (Windows DPAPI) to
  `userData/network.bin`, using an atomic write. The renderer only talks to it over IPC.
  New settings apply to the **next** link.
- **Relay-only mode** → `iceTransportPolicy: 'relay'`: our payload contains only relay candidates,
  so the peer sees the TURN server's IP, never ours. If no relay candidate can be gathered, no
  payload is produced (it could never connect) and the user is pointed to TEST_TURN.
- **TEST_TURN** gathers with `iceTransportPolicy: 'relay'` and reports success with timing, or
  the server's error (e.g. `401 Unauthorized`) from `icecandidateerror`.
- Live link stats in the KERNEL_LOG header: route, RTT, up/down bitrate, packet loss.
- Guide for running your own `coturn`: [TURN.md](TURN.md).

### 5.6 NAT_CHECK and HOLD_OPEN (direct links through NATs)

- **NAT_CHECK** (`net/nat-check.js`) asks the STUN servers from one socket. Chromium reports one
  srflx candidate per distinct mapping, so two candidates for the same base mean a symmetric
  NAT (TURN needed). One mapping only counts as "cone" if each server also answered when asked
  on its own (checked in parallel). Verified against a raw STUN client and RFC 5780 tests, and
  in `test/e2e/nat-check.test.js` with fake STUN servers that play cone, symmetric and blocked.
- **Why HOLD_OPEN exists:** most home NATs map ports independently of the destination but
  *filter* by address and port: a packet only gets in from an address we sent to recently.
  With copy-paste signaling the answerer starts its checks the moment it makes the answer, but
  the offerer only starts once its user pastes that answer, often a minute later. Chromium
  stops checking after ~15 s without replies, the answerer's NAT closes the hole, and the
  offerer's checks then bounce off it: "ICE failed" between two NATs that could link directly.
  Same-machine tests never show it, because there is no NAT in between.
- **HOLD_OPEN** (`PeerSession.holdOpen()`, driven by `Connection` every 5 s while the answerer
  waits): when no candidate pair is being checked any more, the offer's candidates are added
  again with a higher `generation` (and no `ufrag`, so Chromium fills in the current one).
  Chromium keeps one connection per remote address and only replaces it for a newer
  generation, so this restarts the checks, and with them the hole. It stops once the link is
  up or after the configured time (Settings → NETWORK, OFF / 30 s – 5 min, default 2 min).
  While it runs, an early ICE "failed" does not end the attempt; a DTLS failure still does.
- **Side effect handled:** after that, an ICE restart's candidates would be older than the
  connections HOLD_OPEN left behind, and Chromium would keep the stale ones (no working pair
  with the new credentials: measured). So once HOLD_OPEN has run, every later remote
  candidate, in-band or in a new remote description, is re-generationed above them as well.

## 6. Verification code (SAS)

Each side takes both DTLS fingerprints from the SDP (`a=fingerprint`), sorts them, and hashes
`"cryptchat-sas-v1\n" + fp1 + "\n" + fp2` with SHA-256. Bytes 0–3 pick 4 words from a frozen
256-word list (`security/words.js`), and byte 4 mod 100 gives 2 digits. Example:
`GALAXY-ACID-TYPHOON-NEPTUNE-23`.

- **Why it works:** DTLS only completes if each certificate matches the fingerprint the *other*
  side received. A man-in-the-middle has to use his own certificates, so A hashes (A, M1) and B
  hashes (M2, B), and the codes differ.
- **Why 4 words + 2 digits (~38 bits) and not 3 words:** the attacker commits to M2 before he
  sees B's fingerprint, then has to grind M1 until the codes collide. 30 bits would be hours of
  work, 38 bits is not feasible while the users wait.
- **UI:** once linked, the REMOTE_PAYLOAD section turns into `3. VERIFY_CODE` with **MATCH**
  and **MISMATCH**. The chat header shows `[ UNVERIFIED ]` / `[ VERIFIED ]`. MISMATCH terminates
  the link on both sides.
- If payloads are altered so that a fingerprint no longer matches the real certificate, DTLS
  fails. The log says so explicitly ("SECURE HANDSHAKE (DTLS) FAILED … possible tampering")
  instead of the generic ICE error.

## 7. Audio design

### Microphone

- `getUserMedia({ audio: { deviceId, echoCancellation, noiseSuppression, autoGainControl } })`.
  Each processing option can be toggled in settings. For a "music mode" all of them are off and
  Opus is set to stereo with a higher bitrate.
- Toggle mic = `track.enabled = false`. The track keeps running, so unmuting is instant.
- Device hot-swap via `devicechange` + `replaceTrack`.
- Captured only during a call, never at startup. Chromium normally hides device names until
  capture is allowed, but our permission check handler already grants `media` to our own
  origin, so `enumerateDevices()` returns the names without opening the mic. If a system hides
  them anyway (`Microphone.labelsHidden`), the lists refresh once the first call captures.

### System audio (replaces the VB-Cable setup)

- Electron's display-media handler can return `audio: 'loopback'` on Windows, which captures
  everything the PC plays, without any virtual cable driver.
- **Echo problem, solved:** full-system loopback would also capture *our own playback* (the
  peer's voice) and send it back to them. The `restrictOwnAudio: true` constraint on
  `getDisplayMedia()` excludes our process's audio. Measured in the phase 6 spike (Electron 44):

  | Capture | Our own tone (1 kHz) | Another app's tone (2.5 kHz) |
  |---|---|---|
  | plain loopback | −45 dB (captured → echo) | −33 dB |
  | `restrictOwnAudio: true` | −126 dB (gone) | −32 dB (kept) |

  No native module and no virtual cable needed.
- System audio goes on its **own** transceiver (5.2), separate from the mic, with DSP off
  (no echo cancellation / noise suppression / AGC, which would ruin music).
- **Hi-fi:** the system-audio sender is capped at 128 kbps, and Opus is stereo. Stereo is
  enabled by adding `stereo=1; sprop-stereo=1; maxaveragebitrate=128000` to that m-line's Opus
  `fmtp` in every **remote** description before `setRemoteDescription()` (`net/sdp.js`). Remote
  SDP is our own input, so this is not the local-SDP munging that Chromium restricts.
  The mic stays mono, voice-tuned.

### Remote side

- One `<audio>` element per remote audio track. Deafen = mute all remote playback **and** mute
  your own mic (Discord semantics). The state is sent to the peer over `control`.
- **Output device** (`media/speakers.js`): every playback element registers with `Speakers`,
  which applies the AUDIO_OUT choice via `setSinkId()` (now and on every change). It falls
  back to `default` when the device disappears.
- **Volumes** (`media/volume.js`): the peer's voice and their system audio each have their own
  0–100% level on the media element, remembered per PC. There is no boost above 100%: that would
  need Web Audio playback, which weakens Chromium's echo cancellation for speaker users.
- Speaking indicator: `AnalyserNode` RMS with a threshold, used for both local and remote cards.

## 8. Screen share

- The main process lists sources via `desktopCapturer.getSources` and the renderer shows a
  **terminal-styled source picker** (screens + windows with thumbnails).
- The pick is passed back through `setDisplayMediaRequestHandler`, and the renderer simply calls
  `navigator.mediaDevices.getDisplayMedia()`. This is the modern API. A selection is
  **single-use and expires after 10 s**, so `getDisplayMedia()` can never capture something the
  user did not just pick. Our own windows are excluded from the list.
- Quality presets (`media/screen.js`):

  | Preset | `contentHint` | fps | max bitrate | degradation |
  |---|---|---|---|---|
  | TEXT/CODE | `detail` | 30 | 4 Mbps | maintain-resolution |
  | MOTION/GAMES | `motion` | 60 | 8 Mbps | maintain-framerate |

- **Codec.** The screen transceiver negotiates codecs in the order **AV1 → VP9 → VP8 → H.264**
  (`setCodecPreferences` on both sides). The encoder is then picked per share with
  `RTCRtpEncodingParameters.codec`, which switches codecs **without renegotiation**. Settings →
  VIDEO → SCREEN_CODEC: `AUTO` (default) or a fixed codec. Measured on a 1080p text +
  60 fps motion test window, sending side i5-13500H / Intel Xe:

  | Codec (encoder) | 1 Mbps, TEXT/CODE | 3 Mbps, TEXT/CODE | 3 Mbps, MOTION |
  |---|---|---|---|
  | VP8 (software) | 14 fps, text PSNR 37.0 dB | 29 fps, 41.7 dB | downscaled to 1428 px, 26.2 dB |
  | VP9 (Intel hardware) | 30 fps, 37.7 dB | 30 fps, 47.5 dB | full res, 44.7 dB |
  | **AV1** (software, libaom) | **30 fps, 42.9 dB** | **30 fps, 48.8 dB** | **full res, 46.8 dB** |
  | H.264 (Intel hardware) | 30 fps, 27.8 dB | 29 fps, 43.3 dB | downscaled, 20.8 dB |

  AV1 costs ~13 ms of CPU per 1080p frame here. `contentHint = 'text'` made no measurable
  difference over `'detail'`.
- **CPU safety net (AUTO).** Every 2 s the sender reads `qualityLimitationReason`. After about
  6 s of `cpu`, it steps down to the next negotiated codec (AV1 → VP9 → VP8) and remembers that
  for the rest of the session. Verified with WebRTC's simulated-overuse field trial.
- **Live stats** over the feed: `TX AV1 (software) 1904×1012@30 · 0.98 Mbps · LIMIT: BANDWIDTH`
  on the sender, and `RX … · LOSS x%` on the viewer. A bad picture can then be traced to bandwidth,
  CPU or packet loss.
- The peer is told `{ type: 'share', active, audio }` over `control`, which shows or hides the
  feed. A frozen receiver track alone is not a reliable signal.
- If the shared window closes, the capture track ends and the broadcast stops by itself.
- **Switching source** (SWITCH) calls the same `start()` on a running broadcast. The new capture
  is put on the senders with `replaceTrack()` **before** the old one is stopped, so the sender
  never holds an ended track and the viewer sees a cut, not a stop. The `share` state is resent,
  so turning audio off during a switch hides the viewer's SYS_VOL.
- `[FULL]` → Fullscreen API on the screen box (double-clicking the video does the same).
- `[ PIP ]` → native `video.requestPictureInPicture()`. It works in Electron and floats
  always-on-top, so no custom window is needed.

## 9. Message protocol (DataChannels)

All messages are JSON with a version and a type:

```json
{ "v": 1, "type": "chat",    "id": "uuid", "alias": "NEO", "text": "hello" }
{ "v": 1, "type": "profile", "alias": "NEO" }
{ "v": 1, "type": "bye" }
{ "v": 1, "type": "state",   "mic": true, "deaf": false }
{ "v": 1, "type": "share",   "active": true, "audio": true }
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

## 10. File transfer

```
sender                                   receiver
  │ control: file-offer {id,name,size} ──▶ │  chat line: ACCEPT / DECLINE
  │                                        │  ACCEPT → main: create Downloads\CryptChat\<name>.part
  │ ◀── control: file-accept {id} ──────── │
  │ opens DataChannel "file:<id>"          │
  │ ── 64 KB binary chunks ──────────────▶ │  main: append to .part (strictly in order)
  │ ◀── {type:'ack', bytes} every 1 MB ──  │  (bytes actually written to disk)
  │ ── {type:'end', bytes} ──────────────▶ │  main: size check → rename → Mark-of-the-Web
  │ ◀── {type:'done'} ──────────────────── │
```

- **One DataChannel per transfer** (opened in-band over the existing SCTP link, so no
  renegotiation). Transfers run in parallel and never block chat or control messages.
- **No size limit, flat memory.** The sender reads the file as a stream. It pauses while the
  channel buffer is above 4 MB **or** more than 16 MB are sent but not yet acknowledged as
  *written* by the receiver. A slow disk on the other side therefore slows the sender instead of
  filling the receiver's RAM.
- **Disk is the main process's job** (`src/main/file-receive.js`), over IPC
  (`cc.files.open/write/close/abort/reveal`). The renderer never gets a file path or `fs` access.
  - The peer-supplied name is reduced to a safe Windows file name: path parts removed,
    reserved names (`CON`, `NUL`, …) and forbidden or bidi characters replaced. A transfer can
    never write outside `Downloads\CryptChat`.
  - Data is written to `<name>.part`, which is reserved atomically (`wx`). It is renamed only if
    the byte count is exact. Existing files are never overwritten (`name (1).ext`).
  - Finished files get `Zone.Identifier` (ZoneId=3), so SmartScreen treats them like any
    other internet download.
  - The free disk space is checked before accepting (keeping a 256 MB margin).
  - On cancel, link loss, window reload/crash or app quit, `.part` files are deleted.
  - Disk errors become short reasons without paths (`friendlyFsError`): Node's own text has
    the full path with the Windows user name, and the reason is also sent to the peer.
    Tested with a faked full disk and a refused folder (`test/e2e/file-errors.test.js`).
- **Integrity:** DTLS authenticates and encrypts every chunk, and the channel is reliable and
  ordered. The exact byte count is checked before the rename. No extra hash is needed.
- **UI:** transfers are lines in the chat (`[ + ]` button or drag & drop). Programs and scripts
  get a warning before ACCEPT. Progress shows bar, %, speed and ETA. OPEN_FOLDER on receipt.

## 11. Notifications

- **Sounds** (`media/sounds.js`): synthesized with Web Audio, so there are no sound files. One
  `AudioContext`, routed to AUDIO_OUT through `Speakers` (`AudioContext.setSinkId`).

  | Sound | Character | Played for |
  |---|---|---|
  | `message` | soft two-note triangle chime + echo | chat message, incoming file, file received |
  | `console` | square-wave arpeggio through a bit-crusher | warn/err log lines, link up / restored |
  | `disconnect` | falling detuned saw, closing filter, gated stutter | peer terminated, link lost, ICE/DTLS failed |
  | `ui` | noise tick; `on`/`off` add a rising/falling blip | every button; mic/deafen; screen share on/off |

  Event sounds requested within 150 ms are merged, and the highest priority wins
  (disconnect > console > message). So "peer terminated" plays one alarm, not alarm + system
  sound. `renderSound()` renders offline for tests (audible, no clipping, short) and for previews.
- **Attention** (`ui/attention.js`): `mark(elements, { tone })` adds `is-unseen` + a tone class
  (accent / warn / danger). While the window is unfocused the glow stays. Once focused, it fades
  after 3 s. If the window is in the background, the taskbar button flashes until focus
  (`window:flash` IPC → `BrowserWindow.flashFrame`).
- **Wiring** (`ui/notifications.js`) listens to existing events only (chat, transfers,
  connection `ended` / `phase`, log entries, voice and screen-share state). Log entries carry
  `notify` (default true). Messages that only confirm the user's own action pass
  `{ notify: false }`, and `ended` has a `reason`, so our own TERMINATE_LINK (`local`) never
  raises an alarm.

## 12. UI

Same 4-panel layout as the original:

```
┌ CONNECTION_MATRIX ─────────┐┌ A.V._INTERFACE ──────────────────────┐
│ 1. LOCAL_PAYLOAD           ││ [L] LOCAL_USR  🎙🎧  [R] REMOTE_USR 🎙🎧│
│ [GENERATE_PAYLOAD][NAT]    ││ MIC_SRC [............]                │
│ 2. REMOTE_PAYLOAD          ││ [TOGGLE_MIC][DEAFEN][SHARE_SCR]       │
│ [EXECUTE_CONNECT]          ││ ┌ remote screen ──────────── [PIP] ┐  │
├ ENCRYPTED_CHAT ────────────┤│ └──────────────────────────────────┘  │
│ > SET ALIAS                │├ KERNEL_LOG ──── LINK: … [COPY_LOG] ───┤
│ [ messages ]               ││ [time] ...                            │
│ > TYPE MESSAGE [SEND]      ││                                       │
└────────────────────────────┘└───────────────────────────────────────┘
```

- `<html lang="en">`. This fixes the `PİP` dotted-İ bug that `text-transform: uppercase`
  produced under a Turkish system locale.
- All strings, including logs, are in English.
- Colors live in CSS custom properties in `theme.css`.
- Window: opens at 1160×700 content, minimum 1100×660 (978×563 on small screens), size and
  position remembered (`src/main/window-state.js`). The left column stays 352px.
- **COPY_LOG** (`core/log-report.js`): the log as text for bug reports. Masking does not depend
  on HIDE_IP_AND_PAYLOAD: IPs, STUN/TURN hosts and payloads by pattern, and personal details by
  marking. Modules wrap file names, window titles and aliases in `secret()` when they log;
  KERNEL_LOG shows them, COPY_LOG writes `[hidden]`. Marking beats pattern matching here: a
  one-letter alias would otherwise blank every matching letter. The newest lines are kept if
  the log is over the 64 KiB clipboard limit.
