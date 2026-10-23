import { ByteQueue, readU32 } from './bytes';
import { Emitter } from './emitter';
import { Framer, MAX_FRAME_SIZE } from './framer';
import {
  ConnectionType,
  LoginRejection,
  PeerCode,
  PeerInitCode,
  ServerCode,
  TransferDirection,
  UserStatus,
  encodeAcceptChildren,
  encodeCantConnectToPeer,
  encodeConnectToPeer,
  encodeFileSearch,
  encodeGetPeerAddress,
  encodeHaveNoParent,
  encodeLogin,
  encodePeerInit,
  encodePierceFirewall,
  encodePlaceInQueueRequest,
  encodeQueueUpload,
  encodeFolderContentsResponse,
  encodeServerPing,
  encodeSetStatus,
  encodeSharedFileListResponse,
  encodeSharedFoldersFiles,
  encodeUserInfoResponse,
  encodeSetWaitPort,
  encodeTransferResponse,
  encodeUploadDenied,
  parseCantConnectToPeer,
  parseConnectToPeer,
  parseFileSearchResponse,
  parseFolderContentsRequest,
  parseLoginResponse,
  parsePeerAddress,
  parsePeerInit,
  parsePlaceInQueueRequest,
  parsePlaceInQueueResponse,
  parseQueueUpload,
  parseTransferRequest,
  parseTransferResponse,
  parseUploadDenied,
  parseUploadFailed,
} from './protocol';
import type {
  LoginResponse,
  LoginSuccess,
  PeerAddress,
  SearchResponse,
} from './protocol';
import { StreamTransfer } from './transfer';
import { UploadManager } from './uploads';
import type { ShareLibrary, UploadStatus } from './uploads';
import type { TransferSnapshot } from './transfer';
import { extensionOf, hitKey, isStreamableFile } from './types';
import type { SearchHit } from './types';
import type { ListenerLike, SocketLike, Transport } from '../transport/types';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type SoulseekClientEvents = {
  state: { state: ConnectionState; error?: string };
  login: LoginSuccess;
  searchResults: { token: number; hits: SearchHit[] };
  searchDone: { token: number; hits: SearchHit[] };
  transfer: TransferSnapshot;
  notice: string;
  log: string;
};

export interface SoulseekClientOptions {
  transport: Transport;
  username: string;
  password: string;
  /** Preferred listening port. 0 or a busy port falls back to an ephemeral port. */
  listenPort?: number;
  serverHost?: string;
  serverPort?: number;
  searchDurationMs?: number;
  version?: { major: number; minor: number };
  /** Files we share. Without it the client shares nothing. */
  shares?: ShareLibrary;
  /** Whether uploads may start right now (e.g. sharing on and on Wi-Fi). */
  canUpload?: () => boolean;
  /** Shown to users who look at our profile. */
  description?: string;
}

export interface SearchOptions {
  durationMs?: number;
  onResults?: (hits: SearchHit[]) => void;
}

const DEFAULT_SERVER_HOST = 'server.slsknet.org';
const DEFAULT_SERVER_PORT = 2242;
const MAX_SEARCH_HITS = 200;
const MAX_SEARCH_RESPONSE_BYTES = 512 * 1024;
const PEER_ADDRESS_TTL_MS = 10 * 60 * 1000;
const QUEUE_POLL_MS = 60000;
const MAX_QUEUE_POLLS = 10;
const MAX_INBOUND_PEERS = 64;
const PEER_CONNECT_TIMEOUT_MS = 12000;
const INDIRECT_CONNECT_TIMEOUT_MS = 20000;
const RECONNECT_DELAYS_MS = [2000, 5000, 10000, 20000, 30000, 60000];

/** Resolves with the first promise that fulfils; rejects when all reject. */
function firstSuccess<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let failures = 0;
    let lastError: unknown = null;

    for (const promise of promises) {
      promise.then(resolve, error => {
        failures++;
        lastError = error;

        if (failures === promises.length) {
          reject(lastError);
        }
      });
    }
  });
}

function userKey(username: string): string {
  return username.toLowerCase();
}

