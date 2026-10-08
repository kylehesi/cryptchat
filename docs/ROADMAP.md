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
- [ ] `index.html` with the 4 panels, matching the original screenshot
- [ ] `theme.css` / `layout.css` / `components.css`
- [ ] `logger.js` → KERNEL_LOG (timestamped lines, levels: info / ok / warn / err)
- [ ] Settings button opens an empty modal
- **Checkpoint:** side-by-side comparison with the old screenshot. Buttons do nothing yet, and the
  log shows `--- SYSTEM BOOT ---`.

## Phase 2 — Manual connection (the core)
- [ ] `PeerSession`: transceivers + `control`/`chat` channels created up front (ARCHITECTURE §5.2)
- [ ] Non-trickle ICE gathering with timeout
- [ ] `payload.js`: `CC1.` compressed format plus a validation error for bad pastes
- [ ] Offer/answer flow wired to GENERATE_PAYLOAD / EXECUTE_CONNECT (the UI knows which role it is in)
- [ ] Connection state logs + selected candidate pair type (`host` / `srflx` / `relay`)
- [ ] Disconnect / reset button
- **Checkpoint:** two app instances on the same PC connect, then two PCs on different networks
  connect. The log reports the route.

## Phase 3 — Chat
- [ ] Message protocol envelope (ARCHITECTURE §9)
- [ ] Alias (saved locally), terminal-style lines: `[ NEO ] > hello`
- [ ] `textContent` only, size limits, Enter to send, auto-scroll
- **Checkpoint:** chat both ways. Pasting `<img src=x onerror=alert(1)>` shows up as plain text.

## Phase 4 — In-band negotiation
- [ ] Perfect negotiation over the `control` channel
- [ ] Automatic ICE restart on `disconnected`/`failed` (e.g. Wi-Fi switch)
- [ ] Heartbeat ping → RTT in the log
- **Checkpoint:** toggle Wi-Fi off and on on one side. The call recovers without a new copy-paste.

## Phase 5 — Voice
- [ ] Mic device list, hot-swap, MIC_SRC dropdown
- [ ] TOGGLE_MIC, DEAFEN (Discord semantics), state synced to the peer's card icons
- [ ] Speaking indicator on L / R cards
- [ ] Settings: echo cancellation / noise suppression / AGC toggles, "music mode"
- **Checkpoint:** a real voice call, with mute/deafen visible on both sides.

## Phase 6 — Screen share + system audio
- [ ] Main process source list + terminal-styled source picker
- [ ] `setDisplayMediaRequestHandler` → `getDisplayMedia`
- [ ] `replaceTrack` on the pre-made video transceiver, plus stop sharing
- [ ] Quality preset (text vs. motion), bitrate cap
- [ ] `[FULL]` and `[ PIP ]` (native PiP first)
- [ ] **Spike:** system audio loopback without echoing the peer's voice (ARCHITECTURE §7)
- **Checkpoint:** share a window, then switch to the full screen. Watch it in PiP. Share a YouTube
  video with sound, and the peer does not hear their own voice echoed back.

## Phase 7 — Settings, TURN, privacy
- [ ] Settings modal: STUN list, TURN (url/user/pass), relay-only toggle
- [ ] `safeStorage` encrypted persistence via IPC
- [ ] TEST_TURN button
- [ ] Stats readout (RTT, bitrate, packet loss, route)
- [ ] coturn setup guide in README
- **Checkpoint:** with relay-only on, the route is `relay` and the peer's log shows only the TURN IP.

## Phase 8 — Verification code
- [ ] SAS words from DTLS fingerprints, shown after connect
- **Checkpoint:** both sides see the same code. If the payload is tampered with by hand, the
  connection fails or the codes differ.

## Phase 9 — Polish
- [ ] Final window size (960×600 target), no scroll
- [ ] Error messages for every failure path (no mic, permission denied, bad payload, ICE failed)
- [ ] Keyboard shortcuts (e.g. mic toggle)
- [ ] README: screenshots, honest security section, usage guide

## Phase 10 — Release
- [ ] electron-builder NSIS installer, app icon, version 1.0.0
- [ ] GitHub Release with the `.exe` and checksums
- [ ] Note: the build is unsigned, so Windows SmartScreen will warn. Document "More info → Run anyway".

---

## Later (v2+)

- **Room-code signaling** (no copy-paste): exchange the offer/answer through public relays we
  don't run (e.g. Nostr), encrypted with a key derived from a short room code.
  Plugs into the signaling interface from ARCHITECTURE §5.3.
- **Group calls (3–4, mesh)**: more `PeerSession`s in the map. Realistically this needs room-code
  signaling first, because copy-pasting with 3 people means 3 separate exchanges, and with 4 it
  means 6.
- P2P file transfer over a DataChannel
- Camera
- Linux / macOS builds
- Localisation

## Open decisions (to discuss)

1. **Signaling for v1:** manual copy-paste only (recommended, zero dependencies, easiest to debug)
   vs. adding room codes in v1.
2. **Groups:** recommended plan is that the v1 architecture supports them, v1 UI ships 1:1,
   and groups arrive together with room-code signaling.
