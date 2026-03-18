import { Injectable, signal, computed, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  DeviceInfo, FrontendMessage, MetricsUpdate, GraphNode, GraphLink,
  buildLinks, RouteAnalysis
} from '../models/topology.models';
import { environment } from '../../../environments/environment';
import { LogService } from './log.service';

export interface MetricsSeries {
  timestamp: Date;
  bytesRecvRate: number;
  bytesSentRate: number;
  packetsRecvRate: number;
  packetsSentRate: number;
  errorsInRate: number;
  errorsOutRate: number;
  dropsInRate: number;
  dropsOutRate: number;
}

const MAX_METRICS_HISTORY = 300; // ~25 min at 5 s intervals
const COMPONENT = 'TopologyService';

@Injectable({ providedIn: 'root' })
export class TopologyService implements OnDestroy {
  // ── Reactive state (Angular Signals) ─────────────────────────────────────
  readonly devices = signal<Map<string, DeviceInfo>>(new Map());
  readonly connected = signal(false);
  readonly lastUpdate = signal<Date | null>(null);

  // Per-device per-interface metrics ring buffer: deviceId+ifaceName → series
  private metricsBuffers = new Map<string, MetricsSeries[]>();

  readonly graphNodes = computed<GraphNode[]>(() =>
    [...this.devices().values()] as GraphNode[]
  );

  readonly graphLinks = computed<GraphLink[]>(() =>
    buildLinks([...this.devices().values()])
  );

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 2000;

  constructor(private http: HttpClient, private log: LogService) {
    this.log.info(COMPONENT, 'initializing', { wsUrl: environment.wsUrl });
    this.connect();
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.ws) {
      this.ws.close();
    }
    this.log.debug(COMPONENT, 'connecting', { url: environment.wsUrl });
    this.ws = new WebSocket(environment.wsUrl);

    this.ws.onopen = () => {
      this.connected.set(true);
      this.reconnectDelay = 2000;
      this.log.info(COMPONENT, 'websocket connected', { url: environment.wsUrl });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: FrontendMessage = JSON.parse(event.data);
        this.log.debug(COMPONENT, 'message received', { type: msg.type });
        this.handleMessage(msg);
      } catch (err) {
        this.log.warn(COMPONENT, 'failed to parse message', { err: String(err) });
      }
    };

    this.ws.onclose = (event) => {
      this.connected.set(false);
      this.log.warn(COMPONENT, 'websocket closed', { code: event.code, reason: event.reason || 'none' });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.log.error(COMPONENT, 'websocket error');
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.log.info(COMPONENT, 'scheduling reconnect', { delayMs: this.reconnectDelay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    // Exponential back-off, capped at 30 s
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
  }

  private handleMessage(msg: FrontendMessage): void {
    this.lastUpdate.set(new Date());

    if (msg.type === 'topology') {
      const map = new Map<string, DeviceInfo>();
      for (const d of msg.topology.devices) {
        map.set(d.id, d);
      }
      this.devices.set(map);
      this.log.info(COMPONENT, 'topology snapshot applied', { deviceCount: map.size });

    } else if (msg.type === 'device_update') {
      this.devices.update(m => {
        const next = new Map(m);
        next.set(msg.device_update.id, msg.device_update);
        return next;
      });
      this.log.debug(COMPONENT, 'device updated', { id: msg.device_update.id, hostname: msg.device_update.hostname });

    } else if (msg.type === 'device_offline') {
      this.devices.update(m => {
        const next = new Map(m);
        const d = next.get(msg.device_offline.device_id);
        if (d) next.set(d.id, { ...d, status: 'offline' });
        return next;
      });
      this.log.warn(COMPONENT, 'device went offline', { deviceId: msg.device_offline.device_id, hostname: msg.device_offline.hostname });

    } else if (msg.type === 'metrics') {
      this.pushMetrics(msg.metrics);
    }
  }

  private pushMetrics(m: MetricsUpdate): void {
    const key = `${m.device_id}/${m.interface_name}`;
    if (!this.metricsBuffers.has(key)) {
      this.metricsBuffers.set(key, []);
    }
    const buf = this.metricsBuffers.get(key)!;
    buf.push({
      timestamp: new Date(m.timestamp),
      bytesRecvRate: m.bytes_recv_rate,
      bytesSentRate: m.bytes_sent_rate,
      packetsRecvRate: m.packets_recv_rate,
      packetsSentRate: m.packets_sent_rate,
      errorsInRate: m.errors_in_rate,
      errorsOutRate: m.errors_out_rate,
      dropsInRate: m.drops_in_rate,
      dropsOutRate: m.drops_out_rate,
    });
    if (buf.length > MAX_METRICS_HISTORY) {
      buf.splice(0, buf.length - MAX_METRICS_HISTORY);
    }
  }

  /** Returns live metrics history for a device+interface pair. */
  getMetrics(deviceId: string, ifaceName: string): MetricsSeries[] {
    return this.metricsBuffers.get(`${deviceId}/${ifaceName}`) ?? [];
  }

  // ── REST helpers ──────────────────────────────────────────────────────────

  analyzeRoute(srcId: string, dstId: string) {
    this.log.debug(COMPONENT, 'route analysis requested', { src: srcId, dst: dstId });
    return this.http.get<RouteAnalysis>(
      `${environment.apiUrl}/api/route?src=${srcId}&dst=${dstId}`
    );
  }

  ngOnDestroy(): void {
    this.log.info(COMPONENT, 'destroying service');
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
