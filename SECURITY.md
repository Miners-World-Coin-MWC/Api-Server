# Security

## Non-custodial boundary

Private keys, WIFs, seeds and mnemonics belong only in the wallet runtime.

They must never be:

- sent to the API
- written to Worker logs
- included in GitHub issues
- included in analytics
- included in crash reports

## Broadcast endpoint

The broadcast proxy is intentionally compatible with the original API.

For production, add Cloudflare edge rate limiting/WAF rules to protect `/broadcast` against abuse.

An optional Worker secret named `BROADCAST_API_KEY` is supported by the proxy. If it is set, clients must send:

```text
X-MWC-Broadcast-Key: <secret>
```

Do not expose this secret in a public web application if the public wallet needs unrestricted broadcasting. In that case, prefer Cloudflare edge rate limiting and abuse controls.

## No admin surface, no database

There is no admin key, no admin-only endpoint, and no database anywhere in this project.
Every `/api/*` route is public and stateless: it derives whatever it needs to answer
(a CLTV lock address, a balance, a sync status) on the fly from `(pubkey, unlock_time)` or an
address, and checks the real chain state via the original API before answering. There is
nothing for an attacker to poison and nothing that requires a secret to operate, because
nothing is ever written down server-side — including whether, or when, a user chooses to
lock their coins. That decision, and everything needed to act on it, stays entirely in the
browser wallet with the user's own key.
