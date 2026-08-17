# Sonar Verification — The Full Walkthrough

This is a Sonar bypass script we put together, and these are the full notes on how
it gets past the anti-bot layer. Every stage is written out with the exact packets
we send and the byte values that matter. The script that does all of this is
verify-pass.js — read that alongside this document.

We built this by watching real traffic. We ran the bot against a couple of Indian
servers (cubixmc, poormc) and against two private Sonar servers we control, and we
used a packet logger mod plus a debug build of the Sonar proxy to see what was
actually on the wire. Without those two tools we would have been guessing.


## The Connection Starts

You connect with minecraft-protocol, version 26.1, auth off, brand vanilla. The
handshake and login go through normally. After login success, Sonar does not drop
you into the world — it runs a config phase first.

In the config phase Sonar sends registry_data. The moment we see that packet we
send two things on the raw socket:

- client_information (packet id 0) with locale en_us, view distance 10, and the
  usual skin-part bitmask 0x7f.
- brand (packet id 2) about 30ms later, just the string "vanilla".

If you do not send these, Sonar never moves you forward.


## Resource Pack

Sonar pushes a resource pack. The client has to answer in three steps, and the
timing matters:

- send ACCEPTED right away
- send DOWNLOADED after ~300ms
- send LOADED after ~1500ms more

If you send LOADED instantly, Sonar thinks the pack was never fetched and fails
you. The script does this with the delays above.


## Finish Config

When Sonar sends finish_configuration, we reply with an empty packet (id 3) and
flip into PLAY state. From here every packet is handled by reading the raw socket,
because some of the IDs Sonar uses are not decoded by the library.


## Stage 1 — Gravity (the teleport priming)

Sonar teleports your player twice to set up a fall. The first teleport gives y1,
the second gives y2. We record both, then compute spawnY = y1 + y2.

Then we send the priming position packets. This part is easy to get wrong:

- priming #1: position at spawnY exactly, with tick_end after it.
- priming #2: position at spawnY + 0.0001
- priming #3: position at spawnY exactly again

The reason the second one is offset by 0.0001 is that Sonar deduplicates identical
frames. If all three priming packets are byte-for-byte the same, Sonar ignores them
and the gravity check never completes. The 0.0001 makes the bytes differ but the
motion still reads as "about to fall".


## Stage 2 — Gravity (the fall)

After the priming, we start a loop. Each tick (50ms) we apply gravity:

  dy = (dy - 0.08) * 0.98
  y = y + dy

We send the new position plus tick_end every tick. After 8 ticks we send the
landing packet: position at (spawnY - 4) + blockHeight, with onGround = true.

blockHeight comes from the multi_block_change packet (id 84). That packet carries
a stateId, and we map known stateIds to their heights:

  9451 -> 0.75    12582 -> 0.1875   9473 -> 0.8125
  11295 -> 0.375   9984 -> 1.5      13399 -> 0.5      12896 -> 0.0625

Get the height wrong and you "land" in mid-air and the check fails. If the stateId
is not in our map we default to 0.75.


## Stage 3 — Protocol (the hidden packets)

This is where almost every bot dies. Sonar sends packets with IDs that the standard
library does not decode. We catch them on the raw socket and reply by hand:

- clientbound transaction (id 61): read the int32 id, reply serverbound transaction
  (id 0x2d) with the same id. Only reply once per id — track lastTx so we do not
  echo the same one twice.
- swing animation (id 2): reply with animation (id 0x3f), body varint 0. This marks
  the protocol stage done.
- held_item_slot (id 105): echo the slot back as a short with packet id 0x35.

One trap: minecraft-protocol also tries to auto-reply to pong, transaction, brand,
keepalive and finish_configuration. We override client.write to swallow those, so
only our raw handler answers. If both the library and our handler reply, Sonar gets
two answers and drops the connection.


## Stage 4 — Vehicle (boat then minecart)

Once the protocol stage is done, Sonar's keepalives drive a vehicle state machine.
The phases are:

  WAITING -> IN_BOAT -> AIR_BOAT -> IN_MINECART -> AIR_MINECART -> done

For each vehicle (boat first, then minecart) we send:

- 3 VehicleMove packets (id 0x22) with the Y drifting down by 0.04 per packet. The
  drift comes from the first teleport Y (telY1). This mimics boat gravity.
- 3 rounds, spaced 150ms apart, of: PaddleBoat (id 0x23, bytes 01 01), Rotation
  (id 0x20, zero floats), and PlayerInput (id 0x2b, byte 01).

Between vehicles, on the AIR phases, we send one plain position packet so the
client is not frozen. When the minecart phase finishes, Sonar fires
finishVerification and the connection is let through.


## Keepalives Throughout

Every keepalive is answered. In config state we reply with packet id 4. In play
state we reply with packet id 0x1c, using the same 8-byte id Sonar sent (it can be
a long, so we write it as BigInt64). The protocol-stage keepalive also kicks the
vehicle state machine forward.


## What We Tested On

This is a Sonar bypass script we built and verified against a few different setups:

- cubixmc — an Indian Minecraft server that runs Sonar in front of its lobby.
- poormc — another Indian server using the same anti-bot layer.
- two private Sonar servers we run ourselves — used to watch the verification in
  isolation without hitting rate limits.

All of them passed with the same code. The public servers rate-limit per IP, so
each attempt there needs a fresh address; the private servers do not, which is how
we debugged the packet timing.


## The Tools That Made This Possible

resources/sonar-debug-plugin is a build of the Sonar proxy with packet logging
turned on inside the verification handler. It prints every packet Sonar sends during
a check, including the ones with non-standard IDs. That is how we learned the exact
reply bytes for the protocol and vehicle stages.

resources/packet-logger-2.0.4.jar is a Fabric mod that logs packets from inside a
real Minecraft client. We ran a legit client through CubixMC verification with it
installed, then read the log to copy the exact bytes a human player sends. Those
bytes are what verify-pass.js reproduces.

See main.md for the short stage list and the fix for each error we hit along the way.
