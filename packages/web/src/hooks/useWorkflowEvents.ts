import { useEffect } from 'react';
import type { WebSocketClient } from '../services/websocket-client';
import type { ServerMessage } from '../types';

/**
 * Subscribes to WebSocket messages from the given client.
 *
 * The handler is called for ALL messages. If you only care about a specific
 * runId, filter inside the handler.
 *
 * IMPORTANT: Memoize the handler with `useCallback` at the call site to
 * prevent unnecessary re-subscriptions.
 */
export function useWorkflowEvents(
  wsClient: WebSocketClient | null,
  runId: string | null,
  handler: (msg: ServerMessage) => void,
): void {
  useEffect(() => {
    if (!wsClient) return;
    const unsubscribe = wsClient.onMessage(handler);
    return unsubscribe;
  }, [wsClient, runId, handler]);
}
