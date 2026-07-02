import type { ClientCommand, ServerMessage, TransportStatus } from "@/types";
import { Emitter, type Transport } from "./transport";

/**
 * WebSocket transport. Expects the backend to push newline-free JSON
 * `ServerMessage` frames and to accept `ClientCommand` frames. Auto-reconnects
 * with capped exponential backoff and replays the last command queue on resume.
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly messages = new Emitter<ServerMessage>();
  private readonly statuses = new Emitter<TransportStatus>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldRun = false;
  private outbox: ClientCommand[] = [];

  constructor(url: string) {
    // Resolve relative URLs (e.g. "/ws/stream") against the current origin and
    // upgrade the scheme to ws/wss.
    if (url.startsWith("ws://") || url.startsWith("wss://")) {
      this.url = url;
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.url = `${proto}//${window.location.host}${url}`;
    }
  }

  connect(): void {
    this.shouldRun = true;
    this.open();
  }

  private open(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.statuses.emit("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.statuses.emit("open");
      // Flush any commands queued while disconnected.
      const queued = this.outbox;
      this.outbox = [];
      for (const cmd of queued) this.rawSend(cmd);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
        this.messages.emit(msg);
      } catch (err) {
        console.error("[ws] failed to parse message", err, ev.data);
      }
    };

    ws.onerror = () => this.statuses.emit("error");

    ws.onclose = () => {
      this.statuses.emit("closed");
      this.ws = null;
      if (this.shouldRun) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldRun) this.open();
    }, delay);
  }

  disconnect(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.rawSend(command);
    } else {
      // Buffer until reconnected so control actions are never silently dropped.
      this.outbox.push(command);
    }
  }

  private rawSend(command: ClientCommand): void {
    this.ws?.send(JSON.stringify(command));
  }

  onMessage(handler: (msg: ServerMessage) => void): () => void {
    return this.messages.on(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    return this.statuses.on(handler);
  }
}
