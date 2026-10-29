/* global jest */
// Jest replaces the global console after `setupFiles`, so muting must happen
// here. The release journal logs to console.log by design; a transfer that
// finishes after a test would otherwise make Jest exit with code 1.
jest.spyOn(console, 'log').mockImplementation(() => {});
