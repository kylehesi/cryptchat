# Releasing CryptChat

## Build an installer

```bat
npm run dist
```

This writes `dist\CryptChat-Setup-<version>.exe`. The installer:

- installs **per user** into `%LOCALAPPDATA%\Programs\CryptChat` and **never asks for
  administrator rights** (no UAC prompt),
- lets the user pick the folder, shows the MIT license, and creates Start menu and
  desktop shortcuts,
- keeps the user's settings on uninstall.

Release builds are made by GitHub Actions ([.github/workflows/release.yml](../.github/workflows/release.yml)):

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow builds the installer and creates a **draft** release with the `.exe` and
   `SHA256SUMS.txt`. Check it, then press *Publish*.

## Why Windows warns, and how to stop it

Windows trusts installers by their **code signature**. Today CryptChat's builds are
**unsigned**, which has two effects:

| Windows feature | Unsigned installer |
|---|---|
| SmartScreen ("Windows protected your PC") | Warning; the user can click *More info → Run anyway* |
| **Smart App Control** (Windows 11, on by default on new installs) | **Blocked outright.** The user cannot override it |

No setting in the app or installer can avoid this. Only a signature from a certificate that
Windows trusts can. Until releases are signed, users with Smart App Control can run CryptChat
from source with `start.cmd`. That runs the official, signed Electron runtime and works fine.

### Option A: SignPath Foundation (free for open source, recommended)

[SignPath Foundation](https://signpath.org) signs open-source projects for free with its own
trusted certificate (the publisher shown is "SignPath Foundation").

Requirements, from [their conditions](https://signpath.org/terms):
- an OSI-approved license (MIT qualifies),
- a public repository,
- builds produced by CI from the repository (this workflow),
- a code signing policy published on the project page.

Steps:
1. Apply at [signpath.org/apply](https://signpath.org/apply.html).
2. After acceptance, add the secret `SIGNPATH_API_TOKEN` and the variable `SIGNPATH_ORGANIZATION_ID`
   in *Settings → Secrets and variables → Actions*.
3. Extend the workflow with SignPath's action
   ([docs](https://docs.signpath.io/trusted-build-systems/github)). Everything Windows runs must be
   signed, not just the setup file. Smart App Control also checks `CryptChat.exe` and the
   uninstaller. Use the order **app files → installer → installer**:
   - `electron-builder --dir` → sign `CryptChat.exe` (and DLLs) in `dist/win-unpacked`,
   - `electron-builder --prepackaged dist/win-unpacked` with a custom `win.sign` hook so the
     uninstaller is signed during the build,
   - sign the final `CryptChat-Setup-*.exe`.

### Option B: Microsoft Store

Individual developer accounts are free. The Store signs and hosts the app (MSIX package via
electron-builder's `appx` target), and installs from the Store do not show SmartScreen
prompts. This is a different distribution channel, with Store review and Store updates.

### Option C: buy a certificate

An OV code-signing certificate costs roughly $200–400/year and needs identity validation.
SmartScreen reputation still builds up over the first downloads. (Microsoft's own
*Artifact Signing* service is only open to individuals in the USA and Canada.)
