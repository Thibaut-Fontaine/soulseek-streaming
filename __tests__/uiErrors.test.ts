import { describePlaybackError } from '../src/ui/errors';

describe('describePlaybackError', () => {
  it('maps an offline peer', () => {
    const result = describePlaybackError("L'utilisateur est hors ligne");
    expect(result.kind).toBe('peer-offline');
    expect(result.title).toBe('Pair hors ligne');
    expect(result.actions).toEqual(['next-source', 'retry']);
  });

  it('explains sharing refusals', () => {
    const result = describePlaybackError('Refusé par le pair : No sharing, no downloads');
    expect(result.kind).toBe('peer-refused-sharing');
    expect(result.title).toBe('Refusé par le pair');
    expect(result.body).toMatch(/ne partage pas encore/);
    expect(result.actions).toEqual(['next-source', 'learn-more']);
  });

  it('treats banned reasons as sharing refusals', () => {
    expect(describePlaybackError('Refusé par le pair : Banned').kind).toBe('peer-refused-sharing');
  });

  it.each(['Too many megabytes', 'Too many files', 'Queue full', 'Too many megabytes (2 sources essayées)'])(
    'explains queue quota refusals (%s) in French',
    reason => {
      const result = describePlaybackError(`Refusé par le pair : ${reason}`);
      expect(result.kind).toBe('peer-quota');
      expect(result.title).toBe('File d’attente pleine chez ce pair');
      expect(result.body).not.toContain('Too many');
      expect(result.actions).toEqual(['next-source', 'retry']);
    },
  );

  it('quotes other refusal reasons', () => {
    const result = describePlaybackError('Refusé par le pair : Queued');
    expect(result.kind).toBe('peer-refused');
    expect(result.body).toContain('« Queued »');
    expect(result.actions).toContain('next-source');
  });

  it.each([
    "Le pair n'a pas ouvert la connexion de transfert",
    'Adresse de some_user introuvable',
    'Impossible de joindre le pair',
    'Le pair a fermé la connexion',
  ])('maps "%s" to an unreachable peer', message => {
    const result = describePlaybackError(message);
    expect(result.kind).toBe('peer-unreachable');
    expect(result.title).toBe('Impossible de joindre le pair');
    expect(result.body).toMatch(/pare-feu/);
    expect(result.actions[0]).toBe('next-source');
  });

  it.each([
    'Connexion au pair perdue',
    'Le pair a interrompu le transfert',
    'Le transfert a été interrompu',
    'Le pair a signalé un échec du transfert',
  ])('maps "%s" to a lost connection', message => {
    expect(describePlaybackError(message).kind).toBe('connection-lost');
  });

  it('includes the received share for mid-stream losses', () => {
    const result = describePlaybackError('Connexion au pair perdue', { receivedRatio: 0.62 });
    expect(result.title).toBe('Connexion perdue à 62 %');
    expect(describePlaybackError('Connexion au pair perdue').title).toBe('Connexion perdue');
  });

  it('maps the buffer timeout to a slow peer', () => {
    const result = describePlaybackError('Délai de mise en mémoire tampon dépassé');
    expect(result.kind).toBe('too-slow');
    expect(result.title).toBe('Pair trop lent');
    expect(result.actions[0]).toBe('next-source');
  });

  it.each(['Non connecté au réseau Soulseek', 'Non connecté', 'Connexion au serveur perdue', 'Déconnecté'])(
    'maps "%s" to a server outage with a reconnect action',
    message => {
      const result = describePlaybackError(message);
      expect(result.kind).toBe('server-offline');
      expect(result.actions).toEqual(['reconnect']);
    },
  );

  it.each(['Lecture annulée', 'Transfert annulé'])('maps "%s" to a cancellation', message => {
    expect(describePlaybackError(message).kind).toBe('cancelled');
  });

  it('maps the MP3-only rule', () => {
    expect(describePlaybackError('Seuls les fichiers MP3 sont pris en charge').kind).toBe('unsupported');
  });

  it('falls back to the raw message', () => {
    const result = describePlaybackError('Transfert introuvable');
    expect(result.kind).toBe('unknown');
    expect(result.body).toBe('Transfert introuvable');
    expect(result.actions).toEqual(['retry', 'next-source']);
  });

  it('handles empty input', () => {
    expect(describePlaybackError(null).body).toMatch(/n’a pas pu être lu/);
  });
});
