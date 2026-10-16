# CryptChat — Release notes

What changed in each version, newest first. Versions follow `MAJOR.MINOR.PATCH`: every commit
bumps PATCH, and a bigger milestone bumps MINOR. Dates are YYYY-MM-DD.

| Version | Date | In one line |
|---|---|---|
| [**v0.2.0**](#v020--quality-of-life) | 2026-10-16 | Speaker choice, volume sliders, notifications with sounds, switch the shared screen live |
| [v0.1.2](#v012--test-suite) | 2026-10-16 | Test suite + CI; two bugs fixed (lost goodbye, mic re-opening) |
| [v0.1.1](#v011--sharper-screen-share) | 2026-10-15 | AV1 screen share: twice the frame rate on slow links; live stats |
| [v0.1.0](#v010--first-pre-release) | 2026-10-15 | First pre-release: calls, chat, screen, files, TURN, verification |

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
