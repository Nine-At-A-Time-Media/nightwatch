import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatDsn, parseDsn } from '../../../../src/domain/protocol/dsn.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

describe('parseDsn', () => {
  it('reads key, host, path and project from a DSN with a path prefix', () => {
    // Given a DSN with a port and a path prefix, When parsed, Then each part is named.
    const dsn = parseDsn('https://abc123@ingest.example.com:8443/base/42');
    expect(dsn).toEqual({ scheme: 'https', publicKey: 'abc123', host: 'ingest.example.com:8443', path: '/base', projectId: '42' });
  });

  it('ignores the legacy secret after the key', () => {
    const dsn = parseDsn('http://abc:secret@localhost/7');
    expect(dsn).toEqual({ scheme: 'http', publicKey: 'abc', host: 'localhost', path: '', projectId: '7' });
  });

  it('refuses a DSN without a key or without a numeric project', () => {
    expect(isRefusal(parseDsn('https://ingest.example.com/42'))).toBe(true);
    expect(isRefusal(parseDsn('https://abc@ingest.example.com/project'))).toBe(true);
    expect(isRefusal(parseDsn('not a url'))).toBe(true);
  });

  it('round-trips every well-formed DSN', () => {
    const part = fc.stringMatching(/^[a-z0-9]{1,12}$/);
    fc.assert(
      fc.property(fc.constantFrom('http', 'https'), part, part, fc.array(part, { maxLength: 3 }), fc.nat(), (scheme, key, host, segs, project) => {
        const path = segs.length ? '/' + segs.join('/') : '';
        const dsn = { scheme, publicKey: key, host, path, projectId: String(project) };
        expect(parseDsn(formatDsn(dsn))).toEqual(dsn);
      }),
    );
  });
});
