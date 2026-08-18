# Resources

Extra tooling we built while figuring out Sonar. These are not needed to run
verify-pass.js, but they are how we learned what to send.


## sonar-debug-plugin/

This is a modified build of the Sonar proxy (velocity / bungee / bukkit / paper
modules under src/). We turned on packet logging inside the anti-bot handler so
it prints every packet Sonar sends during a verification attempt.

Why it matters: Sonar sends packets with IDs that do not exist in the public
Minecraft protocol docs. The normal client library decodes them as "unknown" and
throws them away. By logging at the proxy level we could see the exact bytes and
figure out what reply each one expected.

Drop it into a Sonar test server, watch the console during a connection, and you
will see the full verification sequence including the hidden protocol and vehicle
packets.


## packet-logger-2.0.4.jar

A Fabric mod for the actual Minecraft client. It hooks the connection and writes
every packet to a log file with its real ID and the current connection state.

Log location: .minecraft/logs/packet-log-YYYY-MM-DD.txt (one file per day)

Each line is tagged with the state it happened in (login / config / play) so you
can tell which phase a packet belongs to. We ran a real client through a Sonar-protected
server
verification with this mod installed, then read the log to copy the exact reply
bytes a legitimate player sends. Those bytes are what verify-pass.js reproduces.

The mod handles state tracking, daily rotation, and a config file at
config/packetlogger.json if you want to filter what gets logged.
