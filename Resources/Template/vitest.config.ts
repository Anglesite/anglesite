import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const AP_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD18uMeTkt8hY4N
4Axh7wtOR6ETfoEQDSjrzyb0bVjqxHm35IgCDie7o0lUAAnDC3GVCuffcWbnUoVS
d9xhuBs7GjAD//FkVtg4lj482ubsl5UGM0iPr5Wf5KYKBUx0U9Z4lTrZAl4BfvUn
CHOgzQ8O723iK6APvbRHu2AQd9OY9RErvofYkxXDC2XTpvTWBHM0u6zmcfqMPZn7
481Sun9rPEJEDRd0qhRmNMo98fgLvK96RO38VahW5nDYa5vJ9tm2MHFIr+hSjSrB
3kXfYYyf71wQgjx/h47mnUWqLuREyv+3vBlNmTiH7liJsZ/cDgjM9DfjjXb5LiG3
JOSFmEs5AgMBAAECggEAIGs0GbYLSC4Yg+aw6yXFsTtK1ZV6sKFzb+W9xkE1k7hz
LNSgQtkXzqlezIY2wzFaduFZn//EJyCe9zhaYb0RRdCVXKmbaXTzCj5vlLjr8Gqo
l4kh+uKTj+BlLHP3WGwGnJ1bBOjFeGACM3NvPlZZMkhIDSRf9EM2pK/joTgSOZpt
0tYpPYQT+118la9yNZBBYIDpPRyHe7ocxRABnc6ijCipbeFQG2Z7IjREv+p5EtQo
IZdKc5YvzlUr7QqBjpxX/QENJB5PMGEarRhULqpNtmCVRTtNKJK99Dh/KuLQeTfl
q5jVBl6uij71ygo7AKUw5ZaCuVxpNX5tgrAWcgHIKQKBgQD8MoNlPiJm6RDi2y9p
soDc/M+O8UfyIkQ2KdumuZLosSCpNzijH2JGN7JPR6kWWsEPcxEit2xq2P5tqX0X
zzAjXGK3IdCq5YbpkRZiWnEWrl8LMmRkN6FQQbtakjCaTHJzJ6SUU3WHUad2WSYO
nrRhoPm/X8PPtujCUJ1vx5x0pQKBgQD5qEEiSXBbapyssPUUXL1kJI/yGPhJwESP
Aggwns60HbBzYhEw94sH55yEDfEDysIihHxS6ULu2vmXz2u8ACw1XrT+HTo1p+3/
N7cXqW9YezVgkJM3dOcackDAv8Vovq4yZjP640y5aH417DTxkjftaap6LZsUijhc
5JexIo60BQKBgAOxubsB7f8T6utnyooB02FpUqEFZ8hkOBuTAWSv0zcVYSUZafr5
urbMmhAPPKrXKXzQcq/PgAcQpql0kiCHKG1cLRYBqMzYD+Hb/jfymzV52GqRkmbl
abeDPvtUqOGZvRNywTZrAo245HsXUzdjm8DSWtYy0Ot6Am7WP3gjtGcBAoGAMYHQ
CMCPa1Fk6EnfD76kP+uQL+4LrnRWJBW/EgUr8EPC7d6QkilEhLjFLNqm5J2cicPD
850WDM+Xlycmsg1Gtv6k3Y9mL6WxaF7gC+0pi15DY3bH+sNP4MqvVImy1+aYHJ5v
yFyypkG2ZXMFvLHGLWo6yCerDROrwaADBLlZmxECgYEA9FTK7mggOaH7jaGsK2PG
smeTYugX3NbKM6+2aaO4bIFBcQHyrQIamW4vOQidveLqQYiv6A4owZOg1UG9jSYZ
tq3/5vfcjAV/VIKNXzYbwIlObiRinRZllCr6SIDaJHNl/zsoN0JqBM+b7KrwPR29
y6slCXSVdtvk6tLd27zrYfk=
-----END PRIVATE KEY-----
`;

const AP_TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9fLjHk5LfIWODeAMYe8L
TkehE36BEA0o688m9G1Y6sR5t+SIAg4nu6NJVAAJwwtxlQrn33Fm51KFUnfcYbgb
OxowA//xZFbYOJY+PNrm7JeVBjNIj6+Vn+SmCgVMdFPWeJU62QJeAX71JwhzoM0P
Du9t4iugD720R7tgEHfTmPURK76H2JMVwwtl06b01gRzNLus5nH6jD2Z++PNUrp/
azxCRA0XdKoUZjTKPfH4C7yvekTt/FWoVuZw2GubyfbZtjBxSK/oUo0qwd5F32GM
n+9cEII8f4eO5p1Fqi7kRMr/t7wZTZk4h+5YibGf3A4IzPQ34412+S4htyTkhZhL
OQIDAQAB
-----END PUBLIC KEY-----
`;

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/worker.ts",
      miniflare: {
        compatibilityDate: "2026-07-15",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["AUTH_DB", "WEBMENTION_INBOX", "MICROPUB_DB", "WEBSUB_DB", "MICROSUB_DB"],
        kvNamespaces: ["INBOX_KV", "SOCIAL_KV"],
        r2Buckets: ["MEDIA"],
        queueProducers: {
          WEBMENTION_QUEUE: "site-webmention",
          WEBSUB_QUEUE: "site-websub",
          MICROSUB_QUEUE: "site-microsub",
        },
        // site-websub/site-microsub are deliberately NOT registered as consumers here: a
        // delivered job would make the library's consumer attempt a real network fetch (a
        // verification GET for websub, a feed fetch for microsub) that fails in the test
        // sandbox and schedules a queue retry, which the pool tears down as an "uncaught
        // exception" after the suite passes. The consumer dispatch itself is covered by calling
        // worker.queue directly with a stubbed batch.
        queueConsumers: ["site-webmention"],
        // @dwk/activitypub's ActivityPubObject uses `state.storage.sql` (SQLite-backed storage),
        // so the test binding needs the object form with `useSQLite: true` — the brief's plain
        // `{ ACTOR: "ActivityPubObject" }` string shorthand defaults to the classic KV-backed
        // storage API and throws "SQL is not enabled for this Durable Object class" the moment
        // the class is instantiated. This mirrors `new_sqlite_classes` (not `new_classes`) in the
        // generated wrangler.toml migration (see `WorkerComposition.generateWranglerToml`, Swift).
        durableObjects: { ACTOR: { className: "ActivityPubObject", useSQLite: true } },
        bindings: {
          TOKEN_SIGNING_KEY: "test-token-signing-key-with-at-least-32-bytes",
          INDIEAUTH_OWNER_PASSWORD: "correct horse battery staple",
          SITE_URL: "https://test.example",
          AP_PRIVATE_KEY: AP_TEST_PRIVATE_KEY,
          AP_PUBLIC_KEY: AP_TEST_PUBLIC_KEY,
          AP_PUBLISH_TOKEN: "test-activitypub-publish-token",
        },
      },
    }),
  ],
  test: {
    include: ["worker/**/*.test.ts"],
  },
});
