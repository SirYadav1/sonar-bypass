<p align="center">
  <img src="banner.png" width="100%" alt="Sonar Bypass Banner" />
</p>

<h1 align="center">Sonar Bypass</h1>

<p align="center">
  <strong>Pass Sonar 2.1.x anti-bot verification on Minecraft with a raw-socket Node script</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/Node.js-22-green?style=flat-square&logo=node.js" alt="Node" />
  <img src="https://img.shields.io/badge/Minecraft-26.1-purple?style=flat-square" alt="MC" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" />
</p>

---

## **What is This?**

Sonar sits in front of a Minecraft server and runs a verification sequence before letting a player into the lobby. This repo is a script that gets past that check using `minecraft-protocol` plus a raw socket hook — no captcha solving, no manual clicking.

It was built by watching real traffic (packet captures + a debug build of the Sonar proxy) and copying what a legit client does during each stage.

---

## **What's Inside**

| File | What it is |
|------|------------|
| `verify-pass.js` | The bypass script. Handles login, config, gravity / protocol / vehicle checks, then proves spawn with a chat message. |
| `research.md` | Packet-by-packet write-up of how Sonar verification works on the wire. |
| `main.md` | Stage-by-stage notes + the fix for every error we hit while building it. |
| `resources/Sonar-Paper.jar` | Prebuilt Sonar proxy with packet logging turned on. |
| `resources/packet-logger-2.0.4.jar` | Fabric mod that logs packets from inside a real MC client. |
| `LICENSE` | MIT. |

---

## **How to Run**

```bash
USERNAME=your_account PASS=your_password node verify-pass.js
```

Use a clean IP per attempt. The servers we tested on rate-limit per address, so rotate between runs.

---

## **How It Works (short version)**

Sonar runs five checks: login → gravity → protocol → vehicle → finish.

The protocol stage is where most bots fail — Sonar sends packets with IDs the standard library does not decode. This script reads the raw socket, replies to those hidden packets by hand, and copies the exact player motion a real client makes during the gravity and vehicle stages.

Full detail (with byte values) is in `research.md`.

---

## **Tested On**

- cubixmc — Indian server running Sonar in front of its lobby
- poormc — another Indian server with the same anti-bot layer
- two private Sonar servers we run

All passed with the same approach.

---

## **Is it safe to run?**

Yes. The script only opens a socket, sends packets, and reads replies. It does not touch your system, does not exfiltrate anything, and does not modify any files. You can read every line of `verify-pass.js` — there is no hidden behavior. If you want a second opinion, paste it into any AI or sandbox and ask what it does.

---

## **Note on Versions**

This targets **Sonar 2.1.x**, which uses the same verification flow (login → gravity → protocol → vehicle → finish) across the servers that run it. The packet IDs, block-height map, and gravity offset in this script match the Sonar 2.1.x build we tested against (cubixmc, poormc, and two private servers all passed). If a server runs a different Sonar version, the hidden packet IDs or the platform math may differ and would need adjusting — but the overall method is the same.

---

## **License**

MIT — see [LICENSE](LICENSE).