class PeerSession {
  readonly framer = new Framer(4);
  private closed = false;
  private pinned = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly username: string,
    readonly socket: SocketLike,
    readonly direction: 'in' | 'out',
    private readonly onFrame: (session: PeerSession, frame: ReturnType<Framer['push']>[number]) => void,
    private readonly onClosed: (session: PeerSession) => void,
  ) {
    socket.on('data', chunk => {
      if (chunk instanceof Uint8Array) {
        this.feed(chunk);
      }
    });

    socket.on('close', () => this.handleClose());
    socket.on('error', () => this.handleClose());
    socket.setKeepAlive(true);
    this.touch();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  send(data: Uint8Array): void {
    if (!this.closed) {
      this.socket.write(data);
    }
  }

  /** Keep an inbound session open while we use it for a transfer request. */
  pin(): void {
    this.pinned = true;
    this.clearIdle();
  }

  /** Feed bytes that were already read by another listener (connection setup). */
  receive(chunk: Uint8Array): void {
    if (!this.closed) {
      this.feed(chunk);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearIdle();
    this.socket.destroy();
    this.onClosed(this);
  }

  private feed(chunk: Uint8Array): void {
    this.touch();

    let frames;

    try {
      frames = this.framer.push(chunk);
    } catch {
      this.close();
      return;
    }

    for (const frame of frames) {
      try {
        this.onFrame(this, frame);
      } catch {
        // Ignore malformed peer messages, keep the session alive.
      }
    }
  }

  private touch(): void {
    // P connections opened by strangers are only used to deliver search
    // results. Do not let them pile up.
    if (this.direction !== 'in' || this.pinned) {
      return;
    }

    this.clearIdle();
    this.idleTimer = setTimeout(() => this.close(), 120000);
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private handleClose(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearIdle();
    this.onClosed(this);
  }
}

interface ActiveSearch {
  token: number;
  query: string;
  hits: Map<string, SearchHit>;
  onResults?: (hits: SearchHit[]) => void;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (hits: SearchHit[]) => void;
}

export class SoulseekClient extends Emitter<SoulseekClientEvents> {
  private readonly transport: Transport;
  private readonly username: string;
  private readonly password: string;
  private readonly preferredListenPort: number;
  private readonly serverHost: string;
  private readonly serverPort: number;
  private readonly searchDurationMs: number;
  private readonly version: { major: number; minor: number };

  private stateValue: ConnectionState = 'idle';
  private manualDisconnect = false;
  private connectPromise: Promise<LoginSuccess> | null = null;

  private serverSocket: SocketLike | null = null;
  private serverFramer: Framer | null = null;
  private loginWaiter: {
    resolve: (response: LoginResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private listener: ListenerLike | null = null;
  private actualListenPort = 0;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  private activeSearch: ActiveSearch | null = null;
  private nextTokenValue = Math.floor(Math.random() * 0x7fffffff) + 1;

  private readonly peerAddressWaiters = new Map<
    string,
    {
      resolve: (address: PeerAddress) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly peerAddressPending = new Map<string, Promise<PeerAddress>>();
  private readonly peerAddressCache = new Map<string, { address: PeerAddress; at: number }>();

  private readonly outboundPeers = new Map<string, PeerSession>();
  private readonly inboundPeers = new Set<PeerSession>();
  private readonly peerConnecting = new Map<string, Promise<PeerSession>>();
  /** Our own ConnectToPeer requests, waiting for the peer's PierceFirewall. */
  private readonly pendingPierces = new Map<
    number,
    {
      username: string;
      type: string;
      /** Takes over the socket synchronously, so no data is lost. */
      accept: (socket: SocketLike, rest: Uint8Array | null) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private readonly uploads: UploadManager | null;
  private readonly shares: ShareLibrary | null;
  private readonly description: string;
  private readonly pendingPeerTimers = new Set<ReturnType<typeof setTimeout>>();

  private readonly transfers = new Map<string, StreamTransfer>();
  private readonly transfersByToken = new Map<number, StreamTransfer>();
  private readonly transfersByKey = new Map<string, StreamTransfer>();
  private readonly queuePollers = new Map<
    string,
    {
      initial: ReturnType<typeof setTimeout> | null;
      interval: ReturnType<typeof setInterval> | null;
    }
  >();

  constructor(options: SoulseekClientOptions) {
    super();
    this.transport = options.transport;
    this.username = options.username;
    this.password = options.password;
    this.preferredListenPort = options.listenPort ?? 0;
    this.serverHost = options.serverHost ?? DEFAULT_SERVER_HOST;
    this.serverPort = options.serverPort ?? DEFAULT_SERVER_PORT;
    this.searchDurationMs = options.searchDurationMs ?? 20000;
    this.version = options.version ?? { major: 177, minor: 1 };
    this.shares = options.shares ?? null;
    this.description = options.description ?? 'SoulStream';
    const canUpload = options.canUpload ?? (() => true);

    this.uploads = this.shares
      ? new UploadManager(
          {
            sendToPeer: async (username, message) => {
              const session = await this.getPeerConnection(username);
              session.send(message);
            },
            openFileConnection: username => this.openFileConnection(username),
            nextToken: () => this.nextToken(),
            log: message => this.log(message),
          },
          this.shares,
          { canUpload },
        )
      : null;
  }

  /** Upload counters, for the settings screen. */
  get uploadStatus(): UploadStatus | null {
    return this.uploads?.status() ?? null;
  }

  /**
   * Tells the server how much we share and starts queued uploads. Call after
   * the shared files or the upload policy changed.
   */
  refreshShares(): void {
    if (!this.isOnline()) {
      return;
    }

    const files = this.shares?.files() ?? [];
    const folders = new Set(files.map(file => file.path.slice(0, file.path.lastIndexOf('\\'))));

    try {
      this.sendServer(encodeSharedFoldersFiles(folders.size, files.length));
    } catch {
      // The close handler will clean up.
    }

    this.uploads?.pump();
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  get listeningPort(): number {
    return this.actualListenPort;
  }

  get loggedInUsername(): string {
    return this.username;
  }

  /* ---------------------------------------------------------------------- */
  /* Connection lifecycle                                                    */
  /* ---------------------------------------------------------------------- */

  async connect(): Promise<LoginSuccess> {
    if (this.stateValue === 'online' && this.serverSocket) {
      return this.loginResult as LoginSuccess;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private loginResult: LoginSuccess | null = null;

  private async doConnect(): Promise<LoginSuccess> {
    this.manualDisconnect = false;
    this.setState('connecting');

    try {
      await this.startListener();

      const socket = await this.transport.connect({
        host: this.serverHost,
        port: this.serverPort,
        timeoutMs: 15000,
      });

      this.serverSocket = socket;
      this.serverFramer = new Framer(4);
      this.loginResult = null;

      socket.on('data', chunk => {
        if (chunk instanceof Uint8Array) {
          this.handleServerData(chunk);
        }
      });

      socket.on('close', () => this.handleServerClose(socket));
      socket.on('error', error => {
        this.log(error instanceof Error ? error.message : 'Server socket error');
      });

      const responsePromise = new Promise<LoginResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.loginWaiter = null;
          reject(new Error('Le serveur Soulseek ne répond pas'));
        }, 20000);

        this.loginWaiter = { resolve, reject, timer };
      });

      this.sendServer(encodeLogin(this.username, this.password, this.version));

      const response = await responsePromise;

      if (!response.ok) {
        throw new LoginError(formatLoginError(response.reason, response.detail), response.reason);
      }

      this.loginResult = response;

      this.sendServer(encodeSetWaitPort(this.actualListenPort));
      this.sendServer(encodeSetStatus(UserStatus.ONLINE));
      // We never participate in the distributed search tree and never accept
      // children, which keeps the connection small and mobile friendly.
      this.sendServer(encodeHaveNoParent(true));
      this.sendServer(encodeAcceptChildren(false));

      this.startPing();
      this.reconnectAttempt = 0;
      this.setState('online');
      // Report our share honestly: peers check it before sending to us.
      this.refreshShares();
      this.emit('login', response);
      this.log(`Connecté en tant que ${this.username}, port ${this.actualListenPort}`);

      return response;
    } catch (error) {
      this.cleanupAfterFailure();
      const message = error instanceof Error ? error.message : 'Connexion impossible';
      this.setState('error', message);

      if (
        !this.manualDisconnect &&
        this.reconnectAttempt > 0 &&
        !(error instanceof LoginError)
      ) {
        this.scheduleReconnect();
      }

      throw error;
    }
  }

  disconnect(): void {
    this.manualDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.finishSearch();
    this.uploads?.stop();
    this.failAllTransfers('Déconnecté');
    this.closePeerSessions();
    this.stopPing();

    if (this.loginWaiter) {
      clearTimeout(this.loginWaiter.timer);
      this.loginWaiter.reject(new Error('Déconnecté'));
      this.loginWaiter = null;
    }

    this.rejectPeerAddressRequests('Déconnecté');

    if (this.serverSocket) {
      const socket = this.serverSocket;
      this.serverSocket = null;

      try {
        socket.destroy();
      } catch {
        // Ignore.
      }
    }

    this.serverFramer = null;
    this.loginResult = null;

    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    this.actualListenPort = 0;
    this.setState('disconnected');
  }

  private cleanupAfterFailure(): void {
    this.stopPing();

    if (this.serverSocket) {
      const socket = this.serverSocket;
      this.serverSocket = null;

      try {
        socket.destroy();
      } catch {
        // Ignore.
      }
    }

    this.serverFramer = null;

    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    this.actualListenPort = 0;
    this.loginResult = null;

    if (this.loginWaiter) {
      clearTimeout(this.loginWaiter.timer);
      this.loginWaiter = null;
    }
  }

  private handleServerClose(socket?: SocketLike): void {
    if (socket && this.serverSocket !== socket) {
      return;
    }

    const current = this.serverSocket;
    const wasOnline = this.stateValue === 'online' || this.stateValue === 'connecting';
    this.stopPing();
    this.serverSocket = null;

    if (current) {
      try {
        current.destroy();
      } catch {
        // Ignore.
      }
    }

    this.serverFramer = null;
    this.loginResult = null;
    this.finishSearch();
    this.failAllTransfers('Connexion au serveur perdue', false);
    this.closePeerSessions();
    this.rejectPeerAddressRequests('Connexion au serveur perdue');

    if (this.loginWaiter) {
      clearTimeout(this.loginWaiter.timer);
      this.loginWaiter.reject(new Error('Connexion au serveur perdue'));
      this.loginWaiter = null;
    }

    if (this.manualDisconnect) {
      this.setState('disconnected');
      return;
    }

    if (wasOnline) {
      this.setState('disconnected', 'Connexion au serveur perdue');
      this.scheduleReconnect();
    }
  }

  private rejectPeerAddressRequests(reason: string): void {
    for (const waiter of this.peerAddressWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }

    this.peerAddressWaiters.clear();
    this.peerAddressPending.clear();
    this.peerAddressCache.clear();
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) {
      return;
    }

    // Keep trying: on a phone the network often comes back minutes later.
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;
    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // `doConnect` schedules the next attempt.
      });
    }, delay);
  }

  /**
   * Skips the backoff and reconnects right away, e.g. when the network
   * comes back or the app returns to the foreground.
   */
  reconnectNow(): void {
    if (this.manualDisconnect || this.stateValue === 'online' || this.connectPromise) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempt = Math.max(1, this.reconnectAttempt);
    this.connect().catch(() => {});
  }

  private setState(state: ConnectionState, error?: string): void {
    this.stateValue = state;
    this.emit('state', { state, error });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.sendServer(encodeServerPing());
      } catch {
        // The close handler will clean up.
      }
    }, 55000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async startListener(): Promise<void> {
    if (this.listener) {
      return;
    }

    try {
      this.listener = await this.transport.listen(
        { host: '0.0.0.0', port: this.preferredListenPort },
        socket => this.handleIncomingSocket(socket),
      );
    } catch (error) {
      if (this.preferredListenPort === 0) {
        throw error;
      }

      this.log(
        `Port ${this.preferredListenPort} indisponible, utilisation d'un port aléatoire`,
      );
      this.listener = await this.transport.listen(
        { host: '0.0.0.0', port: 0 },
        socket => this.handleIncomingSocket(socket),
      );
    }

    this.actualListenPort = this.listener.port;
  }

  /* ---------------------------------------------------------------------- */
  /* Server messages                                                         */
  /* ---------------------------------------------------------------------- */

  private sendServer(data: Uint8Array): void {
    if (!this.serverSocket) {
      throw new Error('Non connecté au serveur Soulseek');
    }

    this.serverSocket.write(data);
  }

  private handleServerData(chunk: Uint8Array): void {
    if (!this.serverFramer) {
      return;
    }

    let frames;

    try {
      frames = this.serverFramer.push(chunk);
    } catch (error) {
      this.log(`Trame serveur invalide: ${(error as Error).message}`);
      this.handleServerClose(this.serverSocket ?? undefined);
      return;
    }

    for (const frame of frames) {
      try {
        this.handleServerFrame(frame.code, frame.payload);
      } catch (error) {
        this.log(`Message serveur ${frame.code} illisible: ${(error as Error).message}`);
      }
    }
  }

  private handleServerFrame(code: number, payload: Uint8Array): void {
    switch (code) {
      case ServerCode.LOGIN: {
        const response = parseLoginResponse(payload);

        if (this.loginWaiter) {
          clearTimeout(this.loginWaiter.timer);
          const waiter = this.loginWaiter;
          this.loginWaiter = null;
          waiter.resolve(response);
        }

        break;
      }

      case ServerCode.GET_PEER_ADDRESS: {
        const address = parsePeerAddress(payload);
        const waiter = this.peerAddressWaiters.get(address.username);

        if (waiter) {
          clearTimeout(waiter.timer);
          this.peerAddressWaiters.delete(address.username);

          if (address.ipAddress === '0.0.0.0' || address.port === 0) {
            waiter.reject(new Error("L'utilisateur est hors ligne"));
          } else {
            this.peerAddressCache.set(address.username, { address, at: Date.now() });
            waiter.resolve(address);
          }
        }

        break;
      }

      case ServerCode.CONNECT_TO_PEER: {
        const request = parseConnectToPeer(payload);
        void this.acceptIndirectConnection(request);
        break;
      }

      case ServerCode.CANT_CONNECT_TO_PEER: {
        const { token } = parseCantConnectToPeer(payload);
        const pierce = this.pendingPierces.get(token);

        if (pierce) {
          clearTimeout(pierce.timer);
          this.pendingPierces.delete(token);
          pierce.reject(new Error(`${pierce.username} ne peut pas se connecter à nous`));
        }

        this.log(`Connexion indirecte refusée (token ${token})`);
        break;
      }

      case ServerCode.RELOGGED: {
        this.emit('notice', 'Ce compte a été connecté depuis un autre client');
        this.manualDisconnect = true;
        this.disconnect();
        break;
      }

      case ServerCode.FILE_SEARCH:
      case ServerCode.GET_USER_STATUS: {
        // Server-distributed searches and status pushes are not needed by the
        // player; the distributed tree stays disabled.
        break;
      }

      default:
        break;
    }
  }

  private async acceptIndirectConnection(request: {
    username: string;
    connectionType: string;
    ipAddress: string;
    port: number;
    token: number;
  }): Promise<void> {
    if (
      request.connectionType !== ConnectionType.PEER &&
      request.connectionType !== ConnectionType.FILE
    ) {
      return;
    }

    if (request.port <= 0 || request.port > 65535) {
      return;
    }

    try {
      const socket = await this.transport.connect({
        host: request.ipAddress,
        port: request.port,
        timeoutMs: 15000,
      });

      socket.write(encodePierceFirewall(request.token));

      if (request.connectionType === ConnectionType.PEER) {
        if (this.inboundPeers.size >= MAX_INBOUND_PEERS) {
          socket.destroy();
          return;
        }

        this.attachPeerSession(request.username, socket, 'in', false);
      } else {
        this.attachIndirectFileConnection(request.username, socket);
      }
    } catch {
      try {
        this.sendServer(encodeCantConnectToPeer(request.token, request.username));
      } catch {
        // Ignore: the server connection may be gone.
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Searches                                                                */
  /* ---------------------------------------------------------------------- */

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    if (!this.isOnline()) {
      throw new Error('Non connecté au serveur Soulseek');
    }

    const trimmed = query.trim();

    if (trimmed.length === 0) {
      return [];
    }

    this.finishSearch();

    const token = this.nextToken();
    const hits = new Map<string, SearchHit>();

    const done = new Promise<SearchHit[]>(resolve => {
      const search: ActiveSearch = {
        token,
        query: trimmed,
        hits,
        onResults: options.onResults,
        timer: null,
        resolve,
      };

      search.timer = setTimeout(() => {
        // A timer callback may already be queued when a new search starts.
        // Only finish the search this timer belongs to.
        if (this.activeSearch === search) {
          this.finishSearch();
        }
      }, options.durationMs ?? this.searchDurationMs);

      this.activeSearch = search;
    });

    try {
      this.sendServer(encodeFileSearch(token, trimmed));
    } catch (error) {
      if (this.activeSearch?.token === token) {
        const search = this.activeSearch;
        this.activeSearch = null;

        if (search.timer) {
          clearTimeout(search.timer);
        }
      }

      throw error;
    }

    return done;
  }

  cancelSearch(): void {
    this.finishSearch();
  }

  private finishSearch(): void {
    const search = this.activeSearch;

    if (!search) {
      return;
    }

    this.activeSearch = null;

    if (search.timer) {
      clearTimeout(search.timer);
    }

    const results = Array.from(search.hits.values());
    this.emit('searchDone', { token: search.token, hits: results });
    search.resolve(results);
  }

  private handleSearchResponse(response: SearchResponse): void {
    const search = this.activeSearch;

    if (!search || response.token !== search.token) {
      return;
    }

    const fresh: SearchHit[] = [];

    for (const file of response.files) {
      if (search.hits.size >= MAX_SEARCH_HITS) {
        break;
      }

      if (!isStreamableFile(file.filename)) {
        continue;
      }

      const key = hitKey({ username: response.username, filename: file.filename });

      if (search.hits.has(key)) {
        continue;
      }

      const hit: SearchHit = {
        ...file,
        username: response.username,
        slotFree: response.slotFree,
        avgSpeed: response.avgSpeed,
        queueLength: response.queueLength,
        extension: extensionOf(file.filename),
      };

      search.hits.set(key, hit);
      fresh.push(hit);
    }

    if (fresh.length > 0) {
      try {
        search.onResults?.(fresh);
      } catch {
        // Ignore UI callback errors.
      }

      this.emit('searchResults', { token: search.token, hits: fresh });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Peer connections                                                         */
  /* ---------------------------------------------------------------------- */

  private async getPeerAddress(username: string): Promise<PeerAddress> {
    const cached = this.peerAddressCache.get(username);

    if (cached && Date.now() - cached.at < PEER_ADDRESS_TTL_MS) {
      return cached.address;
    }

    const pending = this.peerAddressPending.get(username);

    if (pending) {
      return pending;
    }

    const promise = new Promise<PeerAddress>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.peerAddressWaiters.delete(username);
        reject(new Error(`Adresse de ${username} introuvable`));
      }, 15000);

      this.peerAddressWaiters.set(username, { resolve, reject, timer });

      try {
        this.sendServer(encodeGetPeerAddress(username));
      } catch (error) {
        clearTimeout(timer);
        this.peerAddressWaiters.delete(username);
        reject(error as Error);
      }
    }).finally(() => {
      this.peerAddressPending.delete(username);
    });

    this.peerAddressPending.set(username, promise);
    return promise;
  }

  private async getPeerConnection(username: string): Promise<PeerSession> {
    const key = userKey(username);
    const existing = this.outboundPeers.get(key);

    if (existing?.isOpen) {
      return existing;
    }

    // The peer may already be connected to us (it delivered search results
    // over that connection). Reusing it saves a round trip and works even
    // when the peer is behind a firewall.
    for (const session of this.inboundPeers) {
      if (session.isOpen && userKey(session.username) === key) {
        session.pin();
        return session;
      }
    }

    const pending = this.peerConnecting.get(key);

    if (pending) {
      return pending;
    }

    const promise = this.openPeerConnection(username).finally(() => {
      this.peerConnecting.delete(key);
    });

    this.peerConnecting.set(key, promise);
    return promise;
  }

  /**
   * Opens a P connection the way regular clients do: a direct connection to
   * the peer and, at the same time, a ConnectToPeer request through the
   * server so a firewalled peer can connect to us instead. The first one to
   * succeed wins; the other is discarded.
   */
  private async openPeerConnection(username: string): Promise<PeerSession> {
    let settled = false;
    const direct = this.connectDirect(username);
    const indirect = this.connectIndirect(username, ConnectionType.PEER, (socket, rest) => {
      const session = this.attachPeerSession(username, socket, 'out', false);

      if (rest) {
        session.receive(rest);
      }

      return session;
    });

    // Whatever loses the race must not leak a socket.
    const discard = (socket: SocketLike) => {
      if (settled) {
        socket.destroy();
      }
    };

    let winner: { socket: SocketLike } | { session: PeerSession };

    try {
      winner = await firstSuccess<{ socket: SocketLike } | { session: PeerSession }>([
        direct.promise.then(socket => ({ socket })),
        indirect.promise.then(session => ({ session })),
      ]);
    } catch (error) {
      settled = true;
      indirect.cancel();
      throw error instanceof Error ? error : new Error(`Impossible de joindre ${username}`);
    }

    settled = true;

    if ('session' in winner) {
      // The peer connected to us after our ConnectToPeer; that session is
      // already attached and needs no PeerInit.
      direct.promise.then(discard, () => {});
      return winner.session;
    }

    indirect.cancel();
    return this.attachPeerSession(username, winner.socket, 'out', true);
  }

  private connectDirect(username: string): { promise: Promise<SocketLike> } {
    const connect = async () => {
      const address = await this.getPeerAddress(username);
      return this.transport.connect({
        host: address.ipAddress,
        port: address.port,
        timeoutMs: PEER_CONNECT_TIMEOUT_MS,
      });
    };

    const promise = (async () => {
      try {
        return await connect();
      } catch {
        // The cached port may be stale (peers change ports without changing
        // their username). Refresh the address once before giving up.
        this.peerAddressCache.delete(username);
        return connect();
      }
    })();

    // Avoid an unhandled rejection when the indirect path wins.
    promise.catch(() => {});
    return { promise };
  }

  /**
   * Asks the server to make `username` connect to us (ConnectToPeer). When
   * the peer's PierceFirewall arrives, `attach` takes over the socket.
   */
  private connectIndirect<T>(
    username: string,
    type: string,
    attach: (socket: SocketLike, rest: Uint8Array | null) => T,
  ): { promise: Promise<T>; cancel: () => void } {
    const token = this.nextToken();

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPierces.delete(token);
        reject(new Error(`${username} ne répond pas`));
      }, INDIRECT_CONNECT_TIMEOUT_MS);

      this.pendingPierces.set(token, {
        username,
        type,
        accept: (socket, rest) => {
          try {
            resolve(attach(socket, rest));
          } catch (error) {
            socket.destroy();
            reject(error as Error);
          }
        },
        reject,
        timer,
      });

      try {
        this.sendServer(encodeConnectToPeer(token, username, type));
      } catch (error) {
        clearTimeout(timer);
        this.pendingPierces.delete(token);
        reject(error as Error);
      }
    });

    promise.catch(() => {});

    return {
      promise,
      cancel: () => {
        const pierce = this.pendingPierces.get(token);

        if (pierce) {
          clearTimeout(pierce.timer);
          this.pendingPierces.delete(token);
        }
      },
    };
  }

  /**
   * Opens an F connection to `username` for an upload: direct (with a
   * PeerInit of type F) raced against ConnectToPeer.
   */
  private async openFileConnection(
    username: string,
  ): Promise<{ socket: SocketLike; rest: Uint8Array | null }> {
    let settled = false;
    const direct = this.connectDirect(username);
    const indirect = this.connectIndirect(username, ConnectionType.FILE, (socket, rest) => ({
      socket,
      rest,
    }));

    try {
      const winner = await firstSuccess([
        direct.promise.then(socket => {
          socket.write(encodePeerInit(this.username, ConnectionType.FILE));
          return { socket, rest: null as Uint8Array | null, direct: true };
        }),
        indirect.promise.then(result => ({ ...result, direct: false })),
      ]);

      settled = true;

      if (winner.direct) {
        indirect.cancel();
      } else {
        direct.promise.then(socket => settled && socket.destroy(), () => {});
      }

      return { socket: winner.socket, rest: winner.rest };
    } catch (error) {
      indirect.cancel();
      throw error instanceof Error ? error : new Error(`Impossible de joindre ${username}`);
    }
  }

  private attachPeerSession(
    username: string,
    socket: SocketLike,
    direction: 'in' | 'out',
    sendPeerInit: boolean,
  ): PeerSession {
    const session = new PeerSession(
      username,
      socket,
      direction,
      (peer, frame) => this.handlePeerFrame(peer, frame.code, frame.payload),
      closed => this.handlePeerSessionClosed(closed),
    );

    if (direction === 'out') {
      this.outboundPeers.set(userKey(username), session);
    } else {
      this.inboundPeers.add(session);
    }

    if (sendPeerInit) {
      session.send(encodePeerInit(this.username, ConnectionType.PEER));
    }

    return session;
  }

  private handlePeerSessionClosed(session: PeerSession): void {
    if (this.outboundPeers.get(userKey(session.username)) === session) {
      this.outboundPeers.delete(userKey(session.username));
    }

    this.inboundPeers.delete(session);

    // Give the peer a few seconds to reconnect (often through ConnectToPeer)
    // before failing transfers that are still waiting for a TransferRequest.
    const timer = setTimeout(() => {
      this.pendingPeerTimers.delete(timer);

      if (this.hasPeerSessionFor(session.username)) {
        return;
      }

      for (const transfer of Array.from(this.transfers.values())) {
        if (
          transfer.isActive &&
          transfer.token === null &&
          transfer.hit.username.toLowerCase() === session.username.toLowerCase()
        ) {
          transfer.fail('Connexion au pair perdue');
        }
      }
    }, 5000);

    this.pendingPeerTimers.add(timer);
  }

  private hasPeerSessionFor(username: string): boolean {
    if (this.outboundPeers.get(userKey(username))?.isOpen) {
      return true;
    }

    for (const session of this.inboundPeers) {
      if (session.isOpen && userKey(session.username) === userKey(username)) {
        return true;
      }
    }

    return false;
  }

  private closePeerSessions(): void {
    for (const timer of this.pendingPeerTimers) {
      clearTimeout(timer);
    }

    this.pendingPeerTimers.clear();

    for (const session of Array.from(this.outboundPeers.values())) {
      session.close();
    }

    for (const session of Array.from(this.inboundPeers)) {
      session.close();
    }

    this.outboundPeers.clear();
    this.inboundPeers.clear();
    this.peerConnecting.clear();

    for (const pierce of this.pendingPierces.values()) {
      clearTimeout(pierce.timer);
      pierce.reject(new Error('Connexion fermée'));
    }

    this.pendingPierces.clear();
  }

  private handlePeerFrame(session: PeerSession, code: number, payload: Uint8Array): void {
    switch (code) {
      case PeerCode.FILE_SEARCH_RESPONSE: {
        // After a search is stopped (e.g. a good match was found), peers keep
        // sending late compressed responses. Do not inflate/parse them: this
        // used to block the JS thread while a track was loading.
        if (!this.activeSearch) {
          break;
        }

        // A huge response cannot help the "first good match" flow and would
        // freeze the UI while pako inflates it on the JS thread.
        if (payload.length > MAX_SEARCH_RESPONSE_BYTES) {
          break;
        }

        const response = parseFileSearchResponse(payload);
        this.handleSearchResponse(response);
        break;
      }

      case PeerCode.GET_SHARE_FILE_LIST: {
        session.send(encodeSharedFileListResponse(this.shares?.files() ?? []));
        break;
      }

      case PeerCode.FOLDER_CONTENTS_REQUEST: {
        const request = parseFolderContentsRequest(payload);
        session.send(
          encodeFolderContentsResponse(request.token, request.folder, this.shares?.files() ?? []),
        );
        break;
      }

      case PeerCode.USER_INFO_REQUEST: {
        session.send(
          encodeUserInfoResponse({
            description: this.description,
            uploadSlots: this.uploads?.slots ?? 0,
            queueSize: this.uploads?.queueLength ?? 0,
            slotsFree: this.uploads?.hasFreeSlot ?? false,
          }),
        );
        break;
      }

      case PeerCode.QUEUE_UPLOAD: {
        const { filename } = parseQueueUpload(payload);

        if (this.uploads) {
          this.uploads.enqueue(session.username, filename, message => session.send(message));
        } else {
          session.send(encodeUploadDenied(filename, 'File not shared.'));
        }

        break;
      }

      case PeerCode.PLACE_IN_QUEUE_REQUEST: {
        const { filename } = parsePlaceInQueueRequest(payload);

        if (this.uploads) {
          session.send(this.uploads.placeInQueue(session.username, filename));
        }

        break;
      }

      case PeerCode.TRANSFER_RESPONSE: {
        const response = parseTransferResponse(payload);
        this.uploads?.handleTransferResponse(response.token, response.allowed);
        break;
      }

      case PeerCode.TRANSFER_REQUEST: {
        const request = parseTransferRequest(payload);

        if (request.direction !== TransferDirection.UPLOAD) {
          return;
        }

        const key = hitKey({ username: session.username, filename: request.filename });
        const transfer = this.transfersByKey.get(key);

        if (
          !transfer ||
          !transfer.isActive ||
          transfer.token !== null ||
          !request.size ||
          request.size <= 0
        ) {
          session.send(encodeTransferResponse(request.token, false, 'Cancelled'));
          return;
        }

        transfer.markAwaiting(request.token, request.size);
        this.transfersByToken.set(request.token, transfer);
        this.stopQueuePolling(transfer.id);
        session.send(encodeTransferResponse(request.token, true));
        break;
      }

      case PeerCode.PLACE_IN_QUEUE_RESPONSE: {
        const response = parsePlaceInQueueResponse(payload);
        const transfer = this.transfersByKey.get(
          hitKey({ username: session.username, filename: response.filename }),
        );

        if (transfer?.isActive) {
          transfer.setQueuePosition(response.place);
        }

        break;
      }

      case PeerCode.UPLOAD_DENIED: {
        const response = parseUploadDenied(payload);
        const transfer = this.transfersByKey.get(
          hitKey({ username: session.username, filename: response.filename }),
        );

        transfer?.fail(`Refusé par le pair : ${response.reason}`);
        break;
      }

      case PeerCode.UPLOAD_FAILED: {
        const response = parseUploadFailed(payload);
        const transfer = this.transfersByKey.get(
          hitKey({ username: session.username, filename: response.filename }),
        );

        transfer?.fail('Le pair a signalé un échec du transfert');
        break;
      }

      default:
        break;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Downloads / streams                                                     */
  /* ---------------------------------------------------------------------- */

  createTransfer(hit: SearchHit): StreamTransfer {
    if (!this.isOnline()) {
      throw new Error('Non connecté au serveur Soulseek');
    }

    if (!isStreamableFile(hit.filename)) {
      throw new Error('Seuls les fichiers MP3 sont pris en charge');
    }

    const key = hitKey(hit);
    const existing = this.transfersByKey.get(key);

    if (existing?.isActive) {
      return existing;
    }

    const transfer = new StreamTransfer(hit, value => this.handleTransferChange(value));
    this.transfers.set(transfer.id, transfer);
    this.transfersByKey.set(key, transfer);
    this.handleTransferChange(transfer);

    void this.beginTransfer(transfer);
    return transfer;
  }

  private async beginTransfer(transfer: StreamTransfer): Promise<void> {
    try {
      const session = await this.getPeerConnection(transfer.hit.username);

      if (!transfer.isActive) {
        return;
      }

      if (!session.isOpen) {
        throw new Error('Le pair a fermé la connexion');
      }

      session.send(encodeQueueUpload(transfer.hit.filename));
      transfer.markQueued();
      this.startQueuePolling(transfer, session);
    } catch (error) {
      transfer.fail(
        error instanceof Error ? error.message : 'Impossible de joindre le pair',
      );
    }
  }

  private startQueuePolling(transfer: StreamTransfer, session: PeerSession): void {
    this.stopQueuePolling(transfer.id);

    let polls = 0;

    const poll = () => {
      if (!transfer.isActive || !session.isOpen) {
        this.stopQueuePolling(transfer.id);
        return;
      }

      if (polls >= MAX_QUEUE_POLLS) {
        this.stopQueuePolling(transfer.id);
        return;
      }

      polls++;
      session.send(encodePlaceInQueueRequest(transfer.hit.filename));
    };

    // One early position request, then at most one per minute. This keeps the
    // queue informative without hammering the peer.
    const initial = setTimeout(poll, 3000);
    const interval = setInterval(poll, QUEUE_POLL_MS);
    this.queuePollers.set(transfer.id, { initial, interval });
  }

  private stopQueuePolling(transferId: string): void {
    const poller = this.queuePollers.get(transferId);

    if (!poller) {
      return;
    }

    if (poller.initial) {
      clearTimeout(poller.initial);
    }

    if (poller.interval) {
      clearInterval(poller.interval);
    }

    this.queuePollers.delete(transferId);
  }

  private handleTransferChange(transfer: StreamTransfer): void {
    this.emit('transfer', transfer.snapshot());

    if (transfer.state === 'complete' || transfer.state === 'failed' || transfer.state === 'cancelled') {
      this.stopQueuePolling(transfer.id);

      if (transfer.token !== null) {
        this.transfersByToken.delete(transfer.token);
      }

      const key = hitKey(transfer.hit);

      if (this.transfersByKey.get(key) === transfer) {
        this.transfersByKey.delete(key);
      }

      if (transfer.state !== 'complete') {
        // Keep a bounded history of finished/failed transfers.
        this.transfers.delete(transfer.id);
      }
    }
  }

  getTransfer(transferId: string): StreamTransfer | null {
    return this.transfers.get(transferId) ?? null;
  }

  cancelTransfer(transferId: string): void {
    const transfer = this.transfers.get(transferId) ?? Array.from(this.transfers.values()).find(t => t.id === transferId);

    if (!transfer) {
      return;
    }

    transfer.cancel();
    this.stopQueuePolling(transfer.id);

    if (transfer.token !== null) {
      this.transfersByToken.delete(transfer.token);
    }

    const session = this.outboundPeers.get(userKey(transfer.hit.username));

    if (session && !this.hasActiveTransferWith(transfer.hit.username, transfer.id)) {
      // Closing the P connection is the protocol's way of cancelling a queued
      // upload request.
      session.close();
    }
  }

  private hasActiveTransferWith(username: string, exceptId: string): boolean {
    for (const transfer of this.transfers.values()) {
      if (
        transfer.id !== exceptId &&
        transfer.isActive &&
        userKey(transfer.hit.username) === userKey(username)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Fails transfers after the server connection is gone. A transfer that is
   * already streaming has its own F connection to the peer and does not need
   * the server, so it keeps going unless `includeStreaming` is set.
   */
  private failAllTransfers(reason: string, includeStreaming = true): void {
    for (const transfer of Array.from(this.transfers.values())) {
      if (!transfer.isActive) {
        continue;
      }

      if (!includeStreaming && transfer.state === 'streaming') {
        continue;
      }

      transfer.fail(reason);
    }

    for (const [id, transfer] of Array.from(this.transfers.entries())) {
      if (!transfer.isActive && transfer.state !== 'complete') {
        this.transfers.delete(id);
      }
    }

    if (includeStreaming) {
      this.transfers.clear();
      this.transfersByKey.clear();
    }

    this.transfersByToken.clear();

    for (const poller of this.queuePollers.values()) {
      if (poller.initial) {
        clearTimeout(poller.initial);
      }

      if (poller.interval) {
        clearInterval(poller.interval);
      }
    }

    this.queuePollers.clear();
  }

  /* ---------------------------------------------------------------------- */
  /* Incoming connections                                                    */
  /* ---------------------------------------------------------------------- */

  private handleIncomingSocket(socket: SocketLike): void {
    const queue = new ByteQueue();

    let phase: 'init' | 'peer' | 'file-init' | 'file-data' = 'init';
    let session: PeerSession | null = null;

    const initTimer = setTimeout(() => {
      if (phase === 'init') {
        socket.destroy();
      }
    }, 15000);

    const cleanup = () => {
      clearTimeout(initTimer);
    };

    const pump = (): void => {
      if (phase === 'peer' || phase === 'file-data') {
        // A PeerSession or a StreamTransfer now owns the socket data.
        return;
      }

      if (phase === 'init') {
        if (queue.length < 5) {
          return;
        }

        const declared = readU32(queue.peek(4), 0);

        if (declared < 1 || declared > MAX_FRAME_SIZE) {
          socket.destroy();
          cleanup();
          return;
        }

        if (queue.length < declared + 4) {
          return;
        }

        queue.skip(4);
        const frame = queue.take(declared);
        const code = frame[0];

        if (code === PeerInitCode.PEER_INIT) {
          const init = parsePeerInit(frame.subarray(1));
          clearTimeout(initTimer);

          if (init.connectionType === ConnectionType.PEER) {
            if (this.inboundPeers.size >= MAX_INBOUND_PEERS) {
              socket.destroy();
              cleanup();
              return;
            }

            session = this.attachPeerSession(init.username, socket, 'in', false);
            phase = 'peer';

            if (queue.length > 0) {
              session.receive(queue.take(queue.length));
            }

            return;
          }

          if (init.connectionType === ConnectionType.FILE) {
            phase = 'file-init';
            pump();
            return;
          }

          socket.destroy();
          cleanup();
          return;
        }

        if (code === PeerInitCode.PIERCE_FIREWALL && frame.length >= 5) {
          // Answer to one of our ConnectToPeer requests.
          const token = readU32(frame, 1);
          const pierce = this.pendingPierces.get(token);
          clearTimeout(initTimer);

          if (!pierce) {
            socket.destroy();
            cleanup();
            return;
          }

          this.pendingPierces.delete(token);
          clearTimeout(pierce.timer);
          // From here the socket belongs to whoever asked for it (a P session
          // or an upload); this listener stops reading.
          phase = pierce.type === ConnectionType.PEER ? 'peer' : 'file-data';
          const rest = queue.length > 0 ? queue.take(queue.length) : null;
          pierce.accept(socket, rest);
          return;
        }

        socket.destroy();
        cleanup();
        return;
      }

      if (phase === 'file-init') {
        if (queue.length < 4) {
          return;
        }

        const token = readU32(queue.peek(4), 0);
        queue.skip(4);
        const transfer = this.transfersByToken.get(token) ?? null;

        if (!transfer) {
          socket.destroy();
          cleanup();
          return;
        }

        this.transfersByToken.delete(token);
        const initial = queue.take(queue.length);
        phase = 'file-data';
        transfer.attach(socket, initial);
        cleanup();
        return;
      }
    };

    socket.on('data', chunk => {
      if (!(chunk instanceof Uint8Array) || phase === 'peer' || phase === 'file-data') {
        return;
      }

      queue.push(chunk);
      pump();
    });

    socket.on('close', () => {
      cleanup();

      if (session) {
        this.handlePeerSessionClosed(session);
      }
    });

    socket.on('error', () => {
      cleanup();
    });
  }

  private attachIndirectFileConnection(username: string, socket: SocketLike): void {
    const queue = new ByteQueue();
    let attached = false;

    const timer = setTimeout(() => {
      if (!attached) {
        socket.destroy();
      }
    }, 20000);

    socket.on('data', chunk => {
      if (attached || !(chunk instanceof Uint8Array)) {
        return;
      }

      queue.push(chunk);

      if (queue.length < 4) {
        return;
      }

      const token = readU32(queue.peek(4), 0);
      queue.skip(4);
      const rest = queue.take(queue.length);
      const transfer = this.transfersByToken.get(token);

      if (!transfer || (transfer.hit.username !== username && transfer.hit.username.toLowerCase() !== username.toLowerCase())) {
        socket.destroy();
        clearTimeout(timer);
        return;
      }

      attached = true;
      clearTimeout(timer);
      this.transfersByToken.delete(token);
      transfer.attach(socket, rest);
    });

    socket.on('close', () => clearTimeout(timer));
    socket.on('error', () => clearTimeout(timer));
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                 */
  /* ---------------------------------------------------------------------- */

  private isOnline(): boolean {
    return this.stateValue === 'online' && this.serverSocket !== null;
  }

  private nextToken(): number {
    this.nextTokenValue = (this.nextTokenValue + 1) >>> 0;

    if (this.nextTokenValue === 0) {
      this.nextTokenValue = 1;
    }

    return this.nextTokenValue;
  }

  private log(message: string): void {
    this.emit('log', message);
  }
}

export class LoginError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

function formatLoginError(reason: string, detail?: string): string {
  switch (reason) {
    case LoginRejection.INVALIDPASS:
      return 'Mot de passe incorrect';
    case LoginRejection.EMPTYPASSWORD:
      return 'Le mot de passe est vide';
    case LoginRejection.INVALIDUSERNAME:
      return detail ? `Nom d'utilisateur invalide : ${detail}` : "Nom d'utilisateur invalide";
    case LoginRejection.INVALIDVERSION:
      return 'Version de client refusée par le serveur';
    case LoginRejection.SVRFULL:
      return 'Le serveur Soulseek est complet, réessayez plus tard';
    case LoginRejection.SVRPRIVATE:
      return "Le serveur n'accepte pas de nouvelles inscriptions";
    default:
      return `Connexion refusée : ${reason}`;
  }
}
