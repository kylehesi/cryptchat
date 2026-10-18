# CryptChat — Roadmap (build pipeline)

One phase at a time. Each phase ends with a **checkpoint**: you run it, we look at it together,
and only then move on. Each phase is also one (or a few) git commits.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Foundation
- [x] Install Node.js LTS (v24.20.0)
- [~] `git init`, `.gitignore`, create the GitHub repo and push (**so we never lose it again**)
- [x] `LICENSE` (GPL-3.0), README skeleton
- [x] `package.json` with latest stable Electron (44.7.0) and `npm start`
- [x] `main.js` with secure defaults (contextIsolation, sandbox, CSP, `app://` scheme,
      permission allow-list, navigation lock), minimal `preload.js`
- **Checkpoint:** `npm start` opens a black window. The DevTools console shows no security warnings.

## Phase 1 — UI shell (no logic)
- [x] `index.html` with the 4 panels, matching the original screenshot
- [x] `theme.css` / `layout.css` / `components.css`
- [x] `logger.js` → KERNEL_LOG (timestamped lines, levels: info / ok / warn / err)
- [x] Settings button opens an empty modal
- **Checkpoint:** side-by-side comparison with the old screenshot. Buttons do nothing yet, and the
  log shows `--- SYSTEM BOOT ---`.

## Phase 2 — Manual connection (the core)
- [x] `PeerSession`: transceivers + `control`/`chat` channels created up front (ARCHITECTURE §5.2)
- [x] Non-trickle ICE gathering with timeout
- [x] `payload.js`: `CC1.` compressed format plus a validation error for bad pastes
- [x] Offer/answer flow wired to GENERATE_PAYLOAD / EXECUTE_CONNECT (the UI knows which role it is in)
- [x] Connection state logs + selected candidate pair type (`host` / `srflx` / `relay`)
- [x] Disconnect / reset button (TERMINATE_LINK, peer notified with `bye`)
- [x] Auto-copy of the local payload, `npm run start:b` for a second instance on one PC
- **Checkpoint:** two app instances on the same PC connect, then two PCs on different networks
  connect. The log reports the route.
  - [x] Same PC: verified by an automated two-window test
  - [ ] Two PCs on different networks: **needs you + a friend**

## Phase 3 — Chat
- [x] Message protocol envelope (ARCHITECTURE §9)
- [x] Alias (saved locally), terminal-style lines: `[ NEO ] > hello`
- [x] `textContent` only, size limits, Enter to send, auto-scroll
- [x] Aliases exchanged over `control` (`profile` message) and shown on the L / R cards
- [x] Control and bidi-override characters stripped; chat locked (`> LINK OFFLINE`) without a link
- **Checkpoint:** chat both ways. Pasting `<img src=x onerror=alert(1)>` shows up as plain text.
  Verified by an automated two-window test.

## Phase 4 — In-band negotiation
- [x] Perfect negotiation over the `control` channel (answerer = polite peer)
- [x] Automatic recovery: `disconnected` → wait 4 s → ICE restart; `failed` → restart at once;
      give up after 30 s with a clear "Link lost" message
- [x] ~~Heartbeat ping~~ replaced by `getStats` polling every 2 s: `LINK: SRFLX · 23 ms` in the
      KERNEL_LOG header, route changes logged. ICE consent checks already detect a dead peer, so a
      separate ping protocol added nothing.
- [x] Dev-only `window.__cc` hook (F12 console) for debugging
- **Checkpoint:** toggle Wi-Fi off and on on one side. The call recovers without a new copy-paste.
  - [x] Automated: single ICE restart, simultaneous restart from both sides (glare), chat
        still flowing afterwards, peer crash → recovery attempt → "Link lost" after 30 s
  - [ ] Manual: Wi-Fi toggle between two real PCs (**needs you**)
  - Known limit: if the only path dies for good (e.g. both IPs change), the restart offer has no
    way to reach the peer without a signaling server, so new payloads are needed. v2
    room-code signaling removes this limit.

## Phase 5 — Voice
- [x] Mic device list, hot-swap, MIC_SRC dropdown (falls back to default if a device disappears)
- [x] TOGGLE_MIC, DEAFEN (Discord semantics), state synced to the peer's card icons
- [x] Speaking indicator on L / R cards
- [x] Settings: echo cancellation / noise suppression / AGC toggles
- [ ] "Music mode" (stereo, high bitrate, no DSP) → moved to phase 6, where it matters for system audio
- [x] Mic is only captured during a call; idle = no capture (a short probe at boot unlocks device names)
- **Checkpoint:** a real voice call, with mute/deafen visible on both sides.
  - [x] Automated with Chromium's fake audio device: audio flows both ways, mute → zero energy at
        the peer, deafen → peer sees both icons off, unmute-while-deafened undeafens, device
        switch and DSP toggle mid-call keep audio flowing, mic released after the call
  - [ ] Real call between two PCs (**needs you**)

## Phase 6 — Screen share + system audio
- [x] Main process source list + terminal-styled source picker (own windows excluded)
- [x] `setDisplayMediaRequestHandler` → `getDisplayMedia` (single-use, 10 s selection)
- [x] `replaceTrack` on the pre-made video transceiver, plus stop sharing; auto-stop when the
      shared window closes
- [x] Quality preset (text vs. motion), bitrate cap
- [x] `[FULL]` and `[ PIP ]` (native PiP works, so no custom window)
- [x] **Spike:** system audio loopback without echoing the peer's voice → solved with
      `restrictOwnAudio` (ARCHITECTURE §7)
