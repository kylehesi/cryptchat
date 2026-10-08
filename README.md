# CryptChat

Peer-to-peer voice, screen sharing and chat for Windows. No accounts, no backend, no middleman.

> **Status:** being rebuilt from scratch. Nothing works yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## How it works (planned)

1. You click **GENERATE_PAYLOAD** and send the code to your friend through any channel.
2. Your friend pastes it and sends back their answer code.
3. You paste the answer and click **EXECUTE_CONNECT**. A direct, encrypted WebRTC tunnel opens.

From then on, voice, screen and chat travel directly between the two PCs. If a direct route is
impossible (strict NAT / CGNAT), traffic goes through a TURN relay **you** configure, and it stays
end-to-end encrypted even then. See [docs/TURN.md](docs/TURN.md) for a 5-minute coturn setup.

## Security, honestly

- All traffic is encrypted (WebRTC DTLS-SRTP). There is no unencrypted mode.
- By default **your peer can see your IP address**. Enable relay-only mode to hide it.
- Compare the **verification code** aloud to make sure nobody tampered with the codes you exchanged.
- CryptChat is **not** an anonymity tool.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech

Electron · WebRTC · vanilla JavaScript (ES modules) · no UI framework.

## License

GPL-3.0
