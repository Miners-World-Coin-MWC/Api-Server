# Security

## Non-custodial boundary

Private keys, WIFs, seeds and mnemonics belong only in the wallet runtime.

They must never be:

- sent to the API
- written to D1
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

## Admin endpoints

All `/api/admin/*` endpoints require the Worker secret `ADMIN_API_KEY`.

Use a long random value and rotate it periodically.

## Database

D1 contains public/accounting metadata only.

No private wallet material belongs in the database.
