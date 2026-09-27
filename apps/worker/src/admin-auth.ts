import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface AdminAuthConfig {
  ADMIN_ACCESS_TEAM_DOMAIN?: string;
  ADMIN_ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
/** Validate the signature, issuer, expiry, audience, and an explicit operator allowlist. */
export async function authenticateAdmin(
  request: Request,
  config: AdminAuthConfig,
  testKeys?: JWTVerifyGetKey,
): Promise<{ email: string } | null> {
  const domain = config.ADMIN_ACCESS_TEAM_DOMAIN?.trim();
  const audience = config.ADMIN_ACCESS_AUD?.trim();
  const emails = config.ADMIN_EMAILS?.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!domain || !audience || !emails?.length || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain))
    return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const issuer = `https://${domain}`;
  try {
    let keys = testKeys ?? keySets.get(issuer);
    if (!keys) {
      const remote = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keySets.set(issuer, remote);
      keys = remote;
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    if (typeof payload.email !== 'string' || !emails.includes(payload.email.toLowerCase())) return null;
    return { email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}
