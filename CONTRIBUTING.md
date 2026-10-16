# Contributing to CryptChat

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Before you start

- **Bugs and ideas:** open an issue using the templates.
- **Security problems:** do not open an issue. See [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first, so we can agree on the approach before you write code.

## Development setup

Requirements: Windows 10/11, [Node.js LTS](https://nodejs.org), Git.

```bat
git clone https://github.com/kylehesi/cryptchat.git
cd cryptchat
npm install
npm start
```

Use `npm run start:b` to open a second, independent instance on the same PC, so you can connect
the app to itself. Press **F12** in a development build for DevTools. `window.__cc` exposes the
live objects there.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It explains how the parts fit together.

## Tests

```bat
npm test            :: unit + all end-to-end tests
npm run test:unit   :: a few seconds, plain Node
npm run test:e2e    :: two real app windows talking to each other
node test/run.js files chat   :: only the e2e files whose name contains "files" or "chat"
```

- `test/unit/*.test.mjs`: pure functions (protocol, sanitizers, SAS, SDP edits, validators).
- `test/e2e/*.test.js`: each file boots the real app plus a second window as the peer, with a
  throwaway profile and Downloads folder, and fake microphones. Your real settings are never
  touched. Shared helpers are in `test/e2e/harness.js`.
- `*.local.test.js` need real desktop capture (screen share) or a local TURN server
  (`npm install --no-save node-turn`). CI skips them; run them locally before touching those areas.
- GitHub Actions runs the unit and the non-local e2e tests on every push and pull request.

## Code style

- Plain JavaScript with ES modules, no UI framework, no bundler.
- `net/`, `media/`, `chat/`, `security/` and `transfer/` never touch the DOM. `ui/` never touches
  `RTCPeerConnection`.
- Everything that comes from the peer is untrusted. Render it with `textContent`, validate
  sizes and types.
- Keep the renderer sandboxed. New OS access goes through a small, explicit preload API and is
  validated in the main process.
- All user-facing text is in English.

## Pull requests

- Keep each PR focused on one thing.
- Run `npm test` and describe what else you tested (ideally two PCs).
- By contributing, you agree that your contribution is licensed under the
  [GPL-3.0](LICENSE), like the rest of the project.