- [x] "Music mode" for system audio: stereo Opus at 128 kbps, DSP off
- **Checkpoint:** share a window, then switch to the full screen. Watch it in PiP. Share a YouTube
  video with sound, and the peer does not hear their own voice echoed back.
  - [x] Automated (test-pattern window, never the real desktop): picker, feed at the peer,
        encoder settings, system audio arrives stereo at ~128 kbps, PiP, fullscreen, stop,
        auto-stop on window close
  - [ ] Real two-PC test with a YouTube video (**needs you**)

## Phase 7 — Settings, TURN, privacy
- [x] Settings modal: STUN list, TURN (url/user/pass), relay-only toggle
- [x] `safeStorage` encrypted persistence via IPC (validated in the main process)
- [x] TEST_TURN button (shows `401 Unauthorized` etc.)
- [x] Stats readout (RTT, bitrate, packet loss, route)
- [x] coturn setup guide → [docs/TURN.md](TURN.md)
- **Checkpoint:** with relay-only on, the route is `relay` and the peer's log shows only the TURN IP.
  - [x] Automated with a throwaway local TURN server (node-turn, test only, not a dependency):
        wrong password → 401, right password → OK, settings file contains no plaintext,
        relay-only offer has only relay candidates, the peer only sees the TURN IP, the link
        and chat work over RELAY
  - [ ] With a real coturn VPS across the internet (**needs you**)

## Phase 8 — Verification code
- [x] SAS words from DTLS fingerprints, shown after connect (4 words + 2 digits, ~38 bits)
- [x] MATCH / MISMATCH buttons, `[ VERIFIED ]` tag in the chat header, MISMATCH drops the link
- [x] Distinct "DTLS failed, possible tampering" error instead of the generic ICE one
- **Checkpoint:** both sides see the same code. If the payload is tampered with by hand, the
  connection fails or the codes differ.
  - [x] Automated: same code on both sides, MITM fingerprint sets give different codes,
        a tampered fingerprint never connects (DTLS fails), MISMATCH drops both sides

## Phase 8.5 — Test release (before polish)
- [x] Logo + app icon from the owner's artwork (cropped, watermark-free), `npm run icons` → `tools/icon/build-icons.js`
- [x] In-app **[ ? ] HOW_TO_USE** guide
- [x] Cloudflare TURN support (key ID + API token, credentials minted per link)
- [x] `start.cmd` launcher (no installer yet), README quick start
- [x] Push to the private GitHub repo
- [~] Two-PC tests from phases 2–7 (2026-10-14, both on mobile data):
  - [x] Direct ICE failed, **connected via Cloudflare TURN** (TURN support was needed in practice)
  - [x] Same verification code on both sides
  - [x] Voice clear
  - [ ] Screen share: worked, but **quality was low** (maybe mobile data). Investigate later
  - [ ] System audio without echo: not tested yet
  - [ ] Wi-Fi drop recovery: not tested yet

## Phase 8.6 — File transfer
- [x] Offer → ACCEPT / DECLINE in the chat, one DataChannel per file, 64 KB chunks
- [x] Streamed to disk in the main process: no size limit, RAM stays flat (16 MB window)
- [x] Safe file names, `.part` until the byte count matches, Mark-of-the-Web, free-space check
- [x] Cancel from either side, cleanup on link loss, warning for programs/scripts
- [x] `[ + ]` button and drag & drop onto the chat, progress / speed / ETA, OPEN_FOLDER
- [ ] Two-PC test over TURN (**you + a friend**)

## Phase 8.7 — Screen-share quality
- [x] Bench: codec × bitrate × preset on a text + motion test window (PSNR, fps, encoder, CPU)
- [x] Codec order AV1 → VP9 → VP8 → H.264; switch without renegotiation (`encodings[].codec`)
- [x] AUTO steps down when the encoder is CPU-bound; SCREEN_CODEC setting for a fixed codec
- [x] Live TX/RX stats over the feed (codec, resolution, fps, bitrate, limit, loss)
- [ ] Two-PC test on mobile data / TURN, reading the TX/RX lines (**you + a friend**)
- [ ] If bandwidth turns out to be the limit there: faster bitrate ramp-up, resolution presets

## Phase 9 — Polish
- [x] Final window size: 978×563 content area, minimum size enforced, no scroll
      (v0.2.2: default 1160×700, minimum 1106×563, size and position remembered)
- [ ] Error messages for every failure path (no mic, permission denied, bad payload, ICE failed)
- [ ] Keyboard shortcuts (e.g. mic toggle)
- [ ] README: screenshots (honest security section and usage guide are done)

## Phase 10 — Release
- [x] electron-builder NSIS installer (`npm run dist`): per-user, no UAC prompt, license page,
      shortcuts, app icon, version info. Only `src/`, `package.json` and `LICENSE` are packaged
- [x] GitHub Actions workflow: tag `v*` → build on Windows → draft Release with `.exe` + `SHA256SUMS.txt`
- [x] Repo hygiene: SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue/PR templates, topics
- [ ] **Code signing.** Unsigned builds get a SmartScreen warning, and **Smart App Control blocks
      them outright** (verified on the dev PC). Plan: apply to SignPath Foundation (free for open
      source) → sign app exe, uninstaller and installer in CI. See [RELEASING.md](RELEASING.md)
- [ ] Version 1.0.0

---

# TO DO

The ordered backlog (open items, ideas, pending tests, decisions) lives in **[TODO.md](TODO.md)**.
This file keeps the history of the finished phases.
