# App logos

STL Quest shows the official icon of each external app it opens or connects to (every slicer in `src/core/slicers.ts`, plus Spoolman and Bambuddy), so people can tell which app a button hands a file to. `APP_LOGOS` in `src/core/appLogos.ts` maps each app to its file under `public/app-logos/`, and the application serves them from its own origin.

`sources.json` records, for each app, the page the logo came from, the exact file URL, the date it was checked, and the license or trademark terms it is used under, with a `note` on how the committed file was made from the source. Each logo is the app's coloured icon, taken from the project's own repository at a pinned commit or from the vendor's own website or installer, never redrawn or taken from an icon pack. SVGs are committed unchanged. A raster icon is trimmed to its edges, resized to 128 pixels, and compressed with pngquant.

To add an app, add its ID and path to `APP_LOGOS`, commit its file, and add its source to `sources.json`. `pnpm catalog:check` verifies without the network that every app has exactly one source with HTTPS URLs, a checked date, and a license note, that its file is committed, and that no other file sits in `public/app-logos/`.
