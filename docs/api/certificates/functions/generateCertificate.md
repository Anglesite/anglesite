[**@dwk Monorepo API Documentation v0.1.0**](../../README.md)

---

[@dwk Monorepo API Documentation](../../README.md) / [certificates](../README.md) / generateCertificate

# Function: generateCertificate()

> **generateCertificate**(`domains`): `Promise`\<\{ `cert`: `string`; `key`: `string`; \}\>

Defined in: [certificates.ts:85](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/certificates.ts#L85)

Generate SSL certificate for specific domains using the Anglesite CA.
Includes caching to avoid regenerating certificates for the same domain set.

## Parameters

### domains

`string`[]

Array of domain names to include in the certificate.

## Returns

`Promise`\<\{ `cert`: `string`; `key`: `string`; \}\>

Promise resolving to certificate and private key.
