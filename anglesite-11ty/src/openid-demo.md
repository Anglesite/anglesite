---
title: 'OpenID Connect Discovery Demo'
layout: layout.html
description: 'Demonstration of OpenID Connect Discovery Configuration generation in Anglesite 11ty'
---

# OpenID Connect Discovery Demo

This page demonstrates the OpenID Connect Discovery Configuration feature in Anglesite 11ty, which automatically generates the standard `.well-known/openid_configuration` endpoint for OAuth2 and OpenID Connect servers.

## What is OpenID Connect Discovery?

OpenID Connect Discovery is a standard mechanism that allows OAuth2 and OpenID Connect clients to automatically discover the configuration of an authorization server. This eliminates the need to hardcode server endpoints and capabilities in client applications.

## Generated Endpoint

✅ **Live Endpoint**: [/.well-known/openid_configuration](/.well-known/openid_configuration)

This endpoint provides a JSON document containing all the necessary information for OAuth2/OIDC clients to interact with your authorization server.

## Key Features

### 🔒 Security Compliance

- **RFC 8414**: OAuth 2.0 Authorization Server Metadata
- **OpenID Connect Discovery 1.0**: Standard discovery protocol
- **URL Validation**: All endpoints are validated for security
- **HTTPS Only**: Only secure URLs are accepted

### 🚀 Automatic Generation

- **Build-time Processing**: Generated during site build
- **Configuration-driven**: Controlled via `website.json`
- **Validation**: Comprehensive validation and error handling
- **Caching**: Build-time caching for performance

### 📋 Complete Metadata Support

- **Core Endpoints**: Authorization, token, userinfo, JWKS
- **Advanced Features**: Device flow, PKCE, logout endpoints
- **Capabilities**: Supported scopes, response types, signing algorithms
- **Localization**: UI locale support for international deployments

## Configuration Example

Add this to your `src/_data/website.json`:

```json
{
  "openid_configuration": {
    "enabled": true,
    "issuer": "https://example.com",

    // Core OAuth2/OIDC Endpoints
    "authorization_endpoint": "https://example.com/oauth2/authorize",
    "token_endpoint": "https://example.com/oauth2/token",
    "userinfo_endpoint": "https://example.com/oauth2/userinfo",
    "jwks_uri": "https://example.com/.well-known/jwks.json",

    // Registration and Management
    "registration_endpoint": "https://example.com/oauth2/register",
    "revocation_endpoint": "https://example.com/oauth2/revoke",
    "introspection_endpoint": "https://example.com/oauth2/introspect",

    // Advanced Flow Support
    "device_authorization_endpoint": "https://example.com/oauth2/device",
    "end_session_endpoint": "https://example.com/oauth2/logout",

    // Supported Capabilities
    "scopes_supported": ["openid", "profile", "email", "phone", "address"],
    "response_types_supported": ["code", "id_token", "code id_token"],
    "grant_types_supported": ["authorization_code", "implicit", "refresh_token"],
    "subject_types_supported": ["public", "pairwise"],

    // Security Features
    "id_token_signing_alg_values_supported": ["RS256", "RS384", "ES256"],
    "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
    "code_challenge_methods_supported": ["S256", "plain"],

    // Claims and Localization
    "claims_supported": ["sub", "name", "email", "picture", "locale"],
    "ui_locales_supported": ["en-US", "es-ES", "fr-FR", "de-DE"],

    // Session Management
    "backchannel_logout_supported": true,
    "frontchannel_logout_supported": true,

    // Documentation
    "service_documentation": "https://example.com/docs/oauth2",
    "op_policy_uri": "https://example.com/privacy",
    "op_tos_uri": "https://example.com/terms"
  }
}
```

## Use Cases

### 🏢 Enterprise Applications

- **Single Sign-On (SSO)**: Corporate identity management
- **API Authentication**: Secure service-to-service communication
- **Multi-tenant Systems**: Support for multiple organizations

### 🌐 Web Applications

- **Social Login**: "Login with Your Company" buttons
- **Third-party Integrations**: Allow apps to access your APIs
- **Federated Identity**: Connect with external identity providers

### 📱 Mobile Applications

- **Native Apps**: iOS and Android OAuth2 flows
- **Progressive Web Apps**: Secure authentication in PWAs
- **API Access**: Mobile app backend authentication

### 🔧 Development Tools

- **API Documentation**: Auto-discovery for API clients
- **Testing Frameworks**: Automated OAuth2 testing
- **Developer Portals**: Self-service client registration

## Generated Metadata

The plugin generates a comprehensive metadata document including:

| Category          | Examples                                                 |
| ----------------- | -------------------------------------------------------- |
| **Endpoints**     | `/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo` |
| **Capabilities**  | Supported scopes, response types, grant types            |
| **Security**      | Signing algorithms, PKCE support, authentication methods |
| **Features**      | Session management, device flow, client registration     |
| **Documentation** | Service docs, privacy policy, terms of service           |

## Client Discovery Flow

1. **Client Discovery**: App fetches `/.well-known/openid_configuration`
2. **Endpoint Discovery**: Extracts authorization and token endpoints
3. **Capability Check**: Validates supported features and algorithms
4. **Dynamic Configuration**: Configures OAuth2 client automatically
5. **Secure Communication**: Uses discovered endpoints for authentication

## Standards Compliance

✅ **RFC 8414**: OAuth 2.0 Authorization Server Metadata  
✅ **OpenID Connect Discovery 1.0**: Core discovery specification  
✅ **RFC 6749**: OAuth 2.0 Authorization Framework  
✅ **RFC 7636**: PKCE for OAuth Public Clients  
✅ **RFC 7662**: OAuth 2.0 Token Introspection

## Security Considerations

- **URL Validation**: All endpoints validated for HTTPS
- **Issuer Matching**: Issuer URL must match server domain
- **Capability Advertising**: Only advertise supported features
- **Documentation Links**: Privacy and terms must be accessible

---

**Current Configuration**: The live demo above reflects the actual OpenID Connect Discovery configuration for this Anglesite 11ty instance, providing a real-world example of the generated metadata document.
