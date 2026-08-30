# Kick native public-client support

Research date: 2026-08-30

## Verdict

Kick does not document a native public OAuth client that can exchange an authorization code or refresh a token without a `client_secret`. Its published user-token contract requires both PKCE and the app's client secret for the authorization-code exchange, then requires the client secret again for refresh. A backend-free Electron token flow is therefore not a supported migration target today.

This is a contract verdict, not a claim that Kick's token endpoint has been experimentally proven to reject every request with an omitted secret. Kick does not publish that behavior, and this research did not use production credentials to probe it. Even if an omission happened to work, relying on undocumented behavior would leave StreamFusion without a stable provider contract.

The practical boundary is straightforward. StreamFusion may keep the existing popup experience, but a trusted service must continue to hold the Kick client secret and perform token exchange and refresh unless Kick adds an explicit public-client registration and token contract.

## Evidence matrix

| Question | Kick's documented contract | Standards baseline | Finding |
| --- | --- | --- | --- |
| Can an installed desktop app register as a public client? | App setup creates a Client ID, Client Secret, and one developer-specified redirect URL. No native/public client type or secretless registration is described. | An installed native app is a public client because it cannot keep distributed credentials confidential. | Not documented by Kick. |
| Can it exchange a code without `client_secret`? | `client_id`, `client_secret`, `redirect_uri`, `code`, and `code_verifier` are all marked required. | Public clients use Authorization Code with PKCE and cannot authenticate with a shared secret. | No supported secretless exchange. Actual omission response is not documented or tested here. |
| Is PKCE supported? | `code_challenge` and S256 are required at authorization; `code_verifier` is required at exchange. | Public clients must use PKCE. Confidential clients should also use it. | Yes, but Kick treats PKCE as additive to the client secret, not a replacement for it. |
| Can it refresh without `client_secret`? | `refresh_token`, `client_id`, `client_secret`, and `grant_type=refresh_token` are required. | A public client cannot prove its identity with a distributed shared secret. Public-client refresh tokens need replay detection through sender constraint or rotation. | No supported secretless refresh. |
| Are refresh tokens rotated? | Refresh responses contain a refresh token. Kick's changelog says refresh tokens became "reusable/flexible" on 2025-11-25. It does not define invalidation, reuse limits, lifetime, or token-family behavior. | Rotation means each refresh invalidates the previous token and preserves family linkage for replay detection. | Strict rotation is not documented and the changelog points away from single-use rotation. Persist the newest returned token, but do not claim old-token invalidation. |
| Are loopback callbacks supported? | Kick recommends `http://localhost/...`, permits `127.0.0.1` through a documented workaround, and says the redirect must exactly match the app setting. | Native desktop clients should use loopback IP literals, bind an ephemeral port, and authorization servers must accept any requested port for a registered loopback redirect. `localhost` is not recommended. | Fixed registered loopback callbacks are documented. Dynamic port handling and port-insensitive matching are not. |
| Is an Electron `BrowserWindow` allowed? | Kick's public docs do not discuss embedded user-agents, Electron, webviews, or an external-browser requirement. | Native apps must use an external user-agent. A user-agent whose host app can read cookies or inspect and modify page content is embedded. Authorization servers may block it. | No Kick-specific restriction found, but StreamFusion's popup is an embedded user-agent under RFC 8252 and does not follow that BCP. |

## Kick's published behavior

### App registration has no public-client path

Kick's [app setup guide](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/kick-apps-setup.md#L14-L21) says creating an app produces a Client ID, Client Secret, and a redirect URL. It describes one Authorization Code with PKCE flow. The guide does not expose a native-app application type, a `token_endpoint_auth_method=none` option, per-install credentials, or another public-client authentication method.

That omission matters because PKCE and client authentication solve different problems. PKCE binds the authorization code to the client instance that began the request. It does not make a shared client secret safe to distribute.

### Code exchange requires PKCE and the secret

Kick's [OAuth guide](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L32-L111) requires an S256 code challenge at authorization. At the token endpoint it marks `client_secret` and `code_verifier` as required alongside the code, client ID, redirect URI, and grant type. The [example exchange](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L135-L153) sends both.

The official documentation therefore defines a confidential-client-style token boundary even though PKCE is present. It does not document an alternative request for installed apps.

### Refresh also requires the secret

The [refresh endpoint contract](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L238-L307) marks `client_id` and `client_secret` as required and returns both an access token and a refresh token.

