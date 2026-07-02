import type { Transport } from "./transport";
import { WebSocketTransport } from "./websocketClient";
import { MockTransport } from "./mockTransport";

/**
 * Picks the transport from build-time env:
 *   VITE_TRANSPORT=ws    → live backend over WebSocket (VITE_WS_URL)
 *   VITE_TRANSPORT=mock  → in-browser simulator (default)
 */
export function createTransport(): Transport {
  const kind = import.meta.env.VITE_TRANSPORT ?? "mock";
  if (kind === "ws") {
    const url = import.meta.env.VITE_WS_URL ?? "/ws/stream";
    return new WebSocketTransport(url);
  }
  return new MockTransport();
}

export type { Transport } from "./transport";
