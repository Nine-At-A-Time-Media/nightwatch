// The local stage's sign-in helper, over the real local issuer routes
// standing in for the issuer's service binding.
import { describe, expect, it } from 'vitest';
import { LocalIssuer } from '../../../dev/local-issuer/local-issuer.js';
import { issuerAnswer } from '../../../dev/local-issuer/routes.js';
import { handleDevSignIn, type IssuerFetcher } from '../../server/handlers/dev.js';

const AUDIENCE = 'nightwatch-console-local';

class IssuerBinding implements IssuerFetcher {
  readonly asked: string[] = [];
  constructor(private readonly issuer: LocalIssuer) {}

  async fetch(input: string): Promise<Response> {
    this.asked.push(input);
    return issuerAnswer(new Request(input), { issuer: this.issuer, now: new Date() });
  }
}

async function binding(): Promise<IssuerBinding> {
  return new IssuerBinding(await LocalIssuer.create('http://local-issuer.localhost'));
}

describe('GET /dev/sign-in', () => {
  it('sets the minted Assertion as the CF_Authorization cookie and returns to the page asked', async () => {
    const issuer = await binding();
    const answer = await handleDevSignIn(new Request('http://localhost/dev/sign-in?email=ada@example.com&return=/follow-up/abc'), {
      issuer,
      audience: AUDIENCE,
    });
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe('/follow-up/abc');
    expect(answer.headers.get('set-cookie')).toMatch(/^CF_Authorization=[\w-]+\.[\w-]+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax$/);
    expect(new URL(issuer.asked[0] ?? '').searchParams.get('aud')).toBe(AUDIENCE);
  });

  it('never redirects off the console', async () => {
    const answer = await handleDevSignIn(new Request('http://localhost/dev/sign-in?email=a@b.c&return=//evil.example'), {
      issuer: await binding(),
      audience: AUDIENCE,
    });
    expect(answer.headers.get('location')).toBe('/my-reports');
  });

  it('answers 404 on a stage with no issuer, and 400 with no email', async () => {
    expect(
      (await handleDevSignIn(new Request('http://localhost/dev/sign-in?email=a@b.c'), { issuer: null, audience: AUDIENCE })).status,
    ).toBe(404);
    expect(
      (await handleDevSignIn(new Request('http://localhost/dev/sign-in'), { issuer: await binding(), audience: AUDIENCE })).status,
    ).toBe(400);
  });
});
