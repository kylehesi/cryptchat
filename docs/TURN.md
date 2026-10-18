# Running your own TURN relay (coturn)

CryptChat connects peers directly. Some networks make that impossible: mobile carriers and
many ISPs use **CGNAT**, and some offices block UDP. A **TURN relay** forwards the (still
end-to-end encrypted) traffic in those cases. **RELAY_ONLY** mode also uses it to hide your IP
from the peer.

CryptChat ships **no TURN credentials**. There are two options:

- **Cloudflare TURN** (easiest, no server to run). See below.
- **Your own coturn server** on a small VPS (€4–5/month is plenty for a few people), sections 1–5.

Not sure whether you need it? **NAT_CHECK** (next to GENERATE_PAYLOAD) asks two STUN servers for
your public address: the same public port for both (cone NAT) means a direct link should work,
a different port per server (symmetric NAT) or no answer at all (UDP blocked) means TURN.
Even between two cone NATs, the peer must inject the ANSWER within **HOLD_OPEN** (Settings →
NETWORK, default 2 min), or the answering side's NAT closes again.

Only **one** side needs TURN to get through CGNAT. With RELAY_ONLY, the side that wants to
hide its IP needs it.

## Cloudflare TURN

1. In the Cloudflare dashboard, open **Realtime → TURN Server** and create a TURN key.
   You get a **Turn Token ID** and an **API Token**. Check Cloudflare's current pricing page
   for the free allowance.
2. In CryptChat: `[ ⚙ ]` → NETWORK → **CLOUDFLARE_TURN**: paste the Turn Token ID into
   `TURN_KEY_ID` and the API token into `API_TOKEN`.
3. Press **TEST_TURN**, then **SAVE**.

How it works: Cloudflare does not hand out fixed TURN passwords. Before each link, CryptChat's
main process calls Cloudflare's `generate-ice-servers` API with your key and gets credentials
that are valid for 24 h (cached and reused). The key and token are stored encrypted with
Windows DPAPI. Anyone who has them can use your TURN quota, so do not share them. Give
your friend their own key, or let only one side use TURN.

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

