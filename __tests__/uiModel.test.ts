import type { SearchHit } from '../src/core/types';
import {
  bitrateLabel,
  clampSeek,
  groupSources,
  peerBadges,
  transferSteps,
} from '../src/ui/p2p';
import { coverPalette } from '../src/ui/theme';

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    username: 'peer',
    filename: 'Music\\Radiohead\\The Bends\\Radiohead - Fake Plastic Trees.mp3',
    size: 11 * 1024 * 1024,
    bitrate: 320,
    durationSec: 290,
    slotFree: true,
    avgSpeed: 1.4 * 1024 * 1024,
    queueLength: 0,
    extension: 'mp3',
    ...overrides,
  };
}

describe('clampSeek', () => {
  it('keeps seeks inside the received range', () => {
    expect(clampSeek(30, 300, 0.5)).toEqual({ seconds: 30, clamped: false });
  });

  it('clamps seeks past the received edge', () => {
    expect(clampSeek(250, 300, 0.5)).toEqual({ seconds: 148, clamped: true });
  });

  it('does not clamp once the file is complete', () => {
    expect(clampSeek(299, 300, 1)).toEqual({ seconds: 299, clamped: false });
  });

  it('bounds to the track and handles unknown durations', () => {
    expect(clampSeek(-5, 300, 1).seconds).toBe(0);
    expect(clampSeek(10, 0, 0.5)).toEqual({ seconds: 0, clamped: false });
  });
});

describe('transferSteps', () => {
  it('starts at the request step', () => {
    expect(transferSteps(undefined, 1000).map(step => step.status)).toEqual([
      'current',
      'todo',
      'todo',
      'todo',
    ]);
  });

  it('shows the queue position', () => {
    const steps = transferSteps({ state: 'queued', received: 0, queuePosition: 14 }, 1000);
    expect(steps[0].status).toBe('done');
    expect(steps[1]).toMatchObject({ status: 'current', label: 'En file · position 14' });
  });

  it('fills the buffer step with received bytes', () => {
    const steps = transferSteps({ state: 'streaming', received: 1024 * 1024, queuePosition: null }, 2 * 1024 * 1024);
    expect(steps[3]).toMatchObject({ status: 'current', progress: 0.5 });
    expect(steps[3].label).toBe('Tampon 1,0 Mo / 2,0 Mo');
  });

  it('marks the failing step', () => {
    expect(transferSteps({ state: 'failed', received: 0, queuePosition: null }, 1000)[0].status).toBe('failed');
    expect(transferSteps({ state: 'failed', received: 10, queuePosition: null }, 1000)[3].status).toBe('failed');
  });
});

describe('peer badges', () => {
  it('labels bitrates', () => {
    expect(bitrateLabel({ bitrate: 320 })).toBe('320');
    expect(bitrateLabel({ bitrate: 245, vbr: true })).toBe('V0');
    expect(bitrateLabel({})).toBeNull();
  });

  it('describes a free fast peer', () => {
    const badges = peerBadges(hit());
    expect(badges.map(badge => [badge.label, badge.tone])).toEqual([
      ['320', 'accent'],
      ['Libre', 'good'],
      ['1,4 Mo/s', 'info'],
      ['11 Mo', 'neutral'],
    ]);
  });

  it('flags long queues', () => {
    const slot = peerBadges(hit({ slotFree: false, queueLength: 80 })).find(b => b.key === 'slot');
    expect(slot).toMatchObject({ label: 'File 80', tone: 'bad' });
  });
});

describe('groupSources', () => {
  it('groups by title and orders peers best first', () => {
    const groups = groupSources([
      hit({ username: 'slow', slotFree: false, queueLength: 4 }),
      hit({ username: 'fast' }),
      hit({ username: 'live', filename: 'x/Radiohead - Fake Plastic Trees (Live).mp3' }),
      hit({ username: 'fast' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].hits.map(h => h.username)).toEqual(['fast', 'slow']);
    expect(groups[0].allQueued).toBe(false);
    // Titles are shown without the artist, which is displayed separately.
    expect(groups[1].title).toBe('Fake Plastic Trees (Live)');
  });
});

describe('coverPalette', () => {
  it('is deterministic', () => {
    expect(coverPalette('abc')).toEqual(coverPalette('abc'));
    expect(coverPalette('abc').deep).toMatch(/^hsl\(/);
  });
});
