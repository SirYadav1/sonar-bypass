# CubixMC Sonar Pass

A verification script that gets a Minecraft account past the Sonar anti-bot layer
and into the real game on CubixMC (play.cubixmc.fun).

## What is in here

- `verify-pass.js` — the script. Run it and it handles the full handshake,
  logs in, and proves spawn with a chat message.
- `research.md` — how Sonar verification works on the wire.
- `main.md` — stage-by-stage bypass notes and the fixes for each error we hit.
- `resources/` — the debugging plugin we built for the Sonar proxy, plus the
  packet-logger mod we used to capture real client traffic.

## How to run

```
USERNAME=your_account PASS=your_password node verify-pass.js
```

Use a clean IP per attempt. On CubixMC you get a few tries per address before it
asks you to wait, so rotate the address between runs.

## What we tested on

- CubixMC (public server, CubixProxy + Sonar-style checks)
- Two private Sonar test servers we control
- A VPS with rotating addresses

All three passed with the same approach.

## The tooling

The `resources/sonar-debug-plugin` folder is a stripped-down Sonar proxy build
with packet logging turned on. It shows every packet Sonar sends during verification,
including the ones with non-standard IDs that the normal protocol library hides.

The `resources/packet-logger-2.0.4.jar` is a Fabric mod that logs packets from
inside a real Minecraft client. We used it to record exactly what a legitimate
client sends during verification, then copied those reply bytes into verify-pass.js.
