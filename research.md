# Sonar Verification — How It Actually Works

Sonar is an anti-bot layer that sits in front of a Minecraft server. Before a real
player is let into the game, Sonar puts the connection through a set of checks.
If any check fails, the connection is dropped and you never reach the lobby.

This document explains what Sonar does on the wire so you can build something that
passes it. Everything below comes from watching real packet captures and from
running test clients against Sonar-protected servers.


## The Big Picture

When you connect, you are NOT talking to the real Minecraft server right away.
You are talking to Sonar. Sonar speaks the same Minecraft protocol, but instead of
spawning you in the world, it runs a scripted verification sequence. Only after
that sequence completes does Sonar hand you off to the backend server.

The handoff is done with a `start_configuration` packet. That packet tells the
client "we are done verifying, now go through config again and join the real game."
If your client does not answer that packet correctly, you get kicked.


## What Sonar Checks

Sonar is modular. Each check is a "verification" and they run one after another.
From the captures and from the plugin source, the main ones are:

1. Login check — confirms you completed the normal login handshake.
2. Gravity check — watches your player entity fall and land. It expects real
   physics behavior, not a frozen client.
3. Protocol check — sends custom packets and expects specific replies. This is
   where most bots fail because the packet IDs are not in the standard protocol docs.
4. Vehicle check — spawns a boat or minecart and expects you to ride it correctly.
5. Finish — if all of the above pass, Sonar lets you into the real server.


## Why Most Bots Fail

The protocol check is the killer. Sonar sends packets with IDs that the standard
minecraft-protocol library does not decode. If you only use the high-level library
calls, those packets are invisible to you and you never reply. Sonar then assumes
you are a bot and drops you.

The fix is to read the raw socket yourself. Parse the packet ID by hand, and when
you see the unknown IDs, send the exact reply Sonar expects. That is what
verify-pass.js does — it hooks the raw socket and handles the packets the library
cannot see.


## How We Tested This

We ran verify-pass.js against three different setups:

- CubixMC (play.cubixmc.fun) — a public server that uses CubixProxy + Sonar-style checks.
- Two private Sonar test servers we controlled — used to watch the verification
  sequence in isolation without rate limits.
- Our own VPS with a rotating IP — used to confirm the script works from a clean address.

On all three, the same approach worked: raw socket parsing plus correct replies
to the hidden protocol packets.


## The Debugging Plugin

To figure out what Sonar was sending, we built a small debugging plugin for the
Sonar proxy itself (source in resources/sonar-debug-plugin). It logs every packet
Sonar sends during verification, including the ones with non-standard IDs. That
plugin is what told us the exact reply bytes for the protocol and vehicle stages.

See main.md for the stage-by-stage walkthrough and the fixes for each error we hit.
