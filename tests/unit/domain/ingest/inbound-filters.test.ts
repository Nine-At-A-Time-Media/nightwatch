import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { globMatches, matchingInboundFilter, type InboundFilterConfig } from '../../../../src/domain/ingest/inbound-filters.js';

const off: InboundFilterConfig = {
  browserExtensions: false,
  localhost: false,
  webCrawlers: false,
  releases: [],
  messages: [],
  addresses: [],
};

const GLOB_SPECIALS = /[*?]/g;

describe('globMatches', () => {
  it('matches the whole text, with * as any run and ? as one character', () => {
    expect(globMatches({ pattern: 'app@1.*', text: 'app@1.4.0' })).toBe(true);
    expect(globMatches({ pattern: 'app@1.*', text: 'other app@1.4.0' })).toBe(false);
    expect(globMatches({ pattern: 'v?', text: 'v2' })).toBe(true);
    expect(globMatches({ pattern: 'v?', text: 'v22' })).toBe(false);
    expect(globMatches({ pattern: 'a.b', text: 'axb' })).toBe(false);
  });

  it('ignores case only when asked to', () => {
    expect(globMatches({ pattern: 'TypeError*', text: 'typeerror: x' })).toBe(false);
    expect(globMatches({ pattern: 'TypeError*', text: 'typeerror: x', ignoreCase: true })).toBe(true);
  });

  it('a pattern without wildcards matches exactly itself', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const pattern = a.replace(GLOB_SPECIALS, '');
        expect(globMatches({ pattern, text: pattern })).toBe(true);
        expect(globMatches({ pattern, text: b })).toBe(b === pattern);
      }),
    );
  });

  it('a prefix followed by * matches every extension of that prefix', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, rest) => {
        const prefix = a.replace(GLOB_SPECIALS, '');
        expect(globMatches({ pattern: prefix + '*', text: prefix + rest })).toBe(true);
      }),
    );
  });

  it('replacing any characters of a text with ? still matches it', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.char(), fc.boolean())), (chars) => {
        const text = chars.map(([c]) => c).join('');
        const pattern = chars.map(([c, hide]) => (hide || c === '*' || c === '?' ? '?' : c)).join('');
        expect(globMatches({ pattern, text })).toBe(true);
      }),
    );
  });
});

