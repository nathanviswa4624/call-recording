'use client';
/**
 * Socket.IO subscription to the backend live hub (/api/ws). Authenticates with
 * the in-memory access token in the handshake (never a URL parameter). Falls back
 * to the caller's polling when the socket is unavailable.
 */
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api/client';

export type LiveState = 'connecting' | 'connected' | 'unavailable';

export function useLiveEvents(events: string[], onEvent: (event: string, payload: unknown) => void): LiveState {
  const [state, setState] = useState<LiveState>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const key = events.join(',');

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { setState('unavailable'); return; }
    const url = process.env.NEXT_PUBLIC_WS_URL || undefined;
    const socket: Socket = io(url ?? '', { path: '/api/ws', auth: { token }, transports: ['websocket'], reconnectionAttempts: 5, timeout: 5000 });
    socket.on('connect', () => setState('connected'));
    socket.on('connect_error', () => setState('unavailable'));
    socket.on('disconnect', () => setState('connecting'));
    for (const ev of key.split(',')) socket.on(ev, (p: unknown) => handler.current(ev, p));
    return () => { socket.disconnect(); };
  }, [key]);

  return state;
}
