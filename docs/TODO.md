# CryptChat — TO DO

The working backlog, **in the order we do it**. Take the first open `[ ]` item from the top,
finish it, tick it, move on. Finished phases and their history are in [ROADMAP.md](ROADMAP.md).

Decisions already taken:
- Rendezvous for contacts (v0.2) uses **public Nostr relays** (2026-10-16). It is opt-in per
  contact, and copy-paste always stays available as a fallback.
- Code signing (SignPath Foundation) is **deferred**; see the last section.

Legend: `[ ]` open · `[~]` in progress · `[x]` done

---

## 1. Foundation

- [x] **Tests in the repo.** Two-window e2e tests (connect, chat, negotiation, voice, verify,
      files, settings, screen, system audio, TURN) and unit tests under `test/`, `npm test`, and
      a CI workflow that runs them on every push. They already caught two real bugs (lost `bye`
      on a busy link, mic re-opened after a call)
- [ ] **Watch:** `files.test.js` failed once (2026-10-16) with "Object has been destroyed" in a
      full run, then passed in 3 full rounds + 5 single runs. The harness now logs renderer
      crashes, window closes and hangs, so the next occurrence shows the cause
- [ ] **Dependabot** for npm and GitHub Actions. Electron ships security fixes every few weeks,
      and an outdated Electron is the app's biggest risk
- [ ] **Single-instance lock.** A second launch with the same profile focuses the first window
      instead of sharing its settings and storage (`--profile=x` stays as the dev escape hatch)
- [ ] **Lazy mic probe.** Today the mic opens briefly at boot just to read device names. Do it on
      the first call or when MIC_SRC is opened

## 2. Small gaps (forgotten in v0.1)

- [x] **Output device selection** (speakers / headset, `setSinkId`): AUDIO_OUT next to MIC_SRC
- [x] **Volume sliders**: peer voice on the remote card, SYS_VOL over the feed while the peer
      shares with sound
- [x] **Notifications:** synthesized cyberpunk sounds (message / link down / system / UI),
      highlights that stay lit until seen, taskbar flash in the background, settings + TEST
      buttons. (Windows toast pop-ups were not added; the taskbar flash covers "look here")
- [x] **Source switch while sharing:** SWITCH / STOP split the share button; the picker opens
      with the live source preselected, and the viewer's feed cuts over without a gap
- [ ] **COPY_LOG** button: copies the KERNEL_LOG with IPs and payloads masked, for bug reports
- [x] **NAT check:** [ NAT_CHECK ] in the CONNECTION_MATRIX header says upfront whether the
      network needs TURN (cone / symmetric / UDP blocked from two STUN servers; CGNAT and public
      IPv6 noted). The left column grew to 480px for it, the minimum window to 1106×563
- [ ] **Error messages** for every failure path (no mic, permission denied, bad payload, ICE
      failed, TURN refused), reviewed end to end
- [ ] **Keyboard shortcuts:** mic toggle, deafen, **push-to-talk** (global hotkey), and a **panic
      key** (mute everything + hide the window)
- [ ] **Mic test** before a call (hear yourself, see the level)

## 3. v0.2 — Contacts + automatic reconnect ("fixed payload" idea)

Pair once, then reconnect any time without copy-pasting. A literally fixed payload cannot
work, because each offer carries one-time ICE credentials, a per-session certificate and the
current NAT ports. What *can* be fixed is who you talk to and where you meet:

- [ ] **Persistent identity:** one DTLS certificate per install
      (`RTCPeerConnection.generateCertificate`, kept in IndexedDB), so the fingerprint is stable
- [ ] **Pairing:** after MATCH, "Save as contact". Inside the verified tunnel, store the peer's
      fingerprint, an alias and a random 256-bit shared secret
- [ ] **Auto-verify (trust on first use):** a known fingerprint means verified at once. A
      changed fingerprint shows a loud warning
- [ ] **Rotating rendezvous over Nostr:** `topic = HMAC(secret, period)` with a per-contact period
      of **hourly / daily / weekly**. Offers and answers are exchanged there, encrypted with the
      secret, over several public relays. Outsiders cannot link two meetings
- [ ] **Contacts UI:** list, CALL button, online hint, rename, delete, change period
- [ ] Settings: relay list (defaults + custom), opt-in toggle, explanation of what relays can see
      (encrypted blobs and the client IP)

## 4. v0.3 — Group calls (3–4 people)

- [ ] Full mesh: one `PeerSession` per pair (the code is already built around this)
- [ ] Group rendezvous via v0.2 (copy-paste for 4 people would mean 6 exchanges)
- [ ] UI: a remote card per peer, chat to all, files to a chosen peer
- [ ] Verification: one SAS per pair, or a group code over all fingerprints
- [ ] Upload budget: lower the share bitrate per extra viewer (one share to 3 viewers = 3× upload)

## 5. Smaller ideas (any order)

- [ ] **Images in chat:** paste/drop an image and see a preview inline (uses the file channel)
- [ ] **Pointer / annotation** on a shared screen: the viewer points or draws on top (no remote
      control, so it stays safe)
- [ ] **Data saver** preset for mobile links (lower resolution/fps caps, voice first)
- [ ] **Shorter payloads** (strip unused SDP lines) and a **QR code** option
- [ ] **Portable mode:** a zip with settings next to the exe, no install
- [ ] **Update check**, opt-in only (it would be another outbound request)
- [ ] Better noise suppression (RNNoise-class model in an AudioWorklet)
- [ ] Opt-in, encrypted local chat history
- [ ] README screenshots

## 6. Waiting for a two-PC test session (you + a friend)

Works in automated tests; still needs real networks. Do these whenever a test session happens.

- [ ] Screen share on mobile data / TURN: read the `TX … LIMIT:` and `RX … LOSS` lines. If it is
      bandwidth: faster bitrate ramp-up and resolution presets
- [ ] System audio: share a YouTube video, check the peer does **not** hear their own voice
- [ ] Wi-Fi off/on for a few seconds: the call recovers without new payloads
- [ ] File transfer over TURN (speed, cancel, a multi-GB file)
- [ ] RELAY_ONLY with Cloudflare TURN: the peer only sees the relay route
- [ ] Installer on a PC without Smart App Control (the SmartScreen "Run anyway" path)

## 7. Deferred

- [ ] **Code signing** via SignPath Foundation (free for open source). Without it, Smart App
      Control blocks the installer. See [RELEASING.md](RELEASING.md)
- [ ] Version 1.0.0
- [ ] Camera
- [ ] Linux / macOS builds
- [ ] Localisation
