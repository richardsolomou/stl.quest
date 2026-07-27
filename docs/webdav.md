# Connect a remote folder over WebDAV

This guide makes a WebDAV folder on your computer or NAS available to a hosted STL Quest workspace. You do not need to open a port on your router. Cloudflare Tunnel or Tailscale Funnel creates an outgoing connection and gives the folder a public HTTPS address. A dedicated WebDAV username and password protect the files.

## Before you start

You need:

- A domain using Cloudflare DNS.
- A computer or NAS that stays online when STL Quest needs its files.
- A WebDAV server with a dedicated folder, username, and strong password for STL Quest. Many NAS products have a WebDAV app; follow the NAS vendor's instructions to enable it and restrict the account to that folder.
- The WebDAV address on your local network, such as `http://127.0.0.1:8080/dav` when WebDAV and `cloudflared` run on the same machine, or `https://192.168.1.20:5006/dav` when they run on different devices.

Test the local address and credentials before creating the tunnel. On a machine that can reach the WebDAV server, replace the example values and run:

```sh
curl --user 'stlquest:your-password' --request PROPFIND --header 'Depth: 0' --include http://127.0.0.1:8080/dav/
```

A working WebDAV server normally returns `207 Multi-Status`. A `401` response means the username or password is wrong. A `404` or `405` response usually means the URL does not point to WebDAV.

### TrueNAS SCALE

1. Create a dedicated dataset for STL Quest files. Do not reuse an application, system, or general NAS-administration dataset.
2. Install a WebDAV app or custom app and mount the dataset read/write as its WebDAV root. Create a dedicated WebDAV account that can access only this dataset.
3. When Cloudflare displays its connector installation command below, choose **Docker**, install `cloudflared` as a separate app, and configure it with the tunnel token from that command. Treat the token as a secret.
4. If both apps share a private container network, use the WebDAV app's container hostname and port as the tunnel service URL. Otherwise, use the TrueNAS private IP and the WebDAV app's published port, such as `http://192.168.1.20:8080/dav`.
5. Open the TrueNAS **Shell** or use another machine on the same network and run the local `PROPFIND` check above before configuring the public hostname.

Dataset permissions must allow the user ID used by the WebDAV app to read, create, rename, and delete files. Keep the TrueNAS web interface on its existing private address; publish only the WebDAV app through the tunnel.

### Unraid

1. Create a dedicated share for STL Quest files and keep its SMB export private or disabled unless you also need local file access.
2. Install a WebDAV container from Community Apps. Map the dedicated share read/write to the container's data directory and configure a unique WebDAV username and password.
3. When Cloudflare displays its connector installation command below, choose **Docker**, install a Cloudflare Tunnel (`cloudflared`) container from Community Apps, and configure it with the tunnel token from that command. Treat the token as a secret.
4. Put both containers on the same custom Docker network. Use the WebDAV container name and its internal port as the tunnel service URL, such as `http://webdav:8080/dav`. Alternatively, use the Unraid private IP and the WebDAV container's published port.
5. Open the Unraid terminal or use another machine on the same network and run the local `PROPFIND` check above.

Do not publish the Unraid web interface through this tunnel. Back up the share with the STL Quest database because the database contains references to these files, not the files themselves.

## Choose a secure tunnel

Cloudflare Tunnel is widely available and works without opening a router port. Cloudflare limits the size of each request, but STL Quest keeps large-file requests below that limit when the WebDAV server supports partial updates.

Tailscale Funnel also works without opening a router port and does not impose Cloudflare's request-size limit. It is the better option when the WebDAV server does not support partial updates or models exceed the Cloudflare plan's limit.

## Connect with Cloudflare Tunnel

