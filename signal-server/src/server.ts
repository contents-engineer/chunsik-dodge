import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'

type Role = 'host' | 'guest'

type Room = {
  host: WebSocket
  guest?: WebSocket
  createdAt: number
}

type ClientMessage =
  | { type: 'create' }
  | { type: 'join'; roomId: string }
  | { type: 'signal'; payload: unknown }
  | { type: 'leave' }

const rooms = new Map<string, Room>()
const ROOM_TTL_MS = 5 * 60 * 1000

function pruneStaleRooms(): void {
  const now = Date.now()
  for (const [id, room] of rooms) {
    if (!room.guest && now - room.createdAt > ROOM_TTL_MS) {
      try {
        room.host.close(1000, 'room-expired')
      } catch {}
      rooms.delete(id)
    }
  }
}

setInterval(pruneStaleRooms, 60 * 1000).unref()

function makeRoomId(): string {
  return randomBytes(3).toString('hex')
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function peerOf(room: Room, role: Role): WebSocket | undefined {
  return role === 'host' ? room.guest : room.host
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`ok ${rooms.size}`)
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  let roomId: string | null = null
  let role: Role | null = null

  const detachFromRoom = (): void => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) {
      roomId = null
      role = null
      return
    }
    const peer = peerOf(room, role!)
    if (peer) send(peer, { type: 'peer-left' })
    rooms.delete(roomId)
    roomId = null
    role = null
  }

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send(ws, { type: 'error', reason: 'bad-json' })
      return
    }

    if (msg.type === 'create') {
      detachFromRoom()
      const id = makeRoomId()
      rooms.set(id, { host: ws, createdAt: Date.now() })
      roomId = id
      role = 'host'
      send(ws, { type: 'created', roomId: id })
      return
    }

    if (msg.type === 'join') {
      detachFromRoom()
      const room = rooms.get(msg.roomId)
      if (!room) {
        send(ws, { type: 'error', reason: 'no-room' })
        return
      }
      if (room.guest) {
        send(ws, { type: 'error', reason: 'room-full' })
        return
      }
      room.guest = ws
      roomId = msg.roomId
      role = 'guest'
      send(ws, { type: 'joined', roomId: msg.roomId })
      send(room.host, { type: 'peer-joined' })
      return
    }

    if (msg.type === 'signal') {
      if (!roomId || !role) {
        send(ws, { type: 'error', reason: 'not-in-room' })
        return
      }
      const room = rooms.get(roomId)
      if (!room) {
        send(ws, { type: 'error', reason: 'room-gone' })
        return
      }
      const peer = peerOf(room, role)
      if (peer) send(peer, { type: 'signal', payload: msg.payload })
      return
    }

    if (msg.type === 'leave') {
      detachFromRoom()
      return
    }
  })

  ws.on('close', () => {
    detachFromRoom()
  })

  ws.on('error', () => {
    detachFromRoom()
  })
})

const port = Number(process.env.PORT ?? 8080)
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`signal-server listening on :${port}`)
})
