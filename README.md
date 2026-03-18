# neteye-frontend

The Angular 21 web interface for neteye. Displays a live force-directed topology
map of all monitored devices, with real-time metrics, routing table inspection,
and interactive traffic path analysis.

## Features

- **Live topology map** — D3 force-directed graph, updates in real time via
  WebSocket. Each node represents a device; edges represent shared subnets.
  Colour-coded by network. Dashed edges indicate point-to-point (/30+) links.
- **Interface bars** — each device node shows coloured stripes for every subnet
  it belongs to, giving an instant multi-homing overview.
- **Devices tab** — full interface list with IP addresses and live up/down state.
- **Networks tab** — all discovered subnets with member counts; click to
  highlight a subnet on the map.
- **Routing tab** — select source and destination device, trace the BFS path
  across the shared-subnet graph, see every hop with IPs and the subnet traversed,
  highlighted on the map.
- **Detail panel** — click any device to open a sliding panel with:
  - Live RX/TX throughput chart (D3, rAF render loop)
  - Packets/s and errors/s views
  - Full kernel routing table

## Requirements

- Node 22+
- Angular CLI 21 (`npm install -g @angular/cli`)
- A running neteye-center (default: `http://localhost:8080`)

## Development

```bash
npm install
ng serve
```

The Angular CLI development server starts on `http://localhost:4200`.
`proxy.conf.json` is wired into `angular.json`, so `ng serve` automatically
proxies:

| Path | Forwarded to |
|------|-------------|
| `/api/*` | `http://localhost:8080/api/*` |
| `/ws`    | `ws://localhost:8080/ws` (WebSocket upgrade) |

This means neteye-center must be running on port 8080 during development.
No CORS configuration is needed.

## Production build

```bash
ng build --configuration=production
```

Output goes to `dist/neteye-frontend/browser/`. The included `nginx.conf`
proxies `/ws` and `/api/` to the center and handles SPA routing.

### Docker

```bash
docker build -t neteye-frontend .
docker run -p 80:80 neteye-frontend
```

The nginx container expects `neteye-center` to be resolvable on port 8080
(as set up by `docker-compose.yml`).

## Environment files

| File | Used by |
|------|---------|
| `src/environments/environment.ts` | `ng serve` (dev) |
| `src/environments/environment.prod.ts` | `ng build --configuration=production` |

Both use `window.location.host` for the WebSocket URL, so the same build works
behind any hostname/port — no rebuild needed to change the server address.

## Project structure

```
src/app/
├── core/
│   ├── models/topology.models.ts       # Wire protocol types + graph helpers
│   └── services/topology.service.ts   # WebSocket client, Angular Signals state
├── features/
│   ├── topology-map/                   # D3 force graph component
│   ├── sidebar/                        # 3-tab sidebar (devices / networks / routing)
│   └── metrics-chart/                  # Live D3 line chart + routes table
├── app.ts                              # Root component (shell layout)
├── app.html                            # Shell template
└── app.config.ts                       # Angular providers (HttpClient, Router)
```

## Key design decisions

- **Angular Signals** for all reactive state — no RxJS Subjects needed. The
  topology service exposes `devices`, `connected`, and derived `graphNodes` /
  `graphLinks` as signals; components read them directly.
- **D3 outside Angular change detection** — the force simulation and SVG
  mutations run entirely in D3 event callbacks and `requestAnimationFrame`,
  bypassing Angular's zone. This is intentional for performance with hundreds of
  nodes.
- **In-browser BFS** for route previewing (instant feedback) backed by the
  authoritative `/api/route` endpoint on the server, which has the full routing
  table from the kernel.
