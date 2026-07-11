# Cloudflare Tunnel on a NAS

The reference PrintHub deployment: the app runs next to the print files on a NAS, a Cloudflare Tunnel provides ingress without opening router ports, and identity comes from either the built-in login or Cloudflare Access. Cloudflare is one supported recipe here, not an application dependency; PrintHub itself never talks to Cloudflare.

## Prerequisites

- A Cloudflare account with a zone, and a remotely managed tunnel created under **Zero Trust → Networks → Tunnels**. Copy its token.
- Two host directories: one for `/data` (metadata) and one for `/prints` (the STL files).

In the tunnel's **Public Hostname** settings, point your hostname at `http://printhub:3000`. The `cloudflared` container reaches the app over the Compose network, so PrintHub needs no published ports.

## Run it

```sh
cp .env.example .env
# set DATA_HOST_DIR, PRINTS_HOST_DIR, and CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d
```

### Option A: built-in login (default)

Leave `AUTH_PROVIDER=local`. Set `SETUP_TOKEN` to a random value of at least 24 characters for the first start, open your tunnel hostname, and create the first operator. Remove `SETUP_TOKEN` afterwards.

### Option B: Cloudflare Access identity

Let Cloudflare Access authenticate users and have PrintHub trust the identity header instead of managing passwords:

1. Add an Access application for your hostname under **Zero Trust → Access → Applications** with a policy for your users.
2. Create a request-header Transform Rule on the zone that sets `X-PrintHub-Proxy-Secret` to a random value of at least 24 characters. This proves requests came through Cloudflare; PrintHub fails closed without it.
3. In `.env`, set `AUTH_PROVIDER=trusted-header`, `TRUSTED_PROXY_SECRET` to the same value, and `OPERATOR_EMAILS` to the operators' emails. `SETUP_TOKEN` is not needed.

Access populates `Cf-Access-Authenticated-User-Email` on authenticated requests, which matches the default `AUTH_EMAIL_HEADER`.

## TrueNAS Custom App

The same deployment without Compose, using **Apps → Discover Apps → Custom App**:

- Image: `ghcr.io/richardsolomou/printhub:latest`, pull policy **Always**, restart **Unless Stopped**.
- Host path for `/data` (for example `/mnt/HDDs/STL/.printhub-data`) and host path for `/prints` (for example `/mnt/HDDs/STL`).
- Environment variables as in the options above.
- Port: container `3000`, host `3010`, and run `cloudflared` separately (another Custom App or a plain container) pointing at `http://<nas-ip>:3010`.

TrueNAS can monitor the `latest` tag for updates. The unauthenticated `/api/health` endpoint suits its health checks: it returns success only after migrations and recovery finish and both mounts accept writes.

## Upload sizes

Cloudflare's proxy caps request bodies at 100 MB. PrintHub's chunked uploads stay under this, and the cap doubles as the ingress request-body limit that the main README requires in front of the multipart parser.
