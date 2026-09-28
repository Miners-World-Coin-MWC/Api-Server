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

`POST /broadcast` is proxied to the original API unchanged. There is no API key. If you expose
the server publicly, put rate limiting in front of it (reverse proxy / host firewall).

## No admin surface, no database

There is no admin key, no admin-only endpoint, and no database anywhere in this project.
Every `/api/*` route is public and stateless: it derives whatever it needs to answer
(a CLTV lock address, a balance, a sync status) on the fly from `(pubkey, unlock_time)` or an
address, and checks the real chain state via the original API before answering. There is
nothing for an attacker to poison and nothing that requires a secret to operate, because
nothing is ever written down server-side — including whether, or when, a user chooses to
lock their coins. That decision, and everything needed to act on it, stays entirely in the
browser wallet with the user's own key.
