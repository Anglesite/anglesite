// Stub for the @dwk/indieauth package (real 0.1.0-beta.3 API). site-entry.js
// composes createIndieAuth({ baseUrl, approveAuthorization }) per-env. The stub
// reproduces just enough of the authorization endpoint to exercise our
// approveAuthorization hook: on GET /auth with a client_id it parses the request,
// calls the hook, and either returns the hook's Response verbatim (the consent
// page) or surfaces an AuthorizationApproval as JSON so tests can assert it.
// Every other /auth* path is a tagged passthrough (proves dispatch reached here).

interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  scopes: readonly string[];
  me?: string;
}

function parseAuthRequest(url: URL): AuthorizationRequest {
  const q = url.searchParams;
  const scope = q.get("scope") ?? "";
  return {
    clientId: q.get("client_id") ?? "",
    redirectUri: q.get("redirect_uri") ?? "",
    state: q.get("state") ?? "",
    codeChallenge: q.get("code_challenge") ?? "",
    codeChallengeMethod: q.get("code_challenge_method") ?? "S256",
    scope,
    scopes: scope ? scope.split(/\s+/) : [],
    me: q.get("me") ?? undefined,
  };
}

export function createIndieAuth(config: any) {
  return async (request: Request, _env: unknown, _ctx: unknown) => {
    const url = new URL(request.url);
    if (url.pathname === "/auth" && url.searchParams.get("client_id")) {
      const authReq = parseAuthRequest(url);
      const result = await config.approveAuthorization(authReq, request);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), {
        headers: {
          "x-handler": "indieauth",
          "x-approval": "1",
          "content-type": "application/json",
        },
      });
    }
    return new Response("indieauth", { headers: { "x-handler": "indieauth" } });
  };
}
