/**
 * Minimal readiness probe surface for the `/ready` health route.
 *
 * Implementations should perform a cheap canary read against the
 * underlying datastore (e.g. a `LIMIT 1` query against a small,
 * always-populated table). The probe is binary: a thrown error means
 * "not ready" — there is no expected payload.
 */
export interface IHealthRepository {
  pingReadiness(): Promise<void>;
}
