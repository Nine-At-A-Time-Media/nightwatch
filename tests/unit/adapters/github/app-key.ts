// A GitHub App key pair for the github adapter's tests: the private key as
// the PKCS#8 PEM the adapter reads from its settings, the public key for
// FakeGitHub to check App JWTs against.

export type AppKey = { readonly privateKeyPem: string; readonly publicKey: CryptoKey };

function pem(der: ArrayBuffer): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
}

export async function appKey(): Promise<AppKey> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return { privateKeyPem: pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), publicKey: pair.publicKey };
}
