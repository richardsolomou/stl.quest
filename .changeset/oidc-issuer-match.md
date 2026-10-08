---
'stl.quest': patch
---

Reject OpenID Connect issuers whose discovery document names a different issuer, so that sign-in only trusts tokens from the configured identity provider; an existing provider with a mismatched issuer stops offering sign-in until its issuer is set to the `issuer` its discovery document publishes.
