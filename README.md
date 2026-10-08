<p align="center"><img src="assets/logo.png" alt="CryptChat logo" width="520"></p>

# CryptChat

Peer-to-peer voice, screen sharing and chat for Windows. No accounts, no backend, no middleman.

> **Status:** pre-release (v0.1). Works end to end; being tested between real PCs.
> See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requirements: Windows 10/11, [Node.js LTS](https://nodejs.org), [Git](https://git-scm.com).

```bat
git clone https://github.com/kylehesi/cryptchat.git
cd cryptchat
start.cmd
```

`start.cmd` installs the dependencies on the first run and then launches the app. You can also
run `npm install` once and `npm start` afterwards.

There is no installer yet. That comes with v1.0.

## How it works

1. You click **GENERATE_PAYLOAD** and send the code to your friend through any channel.
2. Your friend pastes it, clicks **EXECUTE_CONNECT**, and sends back their answer code.
3. You paste the answer and click **EXECUTE_CONNECT**. A direct, encrypted WebRTC tunnel opens.
4. Read the **VERIFY_CODE** aloud to each other. If it matches, nobody is in the middle.

From then on, voice, screen (with system audio) and chat travel directly between the two PCs.
The in-app **[ ? ]** button has the full guide.

Most home networks connect directly. If both sides are behind strict NATs (mobile data, some
ISPs' CGNAT), a **TURN relay** is needed. Add a Cloudflare TURN key or your own coturn server
under **[ ⚙ ] → NETWORK**. See [docs/TURN.md](docs/TURN.md). Traffic stays end-to-end encrypted
through the relay.

## Security, honestly

- All traffic is encrypted (WebRTC DTLS-SRTP). There is no unencrypted mode.
- By default **your peer can see your public IP address**. Enable **RELAY_ONLY** to hide it.
- Compare the **verification code** aloud to make sure nobody tampered with the payloads.
- Settings (including TURN secrets) are encrypted on disk with Windows DPAPI.
- CryptChat is **not** an anonymity tool.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech

Electron · WebRTC · vanilla JavaScript (ES modules) · no UI framework.

## License

GPL-3.0