describe('matchingInboundFilter', () => {
  it('matches nothing when every filter is off', () => {
    const event = { release: 'r1', message: 'boom', request: { url: 'http://localhost/' } };
    expect(matchingInboundFilter({ event, config: off, userAgent: 'Googlebot/2.1' })).toBeNull();
  });

  it('browser-extensions: a frame loaded from an extension', () => {
    const event = {
      exception: { values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ abs_path: 'chrome-extension://abc/content.js' }] } }] },
    };
    expect(matchingInboundFilter({ event, config: { ...off, browserExtensions: true }, userAgent: null })).toBe('browser-extensions');
    const clean = { exception: { values: [{ stacktrace: { frames: [{ abs_path: 'https://app.example/main.js' }] } }] } };
    expect(matchingInboundFilter({ event: clean, config: { ...off, browserExtensions: true }, userAgent: null })).toBeNull();
  });

  it('browser-extensions: a message naming an extension scheme', () => {
    const event = { exception: { values: [{ type: 'Error', value: 'failed in moz-extension://x/a.js' }] } };
    expect(matchingInboundFilter({ event, config: { ...off, browserExtensions: true }, userAgent: null })).toBe('browser-extensions');
  });

  it('localhost: a request to a loopback host or from a loopback address', () => {
    const config = { ...off, localhost: true };
    for (const url of ['http://localhost:3000/a', 'http://127.0.0.1/', 'http://[::1]/', 'http://app.localhost/']) {
      expect(matchingInboundFilter({ event: { request: { url } }, config, userAgent: null })).toBe('localhost');
    }
    expect(matchingInboundFilter({ event: { user: { ip_address: '127.0.0.1' } }, config, userAgent: null })).toBe('localhost');
    expect(matchingInboundFilter({ event: { request: { url: 'https://app.example/' } }, config, userAgent: null })).toBeNull();
    expect(matchingInboundFilter({ event: { request: { url: 'not a url' } }, config, userAgent: null })).toBeNull();
  });

  it('web-crawlers: a crawler user agent on the event or on the arrival', () => {
    const config = { ...off, webCrawlers: true };
    const onEvent = { request: { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } } };
    expect(matchingInboundFilter({ event: onEvent, config, userAgent: null })).toBe('web-crawlers');
    const asPairs = { request: { headers: [['user-agent', 'Mozilla/5.0 (compatible; bingbot/2.0)']] } };
    expect(matchingInboundFilter({ event: asPairs, config, userAgent: null })).toBe('web-crawlers');
    expect(matchingInboundFilter({ event: {}, config, userAgent: 'AhrefsBot/7.0' })).toBe('web-crawlers');
    expect(matchingInboundFilter({ event: {}, config, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0' })).toBeNull();
  });

  it('releases: the release matches a listed glob', () => {
    const config = { ...off, releases: ['web@0.*'] };
    expect(matchingInboundFilter({ event: { release: 'web@0.9.1' }, config, userAgent: null })).toBe('releases');
    expect(matchingInboundFilter({ event: { release: 'web@1.0.0' }, config, userAgent: null })).toBeNull();
    expect(matchingInboundFilter({ event: {}, config, userAgent: null })).toBeNull();
  });

  it('messages: a message or exception matches a listed glob, ignoring case', () => {
    const config = { ...off, messages: ['*resizeobserver loop*'] };
    expect(matchingInboundFilter({ event: { message: 'ResizeObserver loop limit exceeded' }, config, userAgent: null })).toBe('messages');
    expect(matchingInboundFilter({ event: { logentry: { formatted: 'ResizeObserver loop x' } }, config, userAgent: null })).toBe('messages');
    const exception = { exception: { values: [{ type: 'Error', value: 'ResizeObserver loop completed' }] } };
    expect(matchingInboundFilter({ event: exception, config, userAgent: null })).toBe('messages');
    const typed = { ...off, messages: ['TypeError: *'] };
    expect(matchingInboundFilter({ event: { exception: [{ type: 'TypeError', value: 'x is undefined' }] }, config: typed, userAgent: null })).toBe(
      'messages',
    );
    expect(matchingInboundFilter({ event: { message: 'disk full' }, config, userAgent: null })).toBeNull();
  });

  it('addresses: the client address is listed exactly or inside a listed IPv4 range', () => {
    const config = { ...off, addresses: ['203.0.113.7', '198.51.100.0/24', '2001:db8::1'] };
    for (const ip of ['203.0.113.7', '198.51.100.200', '2001:db8::1']) {
      expect(matchingInboundFilter({ event: { user: { ip_address: ip } }, config, userAgent: null })).toBe('addresses');
    }
    for (const ip of ['203.0.113.8', '198.51.101.1', 'not-an-ip']) {
      expect(matchingInboundFilter({ event: { user: { ip_address: ip } }, config, userAgent: null })).toBeNull();
    }
  });

  it('an IPv4 range holds exactly the addresses sharing its prefix bits', () => {
    fc.assert(
      fc.property(fc.ipV4(), fc.ipV4(), fc.integer({ min: 0, max: 32 }), (base, ip, bits) => {
        const toInt = (a: string) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
        const inside = Math.floor(toInt(base) / 2 ** (32 - bits)) === Math.floor(toInt(ip) / 2 ** (32 - bits));
        const config = { ...off, addresses: [`${base}/${bits}`] };
        expect(matchingInboundFilter({ event: { user: { ip_address: ip } }, config, userAgent: null }) === 'addresses').toBe(inside);
      }),
    );
  });

  it('tolerates any JSON value as an event', () => {
    const config: InboundFilterConfig = {
      browserExtensions: true,
      localhost: true,
      webCrawlers: true,
      releases: ['r'],
      messages: ['m'],
      addresses: ['10.0.0.0/8'],
    };
    fc.assert(
      fc.property(fc.jsonValue(), (event) => {
        const result = matchingInboundFilter({ event, config, userAgent: null });
        expect(result === null || typeof result === 'string').toBe(true);
      }),
    );
  });
});
