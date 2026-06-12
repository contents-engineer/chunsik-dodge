import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'

type Role = 'host' | 'guest'

type Visibility = 'public' | 'private'

type Room = {
  host: WebSocket
  guest?: WebSocket
  createdAt: number
  visibility: Visibility
  hostName: string
}

type ClientMessage =
  | { type: 'create'; visibility?: Visibility; hostName?: string }
  | { type: 'join'; roomId: string }
  | { type: 'signal'; payload: unknown }
  | { type: 'leave' }
  | { type: 'list' }

const rooms = new Map<string, Room>()
const ROOM_TTL_MS = 5 * 60 * 1000
const HOST_NAME_MAX = 24

// 공개 대기실을 보고 있는 소켓들. 방을 만들거나 들어가면 자동으로 빠진다.
const lobbyWatchers = new Set<WebSocket>()

function publicRoomList(): { roomId: string; hostName: string; createdAt: number }[] {
  const list: { roomId: string; hostName: string; createdAt: number }[] = []
  for (const [id, room] of rooms) {
    if (room.visibility === 'public' && !room.guest) {
      list.push({ roomId: id, hostName: room.hostName, createdAt: room.createdAt })
    }
  }
  return list
}

function broadcastRoomList(): void {
  if (lobbyWatchers.size === 0) return
  const msg = JSON.stringify({ type: 'rooms', rooms: publicRoomList() })
  for (const ws of lobbyWatchers) {
    if (ws.readyState === ws.OPEN) ws.send(msg)
  }
}

function pruneStaleRooms(): void {
  const now = Date.now()
  let pruned = false
  for (const [id, room] of rooms) {
    if (!room.guest && now - room.createdAt > ROOM_TTL_MS) {
      try {
        room.host.close(1000, 'room-expired')
      } catch {}
      rooms.delete(id)
      pruned = true
    }
  }
  if (pruned) broadcastRoomList()
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

function sanitizeHostName(raw: unknown): string {
  if (typeof raw !== 'string') return '???'
  const trimmed = raw.trim().slice(0, HOST_NAME_MAX)
  return trimmed.length > 0 ? trimmed : '???'
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
    broadcastRoomList()
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
      lobbyWatchers.delete(ws)
      const id = makeRoomId()
      // visibility 미지정 시 private — 구버전 클라이언트가 만든 방이 의도 없이 노출되지 않도록
      const visibility: Visibility = msg.visibility === 'public' ? 'public' : 'private'
      rooms.set(id, {
        host: ws,
        createdAt: Date.now(),
        visibility,
        hostName: sanitizeHostName(msg.hostName),
      })
      roomId = id
      role = 'host'
      send(ws, { type: 'created', roomId: id })
      if (visibility === 'public') broadcastRoomList()
      return
    }

    if (msg.type === 'join') {
      detachFromRoom()
      lobbyWatchers.delete(ws)
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
      if (room.visibility === 'public') broadcastRoomList()
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

    if (msg.type === 'list') {
      lobbyWatchers.add(ws)
      send(ws, { type: 'rooms', rooms: publicRoomList() })
      return
    }
  })

  ws.on('close', () => {
    lobbyWatchers.delete(ws)
    detachFromRoom()
  })

  ws.on('error', () => {
    lobbyWatchers.delete(ws)
    detachFromRoom()
  })
})

const port = Number(process.env.PORT ?? 8080)
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`signal-server listening on :${port}`)
})
