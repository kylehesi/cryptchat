# Security Policy

CryptChat is a privacy tool, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**Security → Report a vulnerability** on this repository
([private vulnerability reporting](https://github.com/kylehesi/cryptchat/security/advisories/new)).

Include what you found, how to reproduce it, and what an attacker could do with it. You will
get an answer as soon as possible. Once a fix is released, the report can be published with
credit to you, if you want.

## Scope

Especially interesting:

- anything that breaks the encryption or the verification code (SAS),
- ways for a peer to run code, read files or write outside `Downloads\CryptChat`,
- leaks of the IP address in RELAY_ONLY mode,
- leaks of stored secrets (TURN credentials, Cloudflare API token).

What CryptChat does and does not protect against is described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ("Honest security model").

## Supported versions

Only the latest release receives fixes.
