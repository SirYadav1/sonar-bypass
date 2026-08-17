# Sonar Bypass — Stage by Stage

This is the short practical guide — each stage with what broke and the fix. For the
full packet-by-packet write-up with exact byte values, read research.md. That file
explains how Sonar verification actually works on the wire and how we got every
stage to pass.

The fixes here are what make verify-pass.js work.


## Stage 1 — Login

Sonar waits for the normal login flow: TCP connect, handshake, login start,
compression, login success. Nothing special here, the standard library handles it.

Fix note: use `version: '26.1'` for CubixMC. If you use a generic version string
the config packet IDs will not match and you will silently fail later.


## Stage 2 — Config Handshake

After login success, Sonar sends a config phase: registry data, resource pack,
client information request. You must answer:

- client_information (settings) — send locale, view distance, skin parts.
- brand — send "vanilla" or any string.
- resource_pack — reply ACCEPTED, then DOWNLOADED, then LOADED after a short delay.
- finish_configuration — reply empty, this moves you to PLAY.

Fix note: the resource pack must be answered in three steps with delays. If you
send LOADED instantly, Sonar thinks the pack was never fetched and fails you.


## Stage 3 — Gravity

In PLAY, Sonar teleports your entity to a platform and watches it. It expects:

- A few position packets that show you "priming" the fall (slightly different Y each).
- After ~8 ticks, a landing packet with onGround=true at the right block height.

Fix note: the priming packets MUST have different byte values. Sonar deduplicates
identical frames, so if all three priming packets are byte-identical it ignores
them and the gravity check never completes. We used spawnY+0.0001 then spawnY
exactly so the bytes differ but the motion still reads as falling.

Fix note: the landing Y is (spawnY - 4) + blockHeight. blockHeight comes from the
multi_block_change stateId. Get that wrong and you "land" in mid-air and fail.


## Stage 4 — Protocol

Sonar sends custom packets. From the raw capture these were:

- clientbound transaction (id 53 in 1.21.1) — reply serverbound transaction (id 39)
  with the same int32 id.
- held_item_slot (id 47) — echo it back as a short.
- animation (id 54) — reply with varint 0 (swing arm).

Fix note: minecraft-protocol does NOT decode id 53, so you never see it through
the normal event system. You have to parse the raw socket. verify-pass.js does
this with readVarIntOff and replies directly to client.socket.

Fix note: block the library's automatic pong, transaction, and brand replies. If
both your raw handler and the library send a reply, Sonar gets two answers and
drops you.


## Stage 5 — Vehicle

Sonar spawns a boat, then a minecart. The state machine is driven by keepalives:

- WAITING — wait for the vehicle spawn.
- IN_BOAT — send 3 VehicleMove packets, then PaddleBoat + Rotation + PlayerInput.
- air — small position update.
- IN_MINECART — same as boat but for the cart.
- done — finishVerification fires.

Fix note: the boat has gravity. Its motion comes from the teleport Y1 value with
dm = -0.04 per tick. If you send a static position, the boat "floats" and the
check fails. Match the motion chain from the capture.


## Common Errors and Fixes

| Error seen | Cause | Fix |
|------------|-------|-----|
| "Authorization time is up" | Took too long in limbo | Send /login the moment the prompt appears, no delay |
| "kicked from lobby" right after join | start_configuration not answered | Reply configuration_acknowledged (0x10) on raw socket |
| Silent fail at protocol stage | Library hides id 53 | Parse raw socket, reply transaction yourself |
| Gravity never completes | Identical priming frames | Make byte values differ between priming packets |
| Double-reply disconnect | Both raw + library answer | Block library auto-replies for those packets |
| Resource pack fail | LOADED sent too fast | Add 300ms + 1500ms delays between ACCEPTED/DOWNLOADED/LOADED |


## The Packet Logger

To capture all of this we built a Fabric client mod (resources/packet-logger-2.0.4.jar).
It sits inside your real Minecraft client and logs every packet with its real ID
and state. Unlike server-side captures, this shows you exactly what a legitimate
client sends during Sonar verification, which is how we copied the reply bytes.

The mod writes to .minecraft/logs/packet-log-YYYY-MM-DD.txt, one file per day.
It tags each line with the connection state (login / config / play) so you can
see which phase a packet belongs to.


## How We Verified

We tested on CubixMC and on two private Sonar servers we run. The same raw-socket
approach passed all three. The debugging plugin in resources/ was the key tool —
without it we were guessing the protocol packet IDs.
