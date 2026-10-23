import { Emitter } from '../core/emitter';
import type { ConnectionState, SoulseekClientEvents } from '../core/soulseekClient';
import { SoulseekClient } from '../core/soulseekClient';
import type { TransferSnapshot } from '../core/transfer';
import type { SearchHit } from '../core/types';
import { ReactNativeTransport } from '../transport/rnTcpTransport';
import type { Transport } from '../transport/types';
import { contentTypeFor, RangeHttpServer } from '../stream/httpServer';
import type { Settings } from './settings';

export interface PreparedStream {
  url: string;
  transferId: string;
  hit: SearchHit;
}

export type StreamingEvents = {
  state: { state: ConnectionState; error?: string };
  login: SoulseekClientEvents['login'];
  transfer: TransferSnapshot;
  searchResults: { token: number; hits: SearchHit[] };
  notice: string;
  log: string;
};

/**
 * Owns the Soulseek client and the local HTTP server. One instance is created
 * per connection configuration; the UI store subscribes to its events.
 */
export class StreamingService {
  readonly events = new Emitter<StreamingEvents>();

  private readonly transport: Transport;
  private readonly settings: Settings;
  private client: SoulseekClient | null = null;
  private http: RangeHttpServer | null = null;

  private active:
    | {
        transferId: string;
        url: string;
        hit: SearchHit;
        unsubscribe: () => void;
      }
    | null = null;

  constructor(settings: Settings, transport?: Transport) {
    this.settings = settings;
    this.transport = transport ?? new ReactNativeTransport();
  }

  get listenPort(): number {
    return this.client?.listeningPort ?? 0;
  }

  get httpPort(): number {
    return this.http?.port ?? 0;
  }

  get state(): ConnectionState {
    return this.client?.state ?? 'idle';
  }

  async start(username: string, password: string) {
    await this.stop();

    const http = new RangeHttpServer(this.transport, this.settings.streamPort);
    await http.start();
    this.http = http;

    const client = new SoulseekClient({
      transport: this.transport,
      username,
      password,
      listenPort: this.settings.listenPort,
      serverHost: this.settings.serverHost,
      serverPort: this.settings.serverPort,
    });

    this.client = client;

    client.on('state', payload => this.events.emit('state', payload));
    client.on('login', payload => this.events.emit('login', payload));
    client.on('transfer', payload => this.events.emit('transfer', payload));
    client.on('searchResults', payload => this.events.emit('searchResults', payload));
    client.on('notice', payload => this.events.emit('notice', payload));
    client.on('log', payload => this.events.emit('log', payload));

    try {
      const login = await client.connect();
      return login;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.cancelActive();

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    if (this.http) {
      this.http.stop();
      this.http = null;
    }
  }

  search(
    query: string,
    onResults?: (hits: SearchHit[]) => void,
    durationMs?: number,
  ): Promise<SearchHit[]> {
    if (!this.client) {
      return Promise.reject(new Error('Non connecté'));
    }

    return this.client.search(query, { onResults, durationMs });
  }

  cancelSearch(): void {
    this.client?.cancelSearch();
  }

  /** Reconnects to the server now instead of waiting for the backoff. */
  reconnectNow(): void {
    this.client?.reconnectNow();
  }

  /**
   * Starts a Soulseek transfer and exposes it to the player through the local
   * HTTP range server. The caller is responsible for waiting until enough
   * bytes are buffered before calling TrackPlayer.load().
   */
  prepareStream(hit: SearchHit): PreparedStream {
    if (!this.client || !this.http) {
      throw new Error('Non connecté');
    }

    this.cancelActive();

    const transfer = this.client.createTransfer(hit);
    const id = transfer.id;
    // The URL carries a random token rather than the transfer id (which is
    // just user + file + time), so other apps on the device cannot guess it.
    const streamId = randomToken();
    const url = this.http.urlFor(streamId);

    // The source stays registered after a transfer failure: the bytes that
    // already arrived can still be played and seeked. It is released when
    // the user moves on (cancelActive).
    this.http.register(streamId, {
      getSize: () => (transfer.expectedSize > 0 ? transfer.expectedSize : hit.size),
      contentType: contentTypeFor(hit.filename),
      buffer: transfer.buffer,
    });

    const unsubscribe = () => this.http?.unregister(streamId);
    this.active = { transferId: id, url, hit, unsubscribe };

    return { url, transferId: id, hit };
  }

  /** Cancels the transfer behind the current stream and frees its buffer. */
  cancelActive(): void {
    if (!this.active) {
      return;
    }

    const { transferId, unsubscribe } = this.active;
    unsubscribe();
    this.client?.cancelTransfer(transferId);
    this.active = null;
  }

  get activeTransferId(): string | null {
    return this.active?.transferId ?? null;
  }

  getTransfer(transferId: string) {
    return this.client?.getTransfer(transferId) ?? null;
  }
}

function randomToken(): string {
  let token = '';

  for (let i = 0; i < 4; i++) {
    token += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  }

  return token;
}
