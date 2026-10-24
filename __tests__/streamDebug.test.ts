import { MultiPeerNetwork } from '../test-utils/multiPeerNetwork';
import type { FakePeer } from '../test-utils/multiPeerNetwork';

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    add: jest.fn(async () => {}),
    play: jest.fn(async () => {}),
    reset: jest.fn(async () => {}),
  },
}));
jest.mock('../src/player/player', () => ({
  ensurePlayer: jest.fn(async () => {}),
  resetPlayer: jest.fn(async () => {}),
}));
jest.mock('../src/services/settings', () => ({
  loadSettings: jest.fn(),
  saveSettings: jest.fn(async () => {}),
  loadCredentials: jest.fn(async () => null),
  saveCredentials: jest.fn(async () => {}),
  clearCredentials: jest.fn(async () => {}),
}));
// The app's TCP transport is react-native-tcp-socket; tests use node:net.
jest.mock('../src/transport/rnTcpTransport', () => ({
  ReactNativeTransport: jest.requireActual('../src/transport/nodeTransport').NodeTransport,
}));

import { useAppStore } from '../src/state/store';

jest.setTimeout(30000);

const TRACK = 'Music\\Fake Artist\\Album\\01 - Stream Me.mp3';

async function withNetwork(peers: FakePeer[], run: (network: MultiPeerNetwork) => Promise<void>) {
  const network = new MultiPeerNetwork(peers);
  await network.start();
  useAppStore.setState({
    settings: {
      serverHost: '127.0.0.1',
      serverPort: network.serverPort,
      listenPort: 0,
      streamPort: 0,
      bufferMb: 0.25,
      shareEnabled: false,
      shareWifiOnly: true,
      cacheMb: 1024,
    },
  });

  try {
    expect(await useAppStore.getState().login('tester', 'secret')).toBe(true);
    await run(network);
  } finally {
    await useAppStore.getState().logout();
    await network.stop();
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('waitFor timed out'));
      } else {
        setTimeout(tick, 50);
      }
    };
    tick();
  });
}


import http from 'node:http';
import { formatDebugLog } from '../src/services/debugLog';

test('a played track is served to the player and every step is logged', async () => {
  await withNetwork(
    [{ username: 'peer_ok', filename: TRACK, behavior: 'ok', avgSpeed: 50_000 }],
    async () => {
      // Search lists the result; the user picks it.
      await useAppStore.getState().runSearch('fake artist stream me');
      await useAppStore.getState().playTrack(useAppStore.getState().results[0].hit);
      await waitFor(() => useAppStore.getState().current?.phase === 'playing');
      const url = useAppStore.getState().current!.url;
      const got = await new Promise<{ status: number; bytes: number; headers: any }>((resolve, reject) => {
        http.get(url, { headers: { Range: 'bytes=0-', 'User-Agent': 'ExoPlayerLib/2.x' } }, res => {
          let bytes = 0;
          res.on('data', c => (bytes += c.length));
          res.on('end', () => resolve({ status: res.statusCode!, bytes, headers: res.headers }));
        }).on('error', reject);
      });
      expect(got.status).toBe(206);
      expect(got.bytes).toBe(300000);
      expect(got.headers['content-type']).toBe('audio/mpeg');

      const log = formatDebugLog();
      expect(log).toMatch(/QueueUpload envoyé à peer_ok/);
      expect(log).toMatch(/TransferRequest accepté/);
      expect(log).toMatch(/connexion F entrante, token \d+ : transfert de peer_ok/);
      expect(log).toMatch(/lecture demandée/);
      expect(log).toMatch(/→ 206 octets 0-299999\/300000/);
    },
  );
});
