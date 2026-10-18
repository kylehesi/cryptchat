<p align="center"><img src="assets/logo.png" alt="CryptChat logo" width="520"></p>

# CryptChat

[![Version](https://img.shields.io/github/package-json/v/kylehesi/cryptchat?label=version&color=00ff00)](CHANGELOG.md)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

Peer-to-peer voice, screen sharing, file transfer and chat for Windows. No accounts, no
backend, no middleman.

> **Status:** pre-release. Works end to end; being tested between real PCs.
> 📋 **[Release notes](CHANGELOG.md)**: what is new in each version · What is next: [docs/TODO.md](docs/TODO.md).

## Install

### Installer

Download `CryptChat-Setup-<version>.exe` from [Releases](https://github.com/kylehesi/cryptchat/releases)
and run it. The installer is per user and never asks for administrator rights.

> **Builds are not code-signed yet.** Windows will show *"Windows protected your PC"*: click
> **More info → Run anyway**. On PCs with **Smart App Control** turned on (Windows 11),
> unsigned apps are blocked and cannot be allowed. Use the source version below until signed
> builds are available ([why](docs/RELEASING.md#why-windows-warns-and-how-to-stop-it)).

### From source (works everywhere, including Smart App Control)

Requirements: Windows 10/11, [Node.js LTS](https://nodejs.org), [Git](https://git-scm.com).

```bat
git clone https://github.com/kylehesi/cryptchat.git
cd cryptchat
start.cmd
```

`start.cmd` installs the dependencies on the first run and then launches the app. You can also
run `npm install` once and `npm start` afterwards. To build the installer yourself, run
`npm run dist` (see [docs/RELEASING.md](docs/RELEASING.md)).

## How it works

1. You click **GENERATE_PAYLOAD** and send the code to your friend through any channel.
2. Your friend pastes it, clicks **EXECUTE_CONNECT**, and sends back their answer code.
3. You paste the answer and click **EXECUTE_CONNECT**. A direct, encrypted WebRTC tunnel opens.
4. Read the **VERIFY_CODE** aloud to each other. If it matches, nobody is in the middle.

From then on, voice, screen (with system audio), files and chat travel directly between the
two PCs. The in-app **[ ? ]** button has the full guide.

Most home networks connect directly. If both sides are behind strict NATs (mobile data, some
ISPs' CGNAT), a **TURN relay** is needed. Add a Cloudflare TURN key or your own coturn server
under **[ ⚙ ] → NETWORK**. Not sure? Press **NAT_CHECK** before exchanging payloads: it tells
you whether your network can connect directly or needs TURN. See [docs/TURN.md](docs/TURN.md). Traffic stays end-to-end encrypted
through the relay.

## Security, honestly

- All traffic is encrypted (WebRTC DTLS-SRTP). There is no unencrypted mode.
- By default **your peer can see your public IP address**. Enable **RELAY_ONLY** to hide it.
- Compare the **verification code** aloud to make sure nobody tampered with the payloads.
- Files are only saved after you accept them, into `Downloads\CryptChat`.
- Settings (including TURN secrets) are encrypted on disk with Windows DPAPI.
- CryptChat is **not** an anonymity tool.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Found a vulnerability? See
[SECURITY.md](SECURITY.md).

## Tech

Electron · WebRTC · vanilla JavaScript (ES modules) · no UI framework.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

CryptChat is free software under the [GNU General Public License v3.0](LICENSE).

The installer bundles [Electron](https://www.electronjs.org) (MIT) and Chromium, whose
licenses ship next to the app as `LICENSE.electron.txt` and `LICENSES.chromium.html`.
