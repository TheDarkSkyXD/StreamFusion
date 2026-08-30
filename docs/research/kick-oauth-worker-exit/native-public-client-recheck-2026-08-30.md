# Kick native OAuth recheck

Research date: 2026-08-30

## Result

Kick has not added a documented native or public OAuth client that can exchange or refresh tokens without a `client_secret`.

The current authorization flow requires S256 PKCE. The code exchange then requires both `code_verifier` and `client_secret`, and refresh requires `client_secret` again. Kick documents no device authorization grant, public-client application type, or `token_endpoint_auth_method=none` option.

StreamFusion should keep its current Cloudflare token service. A backend-free Electron flow remains unsupported until Kick publishes a public-client contract and exposes the matching application type in its developer settings.

## Current official contract

The check used the official [KickEngineering/KickDevDocs repository at commit `61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1`](https://github.com/KickEngineering/KickDevDocs/tree/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1), the current `main` revision on the research date.

- The [authorization endpoint](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L32-L79) requires a PKCE code challenge using S256.
- The [authorization-code exchange](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L92-L153) marks `client_secret` and `code_verifier` as required.
- The [refresh request](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/generating-tokens-oauth2-flow.md#L238-L307) marks `client_secret` as required.
- The [app setup guide](https://github.com/KickEngineering/KickDevDocs/blob/61d7e8336fe2bc4bbb7479fa56bf77d5ae4a2fe1/getting-started/kick-apps-setup.md#L14-L21) describes a Client ID, Client Secret, and redirect URL. It does not describe a public or native application type.

The repository has no OAuth OpenAPI file. Its OAuth server contract lives in the Markdown guide above. A full repository search found no device-code endpoint, Device Authorization Grant, native-client registration, or public-client token contract.

This is a documentation-contract finding. We did not probe the production token endpoint by omitting the secret. Undocumented acceptance would not be a safe production dependency.

## Upstream request status

An equivalent concern already existed as closed [issue #23](https://github.com/KickEngineering/KickDevDocs/issues/23), which Kick's repository converted to open, unanswered [Discussion #36](https://github.com/KickEngineering/KickDevDocs/discussions/36). It asks how a mobile app can authenticate without exposing the client secret. The discussion has no accepted answer and does not establish a Kick-supported public-client flow.

StreamFusion has now filed the concrete feature request in the same official repository:

- [KickEngineering/KickDevDocs issue #412: Support native/public OAuth clients with PKCE without `client_secret`](https://github.com/KickEngineering/KickDevDocs/issues/412)

Issue #412 requests secretless code exchange and refresh for explicitly registered public clients while preserving secret authentication for confidential clients. It also links the impact to StreamFusion's Electron application and the cost of operating a hosted token relay.

Do not file a duplicate. Monitor #412, but keep the Worker until Kick both documents and ships the public-client registration and token behavior. An issue response or status change alone is not enough to remove the trusted secret boundary.

## Audit scope

The audit covered the full current KickDevDocs tree, all 34 GitHub Discussions by title and body, targeted discussion comments, and open and closed issues matching PKCE, client-secret, native-client, public-client, and device-flow terms. Discussion #36 was the prior equivalent request. Issue #412 is now the direct implementation request.

The earlier, broader StreamFusion analysis remains in [native-public-client-support.md](./native-public-client-support.md).
