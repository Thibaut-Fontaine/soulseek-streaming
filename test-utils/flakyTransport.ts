import type { ConnectOptions, ListenerLike, ListenOptions, SocketLike, Transport } from '../src/transport/types';
import { NodeTransport } from '../src/transport/nodeTransport';

/**
 * TCP transport that can fail its first connections, to reproduce a phone
 * that starts offline and comes back. Used by the reconnection tests.
 */
export class FlakyTransport implements Transport {
  static failuresLeft = 0;

  private readonly inner = new NodeTransport();

  connect(options: ConnectOptions): Promise<SocketLike> {
    if (FlakyTransport.failuresLeft > 0) {
      FlakyTransport.failuresLeft--;
      return Promise.reject(new Error('Réseau indisponible'));
    }

    return this.inner.connect(options);
  }

  listen(options: ListenOptions, onConnection: (socket: SocketLike) => void): Promise<ListenerLike> {
    return this.inner.listen(options, onConnection);
  }
}
