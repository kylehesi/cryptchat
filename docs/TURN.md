# Running your own TURN relay (coturn)

CryptChat connects peers directly. Some networks make that impossible: mobile carriers and
many ISPs use **CGNAT**, and some offices block UDP. A **TURN relay** forwards the (still
end-to-end encrypted) traffic in those cases. **RELAY_ONLY** mode also uses it to hide your IP
from the peer.

CryptChat ships **no TURN credentials**. Bring your own server. A €4–5/month VPS is plenty
for a few people.

> The relay never sees your content. Media and chat are DTLS-encrypted end to end, and TURN
> only forwards the encrypted packets. It does see both peers' IP addresses and how much data
> flows.

## 1. Server

Any small Linux VPS with a public IPv4 address. The steps below assume Debian/Ubuntu.

Open these ports in the provider's firewall **and** on the server:

| Port | Protocol | Purpose |
|---|---|---|
| 3478 | UDP + TCP | TURN |
| 5349 | TCP | TURN over TLS (optional; gets through strict firewalls) |
| 49152–65535 | UDP | relay ports |

## 2. Install

```bash
sudo apt update && sudo apt install -y coturn
```

## 3. Configure `/etc/turnserver.conf`

Replace `203.0.113.10` with your server's public IP, and pick a long random password.

```ini
listening-port=3478
tls-listening-port=5349
external-ip=203.0.113.10
realm=cryptchat
fingerprint
lt-cred-mech
user=cryptchat:CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD

min-port=49152
max-port=65535

# Do not let the relay be used to reach private networks or the server itself.
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
no-cli
```

For `turns:` on port 5349, add a certificate (e.g. from Let's Encrypt for a domain that points
at the server):

```ini
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

## 4. Start

```bash
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

## 5. Configure CryptChat

`[ ⚙ ]` → **NETWORK**:

- **TURN_URLS** (one per line):
  ```
  turn:203.0.113.10:3478?transport=udp
  turn:203.0.113.10:3478?transport=tcp
  turns:turn.example.com:5349
  ```
- **TURN_USER** / **TURN_PASS**: the `user=` values from the config.
- Press **TEST_TURN**. `TURN OK` means the relay works. `401 Unauthorized` means a wrong
  user or password. No answer at all usually means a firewall is blocking the port.
- Optional: **RELAY_ONLY** to hide your IP from the peer.
- **SAVE**. The settings are encrypted on disk with Windows DPAPI and apply to the next link.

Only **one** side needs a TURN server to get through CGNAT. With RELAY_ONLY, the side that
wants to hide its IP needs one.
