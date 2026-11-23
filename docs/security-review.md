# Pre-demo security review

Scope: development prototype, fictional records, source inspection and automated CI. This is not an independent penetration test or production certification.

| Area | Controls and remaining risk |
|---|---|
| Access | All financial routes require a server-side staff session. Named accounts with administrator and staff roles; disabling an account revokes its sessions. Sign-in throttling is per username (10 failures in 15 minutes) with a global ceiling of 50, so one person's mistakes do not lock out everyone. Institutional identity and MFA need approval. |
| Credentials | Salted scrypt hashes; rotation and operator recovery revoke sessions. Existing scrypt work factor merits benchmarking before production. Account-wide throttle can deny service to legitimate staff; consider infrastructure-level rate limiting. |
| Sessions | Random opaque tokens, hashed storage, fixed expiration, HttpOnly/SameSite, Secure in production. Already-authorized in-flight requests may finish after logout. |
| Request protection | Same-origin API, no permissive CORS, required mutation header. Deployment must not introduce permissive CORS. |
| Validation | Parameterized SQL; integer-cent financial rules; bounded imports and formula rejection. Validation responses no longer echo request inputs. |
| Files | ZIP expansion and upload bounds, protected reports, formula-safe exported strings. Malformed-file fuzzing and independent review remain outstanding. |
| Dependencies | Frontend dependency resolution is pinned by the npm lockfile. CI audits Python and JavaScript dependencies. Python transitive versions and container image digests still need a reproducibility decision. |
| Deployment | Localhost Caddy smoke test passed (test certificate, bypassed trust verification). Real TLS, host configuration, secret provisioning and network rules require approval. Exclude secrets and financial artifacts from Docker build context. |
| Recovery | Encrypted backup/restore and monitoring tests passed. Actual key custody, retention, offsite storage and alert routing require authorization. |
| Finance | Database constraints, transaction locks, duplicate review, audit history and reconciliation. Audit log is not tamper-evident against privileged database operators. |

Release gates: all CI jobs green, known vulnerabilities remediated or expressly assessed, stakeholder financial acceptance, production configuration review, independent security assessment and approved data handling. Do not use real records before authorization.

See the [repository review](repository-review.md) for file-level inspection notes and outstanding work.
