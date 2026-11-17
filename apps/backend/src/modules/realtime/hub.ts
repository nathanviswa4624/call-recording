/**
 * Socket.IO hub (docs/03 "WebSocket"). Clients authenticate with the access
 * token in the handshake and join org/site rooms. Connector events are fanned out here.
 */
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { verifyAccessToken } from '../auth/tokens.js';

let io: Server | undefined;

export function attachRealtime(app: FastifyInstance) {
  io = new Server(app.server, { path: '/api/ws', serveClient: false, cors: { origin: false } });
  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.['token'] ?? '');
      const claims = await verifyAccessToken(token);
      socket.data['auth'] = claims;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    const auth = socket.data['auth'] as { org: string; sites: string[] };
    socket.join(`org:${auth.org}`);
    for (const s of auth.sites) socket.join(`site:${s}`);
  });
  app.addHook('onClose', async () => { io?.close(); });
}

export function emitToOrg(org: string, event: string, payload: unknown) {
  io?.to(`org:${org}`).emit(event, payload);
}
