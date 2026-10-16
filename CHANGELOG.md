# Changelog

All notable changes to CryptChat. Versions follow `MAJOR.MINOR.PATCH`: every commit bumps
PATCH, bigger milestones bump MINOR. Dates are YYYY-MM-DD.

## [0.1.2] - 2026-10-16

### Added
- **Test suite in the repo:** `npm test` runs unit tests (protocol, sanitizers, SAS, SDP edits,
  validators) and two-window end-to-end tests (connect, chat, renegotiation, voice,
  verification, files, settings), plus local-only screen, system-audio and TURN tests.
  GitHub Actions runs them on every push and pull request.
- [docs/TODO.md](docs/TODO.md): the ordered backlog.

### Fixed
- TERMINATE_LINK during a busy transfer: the goodbye message could be dropped, so the peer
  only noticed after the 30 s "link lost" timeout. The link now closes once `bye` has left.
- Changing a mic setting right before a call ended could re-open the microphone after the call.
  Stale captures are now discarded.

## [0.1.1] - 2026-10-15

### Changed
- **Screen share quality:** codecs are now negotiated in the order AV1 → VP9 → VP8 → H.264
  (was: VP8). At 1 Mbps the same text stays at 30 fps instead of 14, and motion keeps full
  resolution. Measurements in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §8.

### Added
- AUTO codec mode: when the encoder is CPU-bound for about 6 s, it steps down AV1 → VP9 → VP8
  without reconnecting.
- Settings → VIDEO → SCREEN_CODEC to pin a codec. It applies immediately, even mid-broadcast.
- Live TX/RX stats over the screen feed (codec, resolution, fps, bitrate, limit, loss).
- App version in the KERNEL_LOG boot line and in the HOW_TO_USE dialog. This changelog.

## [0.1.0] - 2026-10-15

First pre-release.

- Copy-paste connection (compressed `CC1.` payloads), no servers of our own.
- Encrypted chat with aliases.
- Voice: mic selection, mute and deafen, speaking indicator, DSP settings.
- Screen share with a source picker, echo-free system audio (stereo, 128 kbps), PiP and
  fullscreen.
- Automatic recovery (in-band renegotiation, ICE restart) and live link stats.
- TURN: Cloudflare (credentials minted per link) or a custom coturn server, RELAY_ONLY mode,
  TEST_TURN. Settings are encrypted with DPAPI.
- Verification code (SAS) from the DTLS fingerprints, with an explicit tamper warning.
- File transfer: accept/decline, no size limit (streamed to disk), safe file names,
  Mark-of-the-Web.
- Windows installer (per-user, no UAC prompt), release workflow, community files.
