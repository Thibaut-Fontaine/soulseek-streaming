import { createVersionHandler, VERSION_PATH } from './handler';

const fixture = require('./app-version.json');

describe('GET /api/app/version contract', () => {
  const handler = createVersionHandler(fixture);

  it('serves the validated manifest as JSON', () => {
    const response = handler({ method: 'GET', path: VERSION_PATH });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.body)).toMatchObject({
      versionCode: 19,
      versionName: '1.3.0-beta16',
    });
  });

  it('answers only GET on the exact path', () => {
    expect(handler({ method: 'POST', path: VERSION_PATH }).statusCode).toBe(405);
    expect(handler({ method: 'GET', path: '/api/app/versions' }).statusCode).toBe(404);
  });

  it('refuses to serve an invalid manifest', () => {
    expect(createVersionHandler({ versionCode: 3 })({ method: 'GET', path: VERSION_PATH }).statusCode).toBe(500);
  });
});
