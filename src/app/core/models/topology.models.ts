// Wire protocol types — mirror the Go models in neteye-center.

export interface AddressInfo {
  address: string; // CIDR, e.g. "192.168.1.10/24"
  family: 'ipv4' | 'ipv6';
}

export interface InterfaceMetrics {
  bytes_recv: number;
  bytes_sent: number;
  packets_recv: number;
  packets_sent: number;
  errors_in: number;
  errors_out: number;
  drops_in: number;
  drops_out: number;
}

export interface InterfaceInfo {
  name: string;
  mac: string;
  state: 'up' | 'down';
  mtu: number;
  speed_mbps: number;
  addresses: AddressInfo[];
  metrics: InterfaceMetrics;
}

export interface Route {
  destination: string;
  gateway: string;
  interface_name: string;
  metric: number;
  flags: string;
}

export interface DeviceInfo {
  id: string;
  hostname: string;
  os: string;
  arch: string;
  status: 'online' | 'offline';
  last_seen: string;
  first_seen: string;
  interfaces: InterfaceInfo[];
  routes: Route[];
}

export interface TopologySnapshot {
  devices: DeviceInfo[];
  timestamp: string;
}

export interface MetricsUpdate {
  device_id: string;
  interface_name: string;
  timestamp: string;
  bytes_recv_rate: number;
  bytes_sent_rate: number;
  packets_recv_rate: number;
  packets_sent_rate: number;
  errors_in_rate: number;
  errors_out_rate: number;
  drops_in_rate: number;
  drops_out_rate: number;
}

export interface DeviceOfflineMsg {
  device_id: string;
  hostname: string;
  last_seen: string;
}

// Discriminated union for all messages from the center.
export type FrontendMessage =
  | { type: 'topology'; topology: TopologySnapshot }
  | { type: 'device_update'; device_update: DeviceInfo }
  | { type: 'device_offline'; device_offline: DeviceOfflineMsg }
  | { type: 'metrics'; metrics: MetricsUpdate };

// ── Graph types (D3 augmented) ────────────────────────────────────────────────

/** A D3 simulation node backed by a DeviceInfo. */
export interface GraphNode extends DeviceInfo {
  // D3 simulation fields (mutable)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/** An edge between two devices that share at least one subnet. */
export interface GraphLink {
  source: GraphNode | string;
  target: GraphNode | string;
  /** Primary CIDR (used for coloring) */
  cidr: string;
  /** All shared CIDRs between this device pair */
  cidrs: string[];
  /** Human-readable label (all CIDRs joined) */
  label: string;
  isVpn: boolean; // rendered as dashed line
}

/** Route analysis result from /api/route */
export interface RouteAnalysis {
  source: string;
  destination: string;
  found: boolean;
  hops: RouteHop[];
  networks: string[];
}

export interface RouteHop {
  device_id: string;
  hostname: string;
  via_cidr: string;
  ingress_ip: string;
  egress_ip: string;
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/** All unique CIDRs across every interface of a device. */
export function deviceCidrs(d: DeviceInfo): string[] {
  const cidrs = new Set<string>();
  for (const iface of d.interfaces) {
    for (const addr of iface.addresses) {
      const net = cidrNetwork(addr.address);
      if (net) cidrs.add(net);
    }
  }
  return [...cidrs];
}

/** Extract network address from "192.168.1.10/24" → "192.168.1.0/24" */
export function cidrNetwork(address: string): string | null {
  const parts = address.split('/');
  if (parts.length !== 2) return null;
  const ip = parts[0].split('.').map(Number);
  const prefix = parseInt(parts[1], 10);
  if (ip.length !== 4 || isNaN(prefix)) return null;
  const mask = ~(0xffffffff >>> prefix);
  const net = ip.map((octet, i) => octet & ((mask >> ((3 - i) * 8)) & 0xff));
  return `${net.join('.')}/${prefix}`;
}

/** Build GraphLinks from a device list — one edge per device pair, listing all shared CIDRs. */
export function buildLinks(devices: DeviceInfo[]): GraphLink[] {
  // cidr → [{device, ip}]
  const netMap = new Map<string, { device: DeviceInfo; ip: string }[]>();

  for (const d of devices) {
    for (const iface of d.interfaces) {
      for (const addr of iface.addresses ?? []) {
        if (addr.family === 'ipv6') continue;
        const net = cidrNetwork(addr.address);
        if (!net) continue;
        const ip = addr.address.split('/')[0];
        if (!netMap.has(net)) netMap.set(net, []);
        netMap.get(net)!.push({ device: d, ip });
      }
    }
  }

  // pairKey → { srcId, dstId, cidrs[] } — one entry per device pair
  const pairMap = new Map<string, { srcId: string; dstId: string; cidrs: string[] }>();

  for (const [cidr, members] of netMap) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i],
          b = members[j];
        if (a.device.id === b.device.id) continue;
        const pairKey = [a.device.id, b.device.id].sort().join('|');
        if (!pairMap.has(pairKey)) {
          pairMap.set(pairKey, { srcId: a.device.id, dstId: b.device.id, cidrs: [] });
        }
        const entry = pairMap.get(pairKey)!;
        if (!entry.cidrs.includes(cidr)) entry.cidrs.push(cidr);
      }
    }
  }

  return [...pairMap.values()].map(({ srcId, dstId, cidrs }) => ({
    source: srcId,
    target: dstId,
    cidr: cidrs[0],
    cidrs,
    label: cidrs.join(' · '),
    isVpn: cidrs.every(isVpnCidr),
  }));
}

function isVpnCidr(cidr: string): boolean {
  // Heuristic: /30 or /31 point-to-point, or 10.x with typical VPN prefixes
  const prefix = parseInt(cidr.split('/')[1], 10);
  return prefix >= 30;
}
