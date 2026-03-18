import { Component, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TopologyMapComponent } from './features/topology-map/topology-map.component';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { MetricsChartComponent } from './features/metrics-chart/metrics-chart.component';
import { TopologyService } from './core/services/topology.service';
import { DeviceInfo } from './core/models/topology.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, TopologyMapComponent, SidebarComponent, MetricsChartComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  @ViewChild('topoMap') topoMap!: TopologyMapComponent;

  selectedDevice = signal<DeviceInfo | null>(null);
  detailOpen = signal(false);

  constructor(readonly topo: TopologyService) {}

  onDeviceSelected(d: DeviceInfo | null): void {
    this.selectedDevice.set(d);
    this.detailOpen.set(d !== null);
  }

  closeDetail(): void {
    this.selectedDevice.set(null);
    this.detailOpen.set(false);
    this.topoMap?.clearHighlight();
  }

  get onlineCount(): number {
    return [...this.topo.devices().values()].filter((d) => d.status === 'online').length;
  }

  get totalCount(): number {
    return this.topo.devices().size;
  }
}
