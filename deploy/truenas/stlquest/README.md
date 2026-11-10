# STL Quest

[STL Quest](https://github.com/richardsolomou/stl.quest) is a private 3D-print request and production queue for resin and filament printers.

OIDC sign-in creates accounts by default when self-signup is open. Manage account creation in the OIDC setup dialog. To override that setting and block new OIDC accounts, add `AUTH_OIDC_ALLOW_SIGNUP` with value `false` under **Additional Environment Variables** and restart the app. Existing linked accounts can still sign in.
