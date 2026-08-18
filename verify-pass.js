// ============================================================
//  Sonar Bypass — verify-pass.js
//  Gets a Minecraft account past Sonar 2.1.x verification.
//
//  What this does, in order:
//    1. Connect + login
//    2. Config handshake (settings, brand, finish_config)
//    3. Gravity check (teleport priming + fall + land)
//    4. Protocol check (reply to hidden packets)
//    5. Vehicle check (boat + minecart)
//    6. Print "VERIFICATION PASSED" and exit 42
//
//  Run:  USERNAME=your_acc PASS=your_pass node verify-pass.js
//  Note: hard-coded to Minecraft 26.1 / play.cubixmc.fun
// ============================================================

const mc = require('minecraft-protocol')
const zlib = require('zlib')

// ---------- packet helpers (varint + raw framing) ----------
function varint(n) {
  const o = []
  while (true) {
    if ((n & ~0x7f) === 0) { o.push(n); break }
    o.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  return Buffer.from(o)
}
function frame(id, body) {
  const full = Buffer.concat([varint(id), body || Buffer.alloc(0)])
  return Buffer.concat([varint(full.length), full])
}
function readVarIntOff(buf, off) {
  let n = 0, s = 0, i = off
  while (i < buf.length) {
    const b = buf[i++]
    n |= (b & 0x7f) << s
    if ((b & 0x80) === 0) return { value: n, bytes: i - off }
    s += 7
    if (s > 35) return null
  }
  return null
}

// ---------- builders for outgoing packets ----------
function buildClientInformation() {
  const locale = Buffer.from('en_us', 'utf8')
  return Buffer.concat([
    varint(locale.length), locale,
    Buffer.from([10]), varint(0),
    Buffer.from([1]), Buffer.from([0x7f]),
    varint(1), Buffer.from([0]), Buffer.from([0]), varint(0)
  ])
}
function buildBrand() {
  const ch = Buffer.from('minecraft:brand', 'utf8')
  const br = Buffer.from('vanilla', 'utf8')
  return Buffer.concat([varint(ch.length), ch, varint(br.length), br])
}
function buildPosition(y, x = 8, z = 8, yaw = 0, pitch = 0, onGround = false) {
  const b = Buffer.alloc(33)
  b.writeDoubleBE(x, 0); b.writeDoubleBE(y, 8); b.writeDoubleBE(z, 16)
  b.writeFloatBE(yaw, 24); b.writeFloatBE(pitch, 28)
  b.writeUInt8(onGround ? 1 : 0, 32)
  return b
}
function buildTransaction(id) {
  const b = Buffer.alloc(4)
  b.writeInt32BE(id, 0)
  return b
}

// ---------- client setup ----------
const UNAME = process.env.USERNAME || 'ubuntu_prime'
const PASS = process.env.PASS || 'YADAV.COM'
const HOST = process.env.HOST || 'play.cubixmc.fun'

const client = mc.createClient({
  host: HOST, port: 25565, username: UNAME,
  version: '26.1', auth: 'off', brand: 'vanilla', connectTimeout: 60000,
})

// raw send straight to the socket (bypasses the library's packet encoder)
const sendRaw = (id, body) => {
  try { client.socket.write(frame(id, body)) } catch (e) {}
}
const tickEnd = () => sendRaw(13, Buffer.alloc(0))

// block the library's auto-replies for packets we handle ourselves
const _origWrite = client.write.bind(client)
client.write = (name, params) => {
  if (['settings', 'custom_payload', 'pong', 'finish_configuration', 'keep_alive'].includes(name)) return
  return _origWrite(name, params)
}

// ---------- state ----------
let rawBuf = Buffer.alloc(0)
let inPlay = false
let sentSettings = false

let telY1 = null, telY2 = null, spawnY = 0
let gravityActive = false, gY = 0, gDy = 0, gravTicks = 0
const MAX_TICKS = 8

let lastTx = null, blockH = 0.75, protoDone = false
let vPhase = 'WAITING', vMotion = 0, vY = 0

// block-height lookup from multi_block_change stateId (CubixMC blocks)
const BLOCK_HEIGHTS = {
  9451: 0.75, 12582: 0.1875, 9473: 0.8125,
  11295: 0.375, 9984: 1.5, 13399: 0.5, 12896: 0.0625
}

// ============================================================
//  RAW SOCKET — catch packets the library hides
// ============================================================
client.on('connect', () => {
  console.log('[*] TCP connected (' + UNAME + ')')
  if (!client.socket) return
  client.socket.on('data', (chunk) => {
    rawBuf = Buffer.concat([rawBuf, chunk])
    while (rawBuf.length) {
      const lenR = readVarIntOff(rawBuf, 0)
      if (!lenR || rawBuf.length < lenR.bytes + lenR.value) break
      const pkt = rawBuf.slice(lenR.bytes, lenR.bytes + lenR.value)
      rawBuf = rawBuf.slice(lenR.bytes + lenR.value)
      const idR = readVarIntOff(pkt, 0)
      if (!idR) continue
      const id = idR.value
      const body = pkt.slice(idR.bytes)
      if (!inPlay) continue

      // protocol stage: transaction (id 61) -> reply (0x2d)
      if (id === 61 && body.length >= 4) {
        const tid = body.readInt32BE(0)
        if (tid !== lastTx) {
          lastTx = tid
          sendRaw(0x2d, buildTransaction(tid))
          console.log('[proto] tx echoed id=' + tid)
        }
      }
      // protocol stage: swing (id 2) -> reply (0x3f), marks protocol done
      if (id === 2) {
        sendRaw(0x3f, varint(0))
        protoDone = true
        console.log('[proto] swing -> reply')
      }
      // protocol stage: held item slot (id 105) -> echo back (0x35)
      if (id === 105 && body.length >= 1) {
        const sl = body[0]
        if (sl >= 0 && sl <= 8) {
          const b = Buffer.alloc(2)
          b.writeInt16BE(sl, 0)
          sendRaw(0x35, b)
          console.log('[proto] held echoed sl=' + sl)
        }
      }
      // gravity stage: read block height from multi_block_change (id 84)
      if (id === 84 && body.length >= 10) {
        try {
          const lo = body.readBigInt64BE(0)
          const sectionY = Number(lo & 0xFFFFFn)
          let ci = 8, count = 0, shift = 0
          while (ci < body.length) {
            const b = body[ci++]
            count |= (b & 0x7f) << shift
            if ((b & 0x80) === 0) break
            shift += 7
          }
          let rec = 0n, rs = 0n, ri = ci, rb
          while (ri < body.length) {
            rb = BigInt(body[ri++])
            rec |= (rb & 0x7fn) << rs
            if ((rb & 0x80n) === 0n) break
            rs += 7n
          }
          const stateId = Number(rec >> 12n)
          if (BLOCK_HEIGHTS[stateId] !== undefined) {
            blockH = BLOCK_HEIGHTS[stateId]
            console.log('[+] block h=' + blockH)
          }
        } catch (e) {}
      }
    }
  })
})

// ============================================================
//  LIBRARY PACKETS — config, keepalive, position, disconnect
// ============================================================
client.on('packet', (data, meta) => {
  const name = meta.name

  // config: send settings + brand when registry_data arrives
  if (name === 'registry_data' && !sentSettings) {
    sentSettings = true
    sendRaw(0, buildClientInformation())
    setTimeout(() => sendRaw(2, buildBrand()), 30)
    console.log('[+] settings+brand sent')
  }

  // keepalive — config state uses id 4, play state uses 0x1c
  if (name === 'keep_alive') {
    const ka = data.keepAliveId !== undefined ? data.keepAliveId : data.id
    let b
    if (Array.isArray(ka)) {
      b = Buffer.alloc(8)
      b.writeInt32BE(Number(ka[0]) || 0, 0)
      b.writeUInt32BE(Number(ka[1]) >>> 0, 4)
    } else {
      b = Buffer.alloc(8)
      b.writeBigInt64BE(BigInt(ka || 0))
    }
    if (!inPlay) {
      sendRaw(4, b)
      console.log('[+] cfg keepalive')
    } else {
      sendRaw(0x1c, b)
      console.log('[+] play keepalive vP=' + vPhase)
      if (protoDone) vehicleKeepalive()
    }
    return
  }

  // finish_config -> move to PLAY
  if (name === 'finish_configuration' && !inPlay) {
    inPlay = true
    sendRaw(3, Buffer.alloc(0))
    console.log('[+] finish_config -> PLAY')
    return
  }

  if (!inPlay) return

  // position teleports — set up the gravity fall
  if (name === 'position') {
    const y = data.y
    const tid = (data.teleportId !== undefined) ? data.teleportId : 0
    sendRaw(0x00, varint(tid))
    if (telY1 === null) {
      telY1 = y
      console.log('[tele] 1st y=' + y)
      sendRaw(0x1f, buildPosition(y))
      tickEnd()
      console.log('[confirm] priming #1')
    } else if (telY2 === null && y !== telY1) {
      telY2 = y
      spawnY = telY1 + telY2
      console.log('[tele] 2nd y=' + y + ' spawnY=' + spawnY.toFixed(2))
      setTimeout(() => {
        // priming #2 offset by 0.0001 so Sonar does not dedupe identical frames
        sendRaw(0x1f, buildPosition(spawnY + 0.0001))
        sendRaw(0x1f, buildPosition(spawnY))
        tickEnd()
        setTimeout(startGravity, 150)
      }, 60)
    }
    return
  }
})

// ============================================================
//  GRAVITY — fall for MAX_TICKS then land on the block
// ============================================================
function startGravity() {
  if (gravityActive) return
  gravityActive = true
  gY = spawnY; gDy = 0; gravTicks = 0
  console.log('[+] GRAVITY start y=' + gY.toFixed(4) + ' blockH=' + blockH)
  let t = 0
  const tick = () => {
    if (!gravityActive) return
    const dy = (gDy - 0.08) * 0.98
    gY += dy; gDy = dy; t++
    sendRaw(0x1f, buildPosition(gY))
    tickEnd()
    console.log('  grav ' + t + ' y=' + gY.toFixed(4))
    if (t >= MAX_TICKS) {
      gravityActive = false
      const land = (spawnY - 4) + blockH
      console.log('[+] GRAVITY done land=' + land.toFixed(4))
      sendRaw(0x1f, buildPosition(land, 8, 8, 0, 0, true))
      tickEnd()
      console.log('[+] -> Protocol stage')
      return
    }
    setTimeout(tick, 50)
  }
  setTimeout(tick, 50)
}

// ============================================================
//  VEHICLE — boat then minecart, driven by keepalives
// ============================================================
function vehicleKeepalive() {
  if (vPhase === 'WAITING') {
    vPhase = 'IN_BOAT'; vMotion = 0; vY = telY1 || 3200
    startVehicle()
  } else if (vPhase === 'IN_BOAT') {
    vPhase = 'AIR_BOAT'
    setTimeout(() => sendRaw(0x1f, buildPosition(vY)), 50)
  } else if (vPhase === 'AIR_BOAT') {
    vPhase = 'IN_MINECART'; vY = telY1 || 3200
    startVehicle()
  } else if (vPhase === 'IN_MINECART') {
    vPhase = 'AIR_MINECART'
    console.log('[+] VEHICLE DONE')
    setTimeout(() => sendRaw(0x1f, buildPosition(vY)), 50)
  }
}
function startVehicle() {
  console.log('[+] VEHICLE ' + vPhase + ' y0=' + vY.toFixed(2))
  // 3 vehicle-move packets with downward drift (mimics boat gravity)
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      vMotion -= 0.04; vY += vMotion
      const b = Buffer.alloc(33)
      b.writeDoubleBE(8, 0); b.writeDoubleBE(vY, 8); b.writeDoubleBE(8, 16)
      b.writeFloatBE(0, 24); b.writeFloatBE(0, 28); b.writeUInt8(0, 32)
      sendRaw(0x22, b)
      console.log('  vmove y=' + vY.toFixed(4))
    }, 40 + i * 60)
  }
  // 3 rounds of paddle / rotation / input
  for (let c = 0; c < 3; c++) {
    setTimeout(() => sendRaw(0x23, Buffer.from([1, 1])), 300 + c * 150)
    setTimeout(() => {
      const b = Buffer.alloc(9)
      b.writeFloatBE(0, 0); b.writeFloatBE(0, 4); b.writeUInt8(0, 8)
      sendRaw(0x20, b)
    }, 330 + c * 150)
    setTimeout(() => sendRaw(0x2b, Buffer.from([0x01])), 360 + c * 150)
  }
}

// ============================================================
//  DISCONNECT / RESULT
// ============================================================
client.on('kick_disconnect', (data) => {
  const s = JSON.stringify(data)
  const vals = [...s.matchAll(/" (?:text|value) ":"([^"]*)"/g)].map(m => m[1])
  console.log('[KICK]', vals.join(' | ').slice(0, 400))
  if (/verified|success|passed|complete/i.test(s)) {
    console.log('VERIFICATION PASSED — exiting 42')
    setTimeout(() => process.exit(42), 300) // 42 = verified signal
  }
})
client.on('disconnect', (data) => {
  const vals = [...JSON.stringify(data).matchAll(/" (?:text|value) ":"([^"]*)"/g)].map(m => m[1])
  console.log('[DISC]', vals.join(' | ').slice(0, 300))
})

// 75s safety timeout
setTimeout(() => { console.log('[..] 75s timeout'); process.exit(1) }, 75000)
