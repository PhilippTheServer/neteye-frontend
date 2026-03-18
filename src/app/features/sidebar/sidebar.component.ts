import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeviceInfo, RouteAnalysis, RouteHop } from '../../core/models/topology.models';
import { TopologyService } from '../../core/services/topology.service';
import { TopologyMapComponent } from '../topology-map/topology-map.component';

type Tab = 'devices' | 'networks' | 'routing';

interface NetworkEntry {
  cidr: string;
  color: string;
  memberCount: number;
  members: DeviceInfo[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  @Input() mapRef?: TopologyMapComponent;
  @Input() selectedDevice: DeviceInfo | null = null;
  @Output() deviceClick = new EventEmitter<DeviceInfo>();

  activeTab = signal<Tab>('devices');

  // Routing state
  routeSrcId = '';
  routeDstId = '';
  routeResult: RouteAnalysis | null = null;
  routeLoading = false;
  routeError = '';

  readonly devices = computed(() => [...this.topo.devices().values()]);

  readonly networks = computed<NetworkEntry[]>(() => {
    const devices = this.devices();
    const netMap = new Map<string, { members: Set<string>; devs: DeviceInfo[] }>();

    for (const d of devices) {
      for (const iface of d.interfaces) {
        for (const addr of iface.addresses) {
          if (addr.family !== 'ipv4') continue;
          const net = cidrNetwork(addr.address);
          if (!net) continue;
          if (!netMap.has(net)) netMap.set(net, { members: new Set(), devs: [] });
          const entry = netMap.get(net)!;
          if (!entry.members.has(d.id)) {
            entry.members.add(d.id);
            entry.devs.push(d);
          }
        }
      }
    }

    return [...netMap.entries()].map(([cidr, { devs }]) => ({
      cidr,
      color: this.mapRef?.getNetworkColor(cidr) ?? '#888',
      memberCount: devs.length,
      members: devs,
    }));
  });

  constructor(readonly topo: TopologyService) {}

  setTab(t: Tab): void {
    this.activeTab.set(t);
  }

  selectDevice(d: DeviceInfo): void {
    this.deviceClick.emit(d);
    this.mapRef?.highlightDevice(d.id);
  }

  highlightNetwork(cidr: string): void {
    this.mapRef?.highlightNetwork(cidr);
  }

  traceRoute(): void {
    if (!this.routeSrcId || !this.routeDstId) return;
    if (this.routeSrcId === this.routeDstId) {
      this.routeError = 'Source and destination must differ.';
      return;
    }
    this.routeLoading = true;
    this.routeError = '';
    this.routeResult = null;

    this.topo.analyzeRoute(this.routeSrcId, this.routeDstId).subscribe({
      next: (result) => {
        this.routeResult = result;
        this.routeLoading = false;
        if (result.found) {
          this.mapRef?.highlightPath(result.hops);
        }
      },
      error: (err) => {
        this.routeError = err.message ?? 'Route analysis failed.';
        this.routeLoading = false;
      },
    });
  }

  clearRoute(): void {
    this.routeResult = null;
    this.routeError = '';
    this.mapRef?.clearHighlight();
  }

  formatBytes(n: number): string {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB/s';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB/s';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB/s';
    return n.toFixed(0) + ' B/s';
  }

  interfaceAddresses(d: DeviceInfo): string {
    return d.interfaces.flatMap((i) => i.addresses.map((a) => a.address)).join(', ');
  }

  networkColor(cidr: string): string {
    return this.mapRef?.getNetworkColor(cidr) ?? '#888';
  }

  trackById(_: number, d: DeviceInfo): string {
    return d.id;
  }
  trackByCidr(_: number, n: NetworkEntry): string {
    return n.cidr;
  }
  trackByHop(_: number, h: RouteHop): string {
    return h.device_id;
  }
}

function cidrNetwork(address: string): string | null {
  const parts = address.split('/');
  if (parts.length !== 2) return null;
  const ip = parts[0].split('.').map(Number);
  const prefix = parseInt(parts[1], 10);
  if (ip.length !== 4 || isNaN(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipInt = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0;
  const net = (ipInt & mask) >>> 0;
  return `${net >>> 24}.${(net >> 16) & 0xff}.${(net >> 8) & 0xff}.${net & 0xff}/${prefix}`;
}
