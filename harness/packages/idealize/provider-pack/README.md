# @idealize/provider-pack

The login-first auth substrate, host only. It provides `ctx.idealizeOAuth`: a persistent pi-ai credential store under the harness home plus provider-owned OAuth login and logout orchestration. The forked `llm-pi-ai` adapter builds its model collections over the same store, so a credential stored here authenticates ordinary session requests on OAuth routes such as `openai-codex`. Mounted by the `idealize` profile as the `idealize-provider-pack` row.

## The service (`ctx.idealizeOAuth`)

- `store`: a `FileCredentialStore` over `$DSH_HOME/.idealize-oauth.json`, one credential per provider id, mode 0600, whole-file atomic writes (temp file plus rename) so a crash never leaves a torn document holding refresh tokens.
- `oauthProviders()`: every installed pi-ai catalogue provider whose auth offers OAuth, minus `anthropic`, which is withheld because subscription use in third-party agents is barred by its terms.
- `status()`: one row per offered provider with `keyless` (true when sign-in is the route's only auth, so no key can serve it: `openai-codex`; false for a route that also takes a key), `stored`, `pending`, the last `error`, and while a device-code login is pending its `userCode`.
- `login(providerId)`: starts or joins the provider's flow headlessly, answering a select prompt towards the browser route and parking a manual-code prompt until the localhost callback settles it; resolves with the page the browser must open within 15 seconds or rejects. Browser flows (`openai-codex`, `openrouter`) surface that page as an `auth_url` event; device-code flows (Kimi Code, RFC 8628) surface it as a `device_code` event whose verification URL carries the code, and the code is kept on the attempt so the sign-in page can show it in case the provider's page asks for it. Before 7 Sep 2026 the device-code event was ignored and a Kimi Code sign-in ended in "login surfaced no authorize URL".
- `logout(providerId)`: deletes the stored credential and clears the attempt record.

## Routes (loopback only; mutations need `x-idealize-auth: 1`)

Registered when the web server is composed.

- `GET /idealize/signin` renders a minimal branded page listing the OAuth providers; a pending device-code login shows its code under the provider, and the page polls for up to 15 minutes, the device flow's own expiry.
- `GET /idealize/auth/providers` returns `status()`.
- `POST /idealize/auth/login?provider=` starts the flow and returns `{authUrl}`.
- `GET /idealize/auth/status?provider=` reports pending, stored or error.
- `POST /idealize/auth/logout?provider=` deletes the stored credential.

Every route refuses a non-loopback `Host`, which closes DNS rebinding; mutating routes also demand the custom header, which a cross-origin page cannot attach without a CORS preflight the server never grants.

## Model Experience

Indirectly, through the OAuth credentials the forked `llm-pi-ai` adapter reads from this store to authenticate requests; the adapter owns the model-visible request.

#### KV Cache effect

Independent: a credential decides whether a route answers at all, never what the request contains.

## Known Limitations and Deferred Work

- **The sign-in routes stand outside the web app's token fence.** They rely on the loopback check and the custom header alone; integration with the app's own authentication is queued work.
- **Anthropic OAuth is withheld deliberately.** Subscription use in third-party agents is barred by its terms; the route stays key-only until that changes.
- **Login prompts are answered headlessly.** A provider flow that requires a prompt type other than `select` or `manual_code` fails with an error rather than asking the user.
