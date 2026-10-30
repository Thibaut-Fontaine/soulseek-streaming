import {
  MAX_LOG_EVENTS,
  MAX_LOG_MESSAGE,
  isInstallationId,
  parseLogReport,
  redactLogText,
} from '../src/core/logPrivacy';

describe('log redaction', () => {
  test('removes passwords, tokens and API keys', () => {
    const line = [
      'login password=hunter2 user=tester',
      '{"token":"abc123","api_key":"sk-live-42"}',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'secret: s3cr3t; cookie=sessionid',
    ].join(' | ');

    const clean = redactLogText(line);

    expect(clean).not.toContain('hunter2');
    expect(clean).not.toContain('abc123');
    expect(clean).not.toContain('sk-live-42');
    expect(clean).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(clean).not.toContain('s3cr3t');
    expect(clean).not.toContain('sessionid');
    expect(clean).toContain('[redacted]');
  });

  test('removes usernames written as key/value pairs or by the player log', () => {
    const clean = redactLogText(
      ['username=alice peer: bob', 'source 1 : carol — Music\\Daft Punk\\Discovery\\01 - One More Time.mp3'].join(
        ' | ',
      ),
    );

    expect(clean).not.toContain('alice');
    expect(clean).not.toContain('bob');
    expect(clean).not.toContain('carol');
    expect(clean).toContain('source 1 : [redacted]');
  });

  test('removes absolute and Soulseek paths', () => {
    const clean = redactLogText(
      [
        'cache /home/thibaut/.cache/soulstream/abc.mp3',
        'android /storage/emulated/0/Android/data/com.soulstream.app/files/x.mp3',
        'windows C:\\Users\\Thibaut\\Music\\track.mp3',
        'shared Music\\Daft Punk\\Discovery\\01 - One More Time.mp3',
      ].join(' | '),
    );

    expect(clean).not.toContain('thibaut');
    expect(clean).not.toContain('Thibaut');
    expect(clean).not.toContain('Daft Punk');
    expect(clean).not.toContain('One More Time');
    expect(clean).toContain('<path>');
  });

  test('keeps useful diagnostics and is idempotent', () => {
    const line = 'état playing après 320 ms, tampon 2 Mo, HTTP 503, 3 source(s)';
    expect(redactLogText(line)).toBe(line);
    expect(redactLogText(redactLogText('password=x /home/a/b.mp3'))).toBe(
      redactLogText('password=x /home/a/b.mp3'),
    );
  });
});

describe('log report validation', () => {
  const valid = {
    schema: 1,
    installationId: 'inst_0123456789abcdef',
    app: { version: '1.3.0', platform: 'android' },
    events: [{ at: 1_700_000_000_000, level: 'error', tag: 'play', message: 'source failed' }],
  };

  test('accepts and redacts a valid report', () => {
    const result = parseLogReport({
      ...valid,
      events: [{ ...valid.events[0], message: 'password=hunter2 /home/me/a.mp3' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.events[0].message).not.toContain('hunter2');
      expect(result.report.events[0].message).not.toContain('/home/me');
    }
  });

  test('rejects a bad installation id or a mismatching one', () => {
    expect(isInstallationId('inst_0123456789abcdef')).toBe(true);
    expect(isInstallationId('short')).toBe(false);
    expect(isInstallationId('has spaces in it 123')).toBe(false);
    expect(parseLogReport({ ...valid, installationId: 'x' }).ok).toBe(false);
    expect(parseLogReport(valid, 'inst_0123456789abcdef').ok).toBe(true);
    expect(parseLogReport(valid, 'inst_other').ok).toBe(false);
  });

  test('bounds the number and size of events', () => {
    const tooMany = Array.from({ length: MAX_LOG_EVENTS + 1 }, () => valid.events[0]);
    expect(parseLogReport({ ...valid, events: tooMany }).ok).toBe(false);
    expect(
      parseLogReport({
        ...valid,
        events: [{ ...valid.events[0], message: 'a'.repeat(MAX_LOG_MESSAGE + 1) }],
      }).ok,
    ).toBe(false);
    expect(parseLogReport({ ...valid, events: [] }).ok).toBe(false);
    expect(parseLogReport({ ...valid, events: [{ ...valid.events[0], level: 'verbose' }] }).ok).toBe(false);
    expect(parseLogReport({ ...valid, events: [{ ...valid.events[0], at: -1 }] }).ok).toBe(false);
    expect(parseLogReport({ ...valid, app: { version: '1', platform: 'web' } }).ok).toBe(false);
  });
});