1. Open the [Cloudflare dashboard's Tunnels page](https://dash.cloudflare.com/?to=/:account/tunnels) under **Networking → Tunnels**, then select **Create a tunnel**.
2. Name the tunnel (for example, `stlquest-storage`) and select **Create Tunnel**.
3. Choose the operating system of the computer or NAS that will run the connector. Copy and run the installation command Cloudflare displays. For TrueNAS or Unraid, choose **Docker** and configure the `cloudflared` app or container with the token from the displayed command. The token is a secret, so do not share it or save the command in a public file.
4. Wait for the connector to connect, then select **Continue**. If WebDAV runs on a NAS that cannot run `cloudflared`, install the connector on another always-on computer on the same private network.
5. Return to **Networking → Tunnels**, select the tunnel, open the **Routes** tab, then select **Add route → Published application**.
6. Enter a dedicated subdomain such as `storage`, select the domain, and add the WebDAV path only if the public URL needs one.
7. In **Service URL**, enter the local WebDAV protocol and address. Use `HTTP` with a loopback address when WebDAV and `cloudflared` run on the same machine. If the connector reaches a different device over the network, prefer `HTTPS` with a certificate the connector trusts.
8. Select **Save**. Cloudflare creates the DNS record and TLS certificate automatically; it may take a minute before the public address responds. The tunnel should show **Healthy** on **Networking → Tunnels**.

If Cloudflare's screens differ from this guide, follow its [current tunnel setup instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) for your operating system.

### Test the Cloudflare address

Run the same check against the public hostname:

```sh
curl --user 'stlquest:your-password' --request PROPFIND --header 'Depth: 0' --include https://storage.example.com/dav/
```

Continue only after you receive `207 Multi-Status`. A Cloudflare `502` response means the connector cannot reach WebDAV. Check the protocol (`http` or `https`), hostname, port, and path in the service URL.

## Connect with Tailscale Funnel

Install Tailscale on the machine running WebDAV and sign in to your tailnet. Enable MagicDNS and HTTPS in the Tailscale admin console, then expose the WebDAV service by passing its local port to Funnel. For a WebDAV server listening on port 8080, run:

```sh
tailscale funnel --bg 8080
```

The first run opens a browser approval flow. Tailscale then prints a public `https://<machine>.<tailnet>.ts.net` address and provisions its certificate. Funnel can listen publicly on ports 443, 8443, and 10000, while proxying to the WebDAV service's local port.

Add the WebDAV path to the public address when the local service uses one. For example, if the local endpoint is `http://127.0.0.1:8080/dav`, test `https://<machine>.<tailnet>.ts.net/dav/`:

```sh
curl --user 'stlquest:your-password' --request PROPFIND --header 'Depth: 0' --include https://machine.tailnet-name.ts.net/dav/
```

Continue only after you receive `207 Multi-Status`. Use `tailscale funnel status` to inspect the route and `tailscale funnel reset` to remove it. Follow Tailscale's [current Funnel instructions](https://tailscale.com/kb/1223/funnel) if its CLI or approval flow differs.

## Connect STL Quest

In **Settings → Storage**, choose **Remote folder (WebDAV)** and enter:

- **WebDAV endpoint:** the public URL, including the WebDAV path, such as `https://storage.example.com/dav`.
- **Folder:** a new folder below that endpoint, such as `stlquest`. STL Quest creates its workspace folders underneath it.
- **Username and password:** the dedicated WebDAV credentials you tested above.

Save the settings. STL Quest tests the connection before it starts using the folder.

## Keep it safe and reliable

- Expose only WebDAV on this hostname. Do not route your NAS dashboard, router, SSH server, or other administration interface through it.
- Do not put a Cloudflare Access browser login in front of the hostname. STL Quest is a background service and cannot complete an interactive login; it authenticates directly with WebDAV instead.
- Restrict the WebDAV account to its dedicated folder and use a unique password. Anyone with the public URL and credentials can access that folder.
- Keep the connector, WebDAV server, and storage device running. STL Quest cannot upload, download, generate previews, or delete files while any of them is offline.
- Cloudflare limits the size of a single proxied request. The documented limit is 100 MB on Free and Pro plans, 200 MB on Business, and 500+ MB on Enterprise. STL Quest keeps requests below that limit when the WebDAV server advertises a supported partial-update extension. If it does not, use Tailscale Funnel, another direct HTTPS endpoint, or another storage provider for files above your plan's limit. Check Cloudflare's [current upload limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#customization-options-and-limits).

To revoke access, delete the public hostname in Cloudflare or reset Tailscale Funnel, then rotate the dedicated WebDAV password.
