# nettools

- Upstream: https://github.com/Lissy93/networking-toolbox
- Version: tag `v1.6.0` (commit `8ea4470becca9d197705a6e59a425d9c0370aceb`). Built from source with `npm ci` and `DEPLOY_ENV=static` (upstream's adapter-static mode).
- License: MIT
- Served at `/nettools/` (`BASE_URL=/nettools`, `paths.relative=false`, `trailingSlash='always'`, so every page is prerendered as `dir/index.html`), `spa=&`.
- Size of `desk/web`: 44.6 MB, 796 files, 141 prerendered pages

## Static build: what needs a server (hidden or disabled)
These tools use SvelteKit API routes (`src/routes/api/**`), which a static build doesn't have:
- The whole **Lookups** section (`/diagnostics/**`), about 45 tools:
  - DNS lookup, reverse lookup, propagation, SPF, DMARC, CAA, NS/SOA, glue, AXFR, DNSSEC chain and AD flag, blacklist (DNSBL), query performance and trace
  - RDAP domain, IP and ASN
  - HTTP headers, security, cookies, CORS, compression, redirect trace, perf and HTTP ping
  - TLS certificate, versions, ALPN, OCSP stapling, handshake, cipher presets, banner and CT log search
  - Email MX health, mail TLS, greylisting, SPF and DMARC
  - Network TCP port check, IPv6 connectivity, ASN/geo and BGP route lookup

  They are removed from the top nav, the homepage and search (`TOP_NAV`/`SUB_NAV` filtered when static) and aren't prerendered.
- **MAC address vendor (OUI) lookup**: the server proxies api.maclookup.app. In static mode the vendor shows as unknown, and the rest of the MAC tool (formats and conversions) works.
- The `/api/*` REST API and its swagger page (`api-docs.html`, which loaded swagger-ui from a CDN) are removed. The About page "API" section now points to the hosted instance.

Everything else is client-side and works offline: subnetting (IPv4/IPv6, VLSM, supernet, planner), CIDR, IP converters, DNS generators and validators, DHCP option builders, references and bookmarks.

## Other patches (`patches/urbit.patch`)
- Analytics off (`ANALYTICS_DOMAIN/DSN = 'false'`; upstream defaults to `no-track.as93.net`).
- No Google Fonts: the theme fonts that aren't self-hosted fall back to their CSS stacks, the preconnects are removed, and `fonts.css` and font URLs are base-relative.
- About page: the Attributions section (GitHub API, as93.net sponsor APIs and iframes) is replaced by a static link. The author photo and the other-app icons (external images) are removed.
- IP regex generator: removed the language icons from `cdn.simpleicons.org`.
- `custom-styles.css` and the manifest link are base-relative, with `crossorigin="use-credentials"`. The manifest's icon and shortcut paths are relative, and the diagnostics shortcut is dropped.
- Service worker: upstream registered a root-scoped `/sw.js` that cached root paths. It now waits on `navigator.serviceWorker.ready`, and `kit/pwa.py` installs the kit's `/nettools/`-scoped worker.
- Removed `.well-known/` (extensionless and dot-prefixed paths), robots.txt and sitemap.xml.

## Tested
- `test.js` loads `/nettools/` and checks the "Lookups" section is gone. It opens the deep link `/nettools/subnetting/ipv4-subnet-calculator` (no trailing slash), enters `10.20.0.0/22` and checks broadcast `10.20.3.255`, mask `255.255.252.0` and `1,022` usable hosts. No page errors and no external requests.
- A crawl of all 141 prerendered pages found no external requests, no failed requests, no 4xx responses and no page errors.
- `kit/pwa-check.js nettools` prints `errors=[]`.

## Known issues
- `/cidr/mask-converter`, `/cidr/set-operations` and `/offline` are unlinked upstream and so aren't prerendered. A hand-typed deep link to them falls back to the root page.
- External links (GitHub, the author's site, "use the public instance") open the internet when clicked.