Kick does not document refresh-token lifetime, inactivity expiry, reuse limits, replay detection, token-family invalidation, or whether a newly returned refresh token supersedes an earlier one. The only first-party statement about reuse is the [2025-11-25 changelog entry](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/README.md#L52-L60), "Made refresh tokens reusable/flexible." That is evidence against describing Kick's current behavior as strict refresh-token rotation. The client should still save the newest returned refresh token because it is the only forward-compatible choice.

### Loopback redirect support is narrower than the native-app profile

Kick's guide [recommends a localhost callback](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L403-L420). It also documents a workaround for `127.0.0.1` because its authorization frontend otherwise rewrites the first IP occurrence to `localhost`. The same section says the redirect URI must exactly match the callback configured in app settings.

Kick does not say that the port may vary from the registered URI, that a port may be omitted during registration, or that multiple loopback ports can be registered. This leaves StreamFusion's fallback range of ports 8765 through 8864 outside the documented provider contract unless every resulting URI is accepted by the actual app registration.

By comparison, [RFC 8252 section 7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3) requires authorization servers supporting native loopback redirects to allow any port at request time. [Section 8.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.3) recommends loopback IP literals instead of `localhost`. Kick documents the reverse preference because of its current frontend bug. That is a provider constraint, not proof of RFC 8252 native-client support.

## Standards comparison

[RFC 6749 section 2.1](https://www.rfc-editor.org/rfc/rfc6749.html#section-2.1) defines installed native applications as public clients when they cannot keep client credentials confidential. [RFC 8252 section 8.5](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.5) adds that a secret distributed in every copy of an app must not be treated as confidential and is not useful proof of client identity. Embedding Kick's shared secret in Electron, preload, main-process code, packaging, local encrypted storage, or an updater would not turn StreamFusion into a confidential client.

[RFC 9700 section 2.1.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1) requires PKCE for public clients. Kick already requires PKCE, but its additional secret requirement means an installed client still cannot complete the documented flow on its own.

For refresh, [RFC 9700 section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2) requires an authorization server issuing refresh tokens to public clients to detect replay through sender-constrained tokens or rotation that invalidates the previous token. Kick documents neither mechanism for a public client. Its reusable-token changelog entry cannot establish conformance with that public-client requirement.

## The popup constraint

Kick publishes no rule that expressly bans an Electron `BrowserWindow`. That is an omission, not permission.

RFC 8252 draws the boundary by capability. An [external user-agent](https://www.rfc-editor.org/rfc/rfc8252.html#section-3) is separate from the app, so the app cannot read its cookies or inspect and modify its pages. An embedded user-agent shares that security domain. [Section 8.12](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.12) says native apps must not use embedded user-agents and allows authorization servers to detect and block them.

StreamFusion's current popup creates a `BrowserWindow`, reads Kick cookies, and executes JavaScript against the sign-in page. The relevant code is in [`auth-window.ts`](https://github.com/TheDarkSkyXD/StreamFusion/blob/ba37d75d1283b5794fa9d8a138e98eee17a99733/apps/desktop/src/backend/auth/auth-window.ts#L148-L213) and its authentication probes later in the same file. It therefore meets RFC 8252's embedded-user-agent definition even though it appears in a separate desktop window.

Preserving that popup is technically independent from replacing Cloudflare. A different trusted backend can receive the code and refresh tokens while the popup stays unchanged. It does, however, preserve a known standards deviation and the risk that Kick may later enforce an external-browser policy.

## Implications for the Wayfinder map

1. Eliminate the backend-free native public-client design from the supported architecture choices. Do not place or obfuscate `KICK_CLIENT_SECRET` anywhere in the desktop distribution.
2. Define a small confidential token service as the replacement boundary. It needs only Kick code exchange and refresh, plus the redirect validation, input limits, rate limits, and error normalization already owned by the Worker. Kick product API traffic remains direct from the desktop.
3. Keep PKCE, state validation, encrypted local token storage, and single-flight refresh. PKCE remains required even though the trusted service authenticates the client registration.
4. Treat refresh-token reuse and expiry as provider-defined unknowns. Save every newly returned refresh token and keep concurrent refresh suppressed, but do not design around guaranteed one-time rotation.
5. Keep the current popup only as an explicit product constraint with a recorded RFC 8252 exception. Kick has not documented a ban, but the popup is not an external user-agent.
6. Validate the exact registered redirect URI before migration. Kick documents exact matching and does not promise dynamic loopback ports.

## What remains unknown

The following facts are not in Kick's published contract:

- whether `/oauth/token` currently rejects an omitted `client_secret` with `invalid_client` or another error;
- whether Kick can privately enable a public/native app registration;
- whether developer settings accept several loopback redirects or port-insensitive loopback registration;
- refresh-token lifetime, reuse limits, replay detection, and token-family revocation;
- whether Kick plans to block embedded user-agents.

A controlled non-production prototype could observe the first and third items with a dedicated Kick app registration. It cannot make an undocumented secretless flow suitable for production. Only a published Kick contract or direct first-party confirmation should reopen the backend-free architecture.

## Sources and audit scope

- KickEngineering/KickDevDocs at commit [`61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1`](https://github.com/KickEngineering/KickDevDocs/tree/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1), including the app setup guide, OAuth guide, and changelog. The repository contains no separate OAuth OpenAPI definition for the authorization or token endpoints at that commit.
- [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749.html), OAuth 2.0 client types.
- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html), OAuth 2.0 for Native Apps, Best Current Practice 212.
- [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), Best Current Practice for OAuth 2.0 Security.
- StreamFusion source at commit [`ba37d75d1283b5794fa9d8a138e98eee17a99733`](https://github.com/TheDarkSkyXD/StreamFusion/tree/ba37d75d1283b5794fa9d8a138e98eee17a99733), used only to classify the current token boundary and popup behavior.

No community answer, third-party tutorial, or observed behavior from another application was used as evidence.
