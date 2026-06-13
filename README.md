# ArrView

A self-hosted dashboard to monitor and manage your media downloading stack.

| Service | Purpose |
|---------|---------|
| **SABnzbd** | Usenet download queue — live progress, pause/resume |
| **NZBHydra** | Usenet search aggregator — connection status |
| **Sonarr** | TV show library — view all shows, trigger missing-episode searches |
| **Radarr** | Movie library — view collection, download missing films |

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later (includes npm)

---

## Setup

```bash
# 1. Install dependencies
cd arrview
npm install

# 2. Start in development mode (hot-reload)
npm run dev
#  → React frontend:  http://localhost:5173
#  → API backend:     http://localhost:7777

# 3. OR build for production and run as a single server
npm run build
npm start
#  → Dashboard served at http://localhost:7777
```

On first launch you'll be taken to the **Configuration page**. Enter the server URL and API key for each service you want to monitor, test each connection, then click **Save & Open Dashboard**.

Settings are saved to `config.json` (gitignored). You can re-open settings any time via the ⚙️ button in the top bar.

---

## Finding your API keys

| Service | Location |
|---------|----------|
| **SABnzbd** | Config → General → Security → API Key |
| **NZBHydra** | Config → Main → API key |
| **Sonarr** | Settings → General → Security → API Key |
| **Radarr** | Settings → General → Security → API Key |

---

## Features

### Downloads (SABnzbd)
- Live download queue with per-item progress bars, speed, and ETA
- Pause / Resume / Delete individual items
- Pause All / Resume All queue controls
- Auto-refreshes every 10 seconds with a visible countdown
- Recent download history

### TV Shows (Sonarr)
- Full series list with per-show episode completion bar
- **Missing episodes badge** per show
- One-click **Search Missing** to trigger a Sonarr series-wide search
- Expandable show detail: all seasons → all episodes with download status
- Per-season and per-episode search buttons for granular control
- Filter by: All / Has Missing / Continuing / Ended
- Sort by: A–Z / Most Missing / Newest First

### Movies (Radarr)
- Full movie library with download status badges
- **Download All Missing** bulk action
- Per-movie **Download** button for available-but-missing films
- Filter by: All / Downloaded / Missing / Monitored
- Sort by: A–Z / Newest First / Recently Added

---

## Project structure

```
arrview/
├── server.js            # Express API proxy + config storage
├── config.json          # Generated on first save (gitignored)
├── src/
│   ├── App.jsx          # Root component, config gate
│   ├── index.css        # Global dark theme
│   └── components/
│       ├── ConfigPage   # Service connection setup
│       ├── Dashboard    # Top bar, tabs, service status
│       ├── DownloadsTab # SABnzbd queue & history
│       ├── ShowsTab     # Sonarr series + episodes
│       └── MoviesTab    # Radarr movie library
└── vite.config.js       # Dev proxy to backend on :7777
```

---

## Changing the port

Set the `PORT` environment variable before starting:

```bash
PORT=8888 npm start
```

---

## Docker

This project can run as a standalone container.

### Pull from GitHub Container Registry

After pushing to GitHub, the workflow in `.github/workflows/publish-ghcr.yml` publishes the image to GHCR automatically.

```bash
docker pull ghcr.io/tvstuffs/arrview:latest
```

### Run the published image

```bash
docker run -d --name arrview \
  --network host \
  -e PORT=7777 \
  -v "$PWD/arrview-data:/data" \
  ghcr.io/tvstuffs/arrview:latest
```

The container serves the dashboard on `http://localhost:7777` and stores saved settings in `/data/config.json`.

> **iOS auto-discovery requires host networking.** The container advertises
> itself over Bonjour/mDNS so the ArrView iOS app can find it on the network
> without typing an address. mDNS is **multicast**, which Docker's bridge
> network does **not** forward — publishing ports (`-p 7777:7777`) only forwards
> the unicast HTTP traffic, so the advertisement never leaves the container and
> discovery silently fails. Run with `--network host` (or `network_mode: host`
> in Compose) so the advertisement reaches the LAN. Notes:
> - Host networking is **Linux-only**; it does not broadcast to the LAN under
>   Docker Desktop for Mac/Windows (Docker runs in a VM there).
> - Ensure the host firewall allows UDP **5353** (mDNS).
> - If you can't use host networking, the app still works — just choose
>   **Connect Directly** in setup and enter `http://<host>:7777` manually.

### Build locally

```bash
# Build the image
docker build -t arrview .

# Run it with a persistent config volume in the background
# (--network host enables iOS auto-discovery; see the note above)
mkdir -p ./data
docker run -d --name arrview \
  --network host \
  -e PORT=7777 \
  -v "$PWD/data:/data" \
  arrview
```

The container serves the dashboard on `http://localhost:7777` and stores saved service settings in `/data/config.json`, which survives container restarts when the `./data` volume is mounted.
