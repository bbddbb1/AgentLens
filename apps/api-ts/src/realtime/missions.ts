import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type MissionEvent = Record<string, unknown> & { type?: string };

class RealtimeManager {
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly redisUrl = process.env.REDIS_URL;
  private publisher = this.redisUrl ? createClient({ url: this.redisUrl }) : null;
  private subscriber = this.redisUrl ? createClient({ url: this.redisUrl }) : null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.publisher || !this.subscriber) return;

    try {
      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
      await this.subscriber.pSubscribe('mission:*', async (message: string, channel: string) => {
        const missionId = channel.split(':')[1];
        if (!missionId) return;
        try {
          const parsed = JSON.parse(message) as MissionEvent;
          await this.broadcast(missionId, parsed);
        } catch {
          // Ignore malformed pub/sub payloads.
        }
      });
    } catch {
      this.publisher = null;
      this.subscriber = null;
    }
  }

  async shutdown(): Promise<void> {
    this.rooms.clear();
    await Promise.allSettled([
      this.publisher?.quit(),
      this.subscriber?.quit(),
    ]);
  }

  attach(server: http.Server): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = request.url ?? '';
      const match = url.match(/^\/ws\/missions\/([^/?#]+)/);
      if (!match) {
        socket.destroy();
        return;
      }

      const missionId = decodeURIComponent(match[1]);
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        this.addClient(missionId, ws);
        this.bindClient(ws, missionId);
      });
    });
  }

  private bindClient(ws: WebSocket, missionId: string): void {
    ws.send(JSON.stringify({ type: 'connected', mission_id: missionId, connection_id: randomUUID() }));

    ws.on('message', (data: RawData) => {
      try {
        const payloadBuffer =
          typeof data === 'string'
            ? Buffer.from(data, 'utf8')
            : Array.isArray(data)
              ? Buffer.concat(
                  data.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
                )
              : Buffer.isBuffer(data)
                ? data
                : Buffer.from(data);
        const text = payloadBuffer.toString('utf8');
        const parsed = JSON.parse(text) as MissionEvent;
        if (parsed.type && ['cursor_move', 'presence', 'selection'].includes(parsed.type)) {
          void this.broadcast(missionId, parsed, ws);
        }
      } catch {
        // Ignore malformed client payloads.
      }
    });

    ws.on('close', () => {
      this.removeClient(missionId, ws);
    });
  }

  private addClient(missionId: string, ws: WebSocket): void {
    const room = this.rooms.get(missionId) ?? new Set<WebSocket>();
    room.add(ws);
    this.rooms.set(missionId, room);
  }

  private removeClient(missionId: string, ws: WebSocket): void {
    const room = this.rooms.get(missionId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) this.rooms.delete(missionId);
  }

  async publish(missionId: string, message: MissionEvent): Promise<void> {
    await this.broadcast(missionId, message);
    if (this.publisher?.isOpen) {
      await this.publisher.publish(`mission:${missionId}`, JSON.stringify(message));
    }
  }

  async broadcast(missionId: string, message: MissionEvent, exclude?: WebSocket): Promise<void> {
    const room = this.rooms.get(missionId);
    if (!room) return;

    const payload = JSON.stringify(message);
    for (const client of room) {
      if (client === exclude || client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  }
}

export const realtimeManager = new RealtimeManager();
