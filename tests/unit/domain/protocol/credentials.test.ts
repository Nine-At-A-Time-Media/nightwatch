import { describe, expect, it } from 'vitest';
import { locateCredentials } from '../../../../src/domain/protocol/credentials.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const none = { headers: {}, query: {}, pathKey: null };

describe('locateCredentials', () => {
  it('reads the key from the auth header', () => {
    const c = locateCredentials({ ...none, headers: { 'x-sentry-auth': 'Sentry sentry_key=k1, sentry_version=7, sentry_client=js/8' } });
    expect(c).toEqual({ publicKey: 'k1', client: 'js/8' });
  });

  it('reads the key from an Authorization header in the same form', () => {
    expect(locateCredentials({ ...none, headers: { authorization: 'Sentry sentry_key=k2' } })).toEqual({ publicKey: 'k2', client: null });
  });

  it('reads the key from Basic authorization', () => {
    expect(locateCredentials({ ...none, headers: { authorization: 'Basic ' + btoa('k3:ignored') } })).toEqual({
      publicKey: 'k3',
      client: null,
    });
  });

  it('reads the key from the query string, which browsers use to avoid preflight', () => {
    expect(locateCredentials({ ...none, query: { sentry_key: 'k4', sentry_client: 'b' } })).toEqual({ publicKey: 'k4', client: 'b' });
  });

  it('reads the key from a path segment', () => {
    expect(locateCredentials({ ...none, pathKey: 'k5' })).toEqual({ publicKey: 'k5', client: null });
  });

  it('refuses a request that carries credentials in more than one place', () => {
    const c = locateCredentials({ headers: { 'x-sentry-auth': 'Sentry sentry_key=a' }, query: { sentry_key: 'a' }, pathKey: null });
    expect(c).toEqual({ refusal: 'multiple-credentials' });
  });

  it('refuses a request with no credentials, or with an auth header that names no key', () => {
    expect(locateCredentials(none)).toEqual({ refusal: 'missing-credentials' });
    expect(isRefusal(locateCredentials({ ...none, headers: { 'x-sentry-auth': 'Sentry sentry_version=7' } }))).toBe(true);
  });
});
