[**@dwk Monorepo API Documentation v0.1.0**](../../README.md)

---

[@dwk Monorepo API Documentation](../../README.md) / [certificates](../README.md) / loadCertificates

# Function: loadCertificates()

> **loadCertificates**(`domains`): `Promise`\<\{ `cert`: `string`; `key`: `string`; \}\>

Defined in: [certificates.ts:197](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/certificates.ts#L197)

Load or generate SSL certificates for HTTPS server with specific domains.
Main entry point for getting certificates for the HTTPS proxy server.

## Parameters

### domains

`string`[] = `...`

Array of domain names, defaults to ["anglesite.test"].

## Returns

`Promise`\<\{ `cert`: `string`; `key`: `string`; \}\>

Promise resolving to certificate and private key for HTTPS server.
