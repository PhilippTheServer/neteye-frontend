import {
  Component, Input, OnChanges, SimpleChanges,
  ElementRef, ViewChild, AfterViewInit, OnDestroy
} from '@angular/core';
import * as d3 from 'd3';
import { DeviceInfo } from '../../core/models/topology.models';
import { TopologyService, MetricsSeries } from '../../core/services/topology.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-metrics-chart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './metrics-chart.component.html',
  styleUrls: ['./metrics-chart.component.scss'],
})
export class MetricsChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() device: DeviceInfo | null = null;
  @ViewChild('chartWrap') chartWrapRef!: ElementRef<HTMLDivElement>;

  selectedIface = '';
  selectedMetric: 'throughput' | 'packets' | 'errors' = 'throughput';

  private svg?: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private frameId?: number;
  private initialized = false;

  constructor(private topo: TopologyService) {}

  ngAfterViewInit(): void {
    this.initialized = true;
    this.startRenderLoop();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['device'] && this.device) {
      // Default to first interface
      if (!this.selectedIface || !this.device.interfaces.find(i => i.name === this.selectedIface)) {
        this.selectedIface = this.device.interfaces[0]?.name ?? '';
      }
    }
  }

  ngOnDestroy(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId);
  }

  private startRenderLoop(): void {
    const loop = () => {
      this.renderChart();
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private renderChart(): void {
    if (!this.device || !this.selectedIface || !this.chartWrapRef) return;

    const series = this.topo.getMetrics(this.device.id, this.selectedIface);
    if (series.length < 2) {
      // Not enough data yet — clear
      if (this.svg) { this.svg.selectAll('*').remove(); }
      return;
    }

    const wrap = this.chartWrapRef.nativeElement;
    const W = wrap.clientWidth;
    const H = 140;
    const margin = { top: 10, right: 16, bottom: 24, left: 60 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    if (!this.svg) {
      this.svg = d3.select(wrap).append('svg')
        .attr('width', W).attr('height', H);
    } else {
      this.svg.attr('width', W).attr('height', H).selectAll('*').remove();
    }

    const g = this.svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Determine which series to plot
    const { key1, key2, label1, label2 } = this.getSeriesKeys();

    const xScale = d3.scaleTime()
      .domain(d3.extent(series, d => d.timestamp) as [Date, Date])
      .range([0, innerW]);

    const yMax = d3.max(series, d => Math.max(
      (d as any)[key1] ?? 0,
      (d as any)[key2] ?? 0
    )) ?? 1;

    const yScale = d3.scaleLinear()
      .domain([0, yMax * 1.1])
      .range([innerH, 0]);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(yScale).ticks(4).tickSize(-innerW).tickFormat(() => ''))
      .call(gr => gr.select('.domain').remove())
      .call(gr => gr.selectAll('.tick line')
        .attr('stroke', 'rgba(255,255,255,0.05)'));

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M:%S') as any))
      .call(ax => ax.select('.domain').attr('stroke', 'rgba(255,255,255,0.1)'))
      .call(ax => ax.selectAll('text').attr('fill', 'var(--text2)').attr('font-size', '9px').attr('font-family', 'var(--mono)'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.1)'));

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => this.formatValue(+d)))
      .call(ax => ax.select('.domain').attr('stroke', 'rgba(255,255,255,0.1)'))
      .call(ax => ax.selectAll('text').attr('fill', 'var(--text2)').attr('font-size', '9px').attr('font-family', 'var(--mono)'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.1)'));

    // Area + line for series 1 (recv/in)
    const area1 = d3.area<MetricsSeries>()
      .x(d => xScale(d.timestamp))
      .y0(innerH)
      .y1(d => yScale((d as any)[key1] ?? 0))
      .curve(d3.curveMonotoneX);

    const line1 = d3.line<MetricsSeries>()
      .x(d => xScale(d.timestamp))
      .y(d => yScale((d as any)[key1] ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(series).attr('class', 'area-recv')
      .attr('d', area1).attr('fill', 'rgba(0,212,170,0.08)');
    g.append('path').datum(series).attr('class', 'line-recv')
      .attr('d', line1).attr('fill', 'none')
      .attr('stroke', '#00d4aa').attr('stroke-width', 1.5);

    // Area + line for series 2 (sent/out)
    const area2 = d3.area<MetricsSeries>()
      .x(d => xScale(d.timestamp))
      .y0(innerH)
      .y1(d => yScale((d as any)[key2] ?? 0))
      .curve(d3.curveMonotoneX);

    const line2 = d3.line<MetricsSeries>()
      .x(d => xScale(d.timestamp))
      .y(d => yScale((d as any)[key2] ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(series).attr('class', 'area-sent')
      .attr('d', area2).attr('fill', 'rgba(124,107,255,0.08)');
    g.append('path').datum(series).attr('class', 'line-sent')
      .attr('d', line2).attr('fill', 'none')
      .attr('stroke', '#7c6bff').attr('stroke-width', 1.5);

    // Legend
    const legend = g.append('g').attr('transform', `translate(${innerW - 120}, 0)`);
    [
      { color: '#00d4aa', label: label1 },
      { color: '#7c6bff', label: label2 },
    ].forEach((item, i) => {
      const row = legend.append('g').attr('transform', `translate(0,${i * 14})`);
      row.append('rect').attr('width', 12).attr('height', 3).attr('y', 5)
        .attr('fill', item.color).attr('rx', 1);
      row.append('text').attr('x', 16).attr('y', 9)
        .attr('fill', 'var(--text2)').attr('font-size', '9px')
        .attr('font-family', 'var(--mono)').text(item.label);
    });
  }

  private getSeriesKeys(): { key1: string; key2: string; label1: string; label2: string } {
    switch (this.selectedMetric) {
      case 'throughput':
        return { key1: 'bytesRecvRate', key2: 'bytesSentRate', label1: 'RX', label2: 'TX' };
      case 'packets':
        return { key1: 'packetsRecvRate', key2: 'packetsSentRate', label1: 'PKT-RX', label2: 'PKT-TX' };
      case 'errors':
        return { key1: 'errorsInRate', key2: 'errorsOutRate', label1: 'ERR-IN', label2: 'ERR-OUT' };
    }
  }

  private formatValue(n: number): string {
    if (this.selectedMetric === 'throughput') {
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toFixed(0);
    }
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  }

  get latestMetrics(): MetricsSeries | null {
    if (!this.device || !this.selectedIface) return null;
    const series = this.topo.getMetrics(this.device.id, this.selectedIface);
    return series.length > 0 ? series[series.length - 1] : null;
  }

  onMetricChange(): void {}
  onIfaceChange(): void {}
}
