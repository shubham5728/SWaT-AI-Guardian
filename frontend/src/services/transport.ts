import type { ClientCommand, ServerMessage, TransportStatus } from "@/types";

/**
 * Abstraction over the live data source. The UI depends only on this interface,
 * so the WebSocket client and the in-browser mock simulator are interchangeable
 * (selected via VITE_TRANSPORT). A future SSE/Kafka-proxy transport can be added
 * here without touching any component.
 */
export interface Transport {
  /** Begin streaming. Idempotent. */
  connect(): void;
  /** Tear down the connection / timers. */
  disconnect(): void;
  /** Send a control command to the backend. */
  send(command: ClientCommand): void;
  /** Subscribe to inbound server messages. Returns an unsubscribe fn. */
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe fn. */
  onStatus(handler: (status: TransportStatus) => void): () => void;
}

/** Tiny typed event emitter shared by transport implementations. */
export class Emitter<T> {
  private handlers = new Set<(value: T) => void>();

  emit(value: T): void {
    for (const h of this.handlers) h(value);
  }

  on(handler: (value: T) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
