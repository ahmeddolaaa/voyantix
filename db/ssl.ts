/**
 * TLS policy for the Postgres pool.
 *
 * Managed Postgres reached over a public endpoint requires TLS; the local
 * dev database (and a provider's private network, e.g. Railway's internal
 * host) does not. We enable TLS when the connection string asks for it
 * (`sslmode=require` / `ssl=true`) or when `DATABASE_SSL=true` is set, and
 * leave it off otherwise so local development stays plaintext and unchanged.
 *
 * `rejectUnauthorized: false` is used because several managed providers
 * present certificates that don't chain to a CA bundled in the runtime
 * image. The connection is still encrypted; certificate pinning can be
 * added later without changing callers.
 */
export function poolSsl(
  connectionString: string
): { rejectUnauthorized: boolean } | undefined {
  if (process.env.DATABASE_SSL === "false") return undefined;
  if (process.env.DATABASE_SSL === "true") return { rejectUnauthorized: false };
  if (/[?&](sslmode=require|ssl=true)/.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
