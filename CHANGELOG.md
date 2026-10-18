# CryptChat — Release notes

What changed in each version, newest first. Versions follow `MAJOR.MINOR.PATCH`: every commit
bumps PATCH, and a bigger milestone bumps MINOR. Dates are YYYY-MM-DD.

| Version | Date | In one line |
|---|---|---|
| [**v0.2.3**](#v023--layout-polish) | 2026-10-18 | NAT_CHECK next to GENERATE_PAYLOAD, narrow left column again, larger minimum window |
| [v0.2.2](#v022--direct-links-through-nats) | 2026-10-18 | NAT_CHECK, HOLD_OPEN for direct links between home NATs, bigger window |
| [v0.2.1](#v021--privacy-mode) | 2026-10-17 | Hide IPs and payloads on screen (for streaming) |
| [v0.2.0](#v020--quality-of-life) | 2026-10-16 | Speaker choice, volume sliders, notifications with sounds, switch the shared screen live |
| [v0.1.2](#v012--test-suite) | 2026-10-16 | Test suite + CI; two bugs fixed (lost goodbye, mic re-opening) |
| [v0.1.1](#v011--sharper-screen-share) | 2026-10-15 | AV1 screen share: twice the frame rate on slow links; live stats |
| [v0.1.0](#v010--first-pre-release) | 2026-10-15 | First pre-release: calls, chat, screen, files, TURN, verification |

---

## v0.2.3 — Layout polish

*2026-10-18*

**Changed**
- **NAT_CHECK** moved from the CONNECTION_MATRIX header to the button row, next to
  GENERATE_PAYLOAD. The left column is back to its narrow 352px.
- The window can no longer be shrunk below 1100×660 (it opens at 1160×700). Only screens too
  small for that go lower, never below the old compact 978×563.

---

## v0.2.2 — Direct links through NATs

*2026-10-18*

**Highlights**
- Press **[ NAT_CHECK ]** before exchanging payloads to know whether you need TURN.
- Two home NATs now link directly even if the ANSWER takes a minute or two to come back
  (**HOLD_OPEN**). Before, that ended in "ICE failed" after ~15 s.

**Added**
- **[ NAT_CHECK ]** in the CONNECTION_MATRIX header: before exchanging payloads, it tells you
  whether your network can connect directly or needs TURN. Two STUN servers are asked for your
  public address from the same socket: the same port for both (cone NAT) is green, a different
  port per server (symmetric NAT) or no answer (UDP blocked) is red without TURN and yellow with
  it. CGNAT (100.64.x.x) and public IPv6 are mentioned too. The verdict goes to KERNEL_LOG and
  the button's tooltip.
- **HOLD_OPEN** (Settings → NETWORK, default 2 min, OFF / 30 s – 5 min): after you send your
  ANSWER, your side keeps checking the peer's addresses until they inject it, so your NAT stays
  open for them. Before, Chromium gave up after ~15 s, and if the peer pasted later, two home
  NATs that could link directly ended in "ICE failed". While it runs, an early ICE failure no
  longer ends the attempt; a DTLS (tampering) failure still does at once.
- **[×]** in the REMOTE_PAYLOAD box clears a pasted payload, also while HIDE_IP_AND_PAYLOAD
  hides it.

**Changed**
- Bigger window: it opens at 1160×700 (shrunk to fit small screens) and remembers its size,
  position and maximized state. The left column is 480px wide to fit the new button; the
  minimum is 1106×563, so the right side never gets narrower than before.

---

## v0.2.1 — Privacy mode

*2026-10-17*

**Highlights**
- Stream or screenshot the app safely: one switch hides your IP addresses and payloads.

**Added**
- **HIDE_IP_AND_PAYLOAD** (Settings → PRIVACY), for streaming or screenshots: payload boxes show
  `[ HIDDEN · n CHARS · CLICK TO COPY ]` and a click copies the real payload. IP addresses in
  KERNEL_LOG and status lines are masked, and the TURN address, user and Cloudflare key fields
  are dotted. Turning it off redraws everything, old log lines included.

**Fixed**
- "Payload copied" no longer reports success before the clipboard write has actually finished
  (Electron's clipboard API is asynchronous now).

---

## v0.2.0 — Quality of life

*2026-10-16*

**Highlights**
- Pick your **speakers or headset** (AUDIO_OUT), and set **the peer's voice** and **their
  shared sound** louder or quieter.
- **Notifications:** cyberpunk sounds, a glow on whatever changed until you look, and a flashing
  taskbar button while CryptChat is in the background.
- **SWITCH** what you share (e.g. browser → game) without stopping the broadcast.

**Added**
- **AUDIO_OUT** next to MIC_SRC. It applies to the peer's voice, their system audio and the
  notification sounds. The choice is remembered, and the app falls back to the default device
  if yours is unplugged.
- **Volume controls:** a slider for the peer's voice on their card, and **SYS_VOL** over the
  screen feed while the peer shares with sound. Both go 0–100%, are remembered, and are
  independent of DEAFEN.
- **Notifications:**
  - Four sounds, synthesized in the app (no sound files):
    - a soft chime for chat messages and incoming files,
    - a glitching alarm when the link drops,
    - bit-crushed data blips for system alerts (errors, warnings, link up/restored),
    - a short tick for every button, rising/falling for mic, deafen and screen share on/off.
  - The thing that triggered a notification glows until you look at the window, then fades
    after about 3 s. The taskbar button flashes while the app is in the background.
  - Your own actions (TERMINATE_LINK, your own cancel/decline) never sound an alarm. If several
    things happen at once, only the most important sound plays.
  - Settings → NOTIFICATIONS: event sounds, UI sounds, taskbar flash, FX volume, and a TEST
    button per sound.
- **Switch the shared source without stopping:** while sharing, the share button splits into
  **SWITCH** and **STOP**. SWITCH opens the picker with the live source marked `● LIVE` and your
  current audio/quality settings filled in. The viewer's feed cuts straight to the new window or
  screen, with no "broadcast stopped" in between.

**Changed**
- The test runner checks syntax first and kills a hung test file instead of waiting forever.
  Test windows now report crashes, closes and hangs.
- More robust voice and system-audio tests (sound vs. silence thresholds, relative echo check).

---

## v0.1.2 — Test suite

*2026-10-16*

**Highlights**
- Every push is now tested automatically, and the tests already caught two real bugs.

**Added**
- `npm test`: unit tests (protocol, sanitizers, verification code, SDP edits, validators) and
  two-window end-to-end tests (connect, chat, renegotiation, voice, verification, files,
  settings), plus local-only screen, system-audio and TURN tests. GitHub Actions runs them on
  every push and pull request.
- [docs/TODO.md](docs/TODO.md): the ordered backlog.

**Fixed**
- TERMINATE_LINK during a busy file transfer could drop the goodbye message, so the peer only
  noticed after the 30 s "link lost" timeout. The link now closes once `bye` has left.
- Changing a mic setting right before a call ended could re-open the microphone after the call.

---

## v0.1.1 — Sharper screen share

*2026-10-15*

**Highlights**
- Screen sharing now prefers **AV1**. On a slow (1 Mbps) link, text stays at 30 fps instead of 14,
  and motion keeps its full resolution.

**Changed**
- Codecs are negotiated in the order AV1 → VP9 → VP8 → H.264 (was: VP8 only).
  Measurements: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §8.

**Added**
- AUTO codec mode: if the encoder is CPU-bound for about 6 s, it steps down AV1 → VP9 → VP8
  without reconnecting.
- Settings → VIDEO → SCREEN_CODEC to pin a codec. It applies immediately, even mid-broadcast.
- Live TX/RX stats over the screen feed (codec, resolution, fps, bitrate, limit, loss).
- The app version is shown in the KERNEL_LOG boot line and in HOW_TO_USE. These release notes.

---

## v0.1.0 — First pre-release

*2026-10-15*

**Highlights**
- Peer-to-peer voice, screen sharing, file transfer and chat between two Windows PCs, with no
  accounts and no servers of our own.

**Included**
- Copy-paste connection (compressed `CC1.` payloads).
- Encrypted chat with aliases.
- Voice: mic selection, mute and deafen, speaking indicator, DSP settings.
- Screen share with a source picker, echo-free system audio (stereo, 128 kbps), PiP and
  fullscreen.
- Automatic recovery (in-band renegotiation, ICE restart) and live link stats.
- TURN: Cloudflare (credentials minted per link) or your own coturn server, RELAY_ONLY mode,
  TEST_TURN. Settings are encrypted with Windows DPAPI.
- Verification code (SAS) from the DTLS fingerprints, with an explicit tamper warning.
- File transfer: accept/decline, no size limit (streamed to disk), safe file names,
  Mark-of-the-Web.
- Windows installer (per-user, no UAC prompt), release workflow, community files.
