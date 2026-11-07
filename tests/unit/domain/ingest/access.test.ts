import { describe, expect, it } from 'vitest';
import type { Arrival, ProjectConfig } from '../../../../src/domain/ingest/arrival.js';
import { checkAccess } from '../../../../src/domain/ingest/access.js';

const config: ProjectConfig = {
  clientKeys: [
    { publicKey: 'live', active: true },
    { publicKey: 'off', active: false },
  ],
  allowedOrigins: ['*'],
  sizeLimits: { event: 100, attachment: 100, arrival: 100 },
  inboundFilters: { browserExtensions: false, localhost: false, webCrawlers: false, releases: [], messages: [], addresses: [] },
};

const arrival = (overrides: Partial<Arrival> = {}): Arrival => ({
  projectId: '1',
  endpoint: 'envelope',
  headers: {},
  query: { sentry_key: 'live' },
  pathKey: null,
  origin: null,
  body: new Uint8Array(1),
  ...overrides,
});

describe('checkAccess', () => {
  it('admits an active Client Key of the Project', () => {
    expect(checkAccess({ arrival: arrival(), config })).toEqual({ credentials: { publicKey: 'live', client: null }, config });
  });

  it('refuses a disabled key, a key the Project does not have, and an unknown Project alike', () => {
    expect(checkAccess({ arrival: arrival({ query: { sentry_key: 'off' } }), config })).toEqual({ refusal: 'disabled-key' });
    expect(checkAccess({ arrival: arrival({ query: { sentry_key: 'other' } }), config })).toEqual({ refusal: 'disabled-key' });
    expect(checkAccess({ arrival: arrival(), config: null })).toEqual({ refusal: 'disabled-key' });
  });

  it('passes on the reason credentials could not be located', () => {
    expect(checkAccess({ arrival: arrival({ query: {} }), config })).toEqual({ refusal: 'missing-credentials' });
  });

  it('admits any origin when the Project allows *, and a server SDK that sends no origin', () => {
    expect(checkAccess({ arrival: arrival({ origin: 'https://anything.example' }), config })).toEqual({
      credentials: { publicKey: 'live', client: null },
      config,
    });
    const restricted = { ...config, allowedOrigins: ['https://app.example'] };
    expect(checkAccess({ arrival: arrival({ origin: null }), config: restricted })).toEqual({
      credentials: { publicKey: 'live', client: null },
      config: restricted,
    });
  });

  it('admits a browser origin only when it matches an allowed origin, which may be a glob', () => {
    const restricted = { ...config, allowedOrigins: ['https://app.example', 'https://*.staging.example'] };
    for (const origin of ['https://app.example', 'HTTPS://APP.EXAMPLE', 'https://pr-7.staging.example']) {
      expect(checkAccess({ arrival: arrival({ origin }), config: restricted })).toEqual({
        credentials: { publicKey: 'live', client: null },
        config: restricted,
      });
    }
    for (const origin of ['https://evil.example', 'http://app.example', 'https://app.example.evil']) {
      expect(checkAccess({ arrival: arrival({ origin }), config: restricted })).toEqual({ refusal: 'origin-not-allowed' });
    }
    expect(checkAccess({ arrival: arrival({ origin: 'https://app.example' }), config: { ...config, allowedOrigins: [] } })).toEqual({
      refusal: 'origin-not-allowed',
    });
  });
});
