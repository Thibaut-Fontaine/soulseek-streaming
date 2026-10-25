import { debugLog } from '../src/services/debugLog';
import { installCrashHandler, takeLastCrash } from '../src/services/crashReport';

type Handler = (error: unknown, isFatal?: boolean) => void;

describe('crash report', () => {
  test('a fatal error is saved before the app closes, then read once on the next launch', async () => {
    const closed: unknown[] = [];
    let handler: Handler = error => closed.push(error);
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: Handler) => {
        handler = next;
      },
    };

    installCrashHandler();
    debugLog('play', 'sources pour « Nowhere »');
    handler(new TypeError("Cannot read property 'id' of undefined"), true);

    // The default handler (which closes the app) runs once the report is saved.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(closed).toHaveLength(1);

    const report = await takeLastCrash();
    expect(report?.fatal).toBe(true);
    expect(report?.message).toBe("TypeError: Cannot read property 'id' of undefined");
    expect(report?.log.some(line => line.includes('sources pour « Nowhere »'))).toBe(true);
    expect(await takeLastCrash()).toBeNull();
  });
});
