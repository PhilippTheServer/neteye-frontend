import {
  Component,
  OnDestroy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  Output,
  EventEmitter,
  effect,
} from '@angular/core';
import * as d3 from 'd3';
import { GraphNode, GraphLink, DeviceInfo, RouteHop } from '../../core/models/topology.models';
import { TopologyService } from '../../core/services/topology.service';

// Palette: one colour per subnet CIDR (assigned on first seen, cycled)
const NET_COLORS = [
  '#00d4aa',
  '#7c6bff',
  '#ff6b9d',
  '#ffaa00',
  '#00b4d8',
  '#ff6348',
  '#a8e6cf',
  '#dcedc1',
  '#ffd3b6',
  '#ffaaa5',
  '#c7ceea',
  '#b5ead7',
];

@Component({
  selector: 'app-topology-map',
  standalone: true,
  template: `
    <div class="map-wrap" #mapWrap>
      <svg #svg class="topo-svg"></svg>
      <div class="zoom-controls">
        <button (click)="zoomIn()">+</button>
        <button (click)="zoomOut()">−</button>
        <button (click)="resetZoom()" title="Fit all">⌂</button>
      </div>
      <div class="hint">drag · scroll to zoom · click to inspect</div>
    </div>
  `,
  styleUrls: ['./topology-map.component.scss'],
})
export class TopologyMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('svg') svgRef!: ElementRef<SVGSVGElement>;
  @ViewChild('mapWrap') wrapRef!: ElementRef<HTMLDivElement>;

  @Output() deviceSelected = new EventEmitter<DeviceInfo | null>();

  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private sim!: d3.Simulation<GraphNode, GraphLink>;

  private linkSel!: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  private labelSel!: d3.Selection<SVGTextElement, GraphLink, SVGGElement, unknown>;
  private nodeSel!: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;

  private colorMap = new Map<string, string>();
  private colorIdx = 0;

  private nodeIds = new Set<string>();
  private linkKeys = new Set<string>();

  private resizeObserver!: ResizeObserver;
  private effectRef: ReturnType<typeof effect>;

  constructor(private topo: TopologyService) {
    // Re-render whenever signals change
    this.effectRef = effect(() => {
      const nodes = this.topo.graphNodes();
      const links = this.topo.graphLinks();
      if (this.sim) {
        this.updateGraph(nodes, links);
      }
    });
  }

  ngAfterViewInit(): void {
    this.initSvg();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.wrapRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.effectRef.destroy();
    this.resizeObserver?.disconnect();
    this.sim?.stop();
  }

  // ── Initialise SVG & simulation ────────────────────────────────────────────

  private initSvg(): void {
    const wrap = this.wrapRef.nativeElement;
    const W = wrap.clientWidth,
      H = wrap.clientHeight;

    this.svg = d3.select(this.svgRef.nativeElement).attr('width', W).attr('height', H);

    this.zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 5])
      .on('zoom', (e) => this.g.attr('transform', e.transform));

    this.svg.call(this.zoom).on('click', () => {
      this.deviceSelected.emit(null);
      this.clearHighlight();
    });

    this.g = this.svg.append('g');

    // Layer order: links → link-labels → nodes
    this.g.append('g').attr('class', 'links');
    this.g.append('g').attr('class', 'link-labels');
    this.g.append('g').attr('class', 'nodes');

    this.sim = d3
      .forceSimulation<GraphNode, GraphLink>()
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>()
          .id((d) => d.id)
          .distance(160)
          .strength(0.25),
      )
      .force('charge', d3.forceManyBody().strength(-600))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(55))
      .on('tick', () => this.tick());

    // Initial render
    this.updateGraph(this.topo.graphNodes(), this.topo.graphLinks());
  }

  // ── Data update ────────────────────────────────────────────────────────────

  private updateGraph(nodes: GraphNode[], links: GraphLink[]): void {
    if (!this.g) return;

    // Detect structural changes (nodes or links added/removed)
    const newNodeIds = new Set(nodes.map((n) => n.id));
    const pairKey = (l: GraphLink): string => {
      const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      return [s, t].sort().join('|');
    };
    const newLinkKeys = new Set(links.map(pairKey));
    const structural =
      newNodeIds.size !== this.nodeIds.size ||
      [...newNodeIds].some((id) => !this.nodeIds.has(id)) ||
      newLinkKeys.size !== this.linkKeys.size ||
      [...newLinkKeys].some((k) => !this.linkKeys.has(k));
    this.nodeIds = newNodeIds;
    this.linkKeys = newLinkKeys;

    // Assign colours to CIDRs from links
    for (const l of links) {
      for (const cidr of l.cidrs) {
        if (!this.colorMap.has(cidr)) {
          this.colorMap.set(cidr, NET_COLORS[this.colorIdx++ % NET_COLORS.length]);
        }
      }
    }
    // Also assign colours from node addresses (needed when there are no links yet)
    for (const n of nodes) {
      for (const iface of n.interfaces) {
        for (const addr of iface.addresses) {
          if (addr.family !== 'ipv4') continue;
          const net = cidrNetworkFromAddress(addr.address);
          if (net && !this.colorMap.has(net)) {
            this.colorMap.set(net, NET_COLORS[this.colorIdx++ % NET_COLORS.length]);
          }
        }
      }
    }

    // ── Links ─────────────────────────────────────────────────────────────
    this.linkSel = this.g
      .select<SVGGElement>('.links')
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(links, (d: GraphLink) => pairKey(d));

    this.linkSel.exit().remove();

    const linkEnter = this.linkSel
      .enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke-dasharray', (d: GraphLink) => (d.isVpn ? '6 3' : null))
      .on('click', (e: MouseEvent, d: GraphLink) => {
        e.stopPropagation();
        this.highlightNetwork(d.cidr);
      });

    this.linkSel = linkEnter
      .merge(this.linkSel)
      .attr('stroke', (d: GraphLink) => this.colorMap.get(d.cidr) ?? '#888');

    // ── Link labels ───────────────────────────────────────────────────────
    this.labelSel = this.g
      .select<SVGGElement>('.link-labels')
      .selectAll<SVGTextElement, GraphLink>('text')
      .data(links, (d: GraphLink) => pairKey(d));

    this.labelSel.exit().remove();

    this.labelSel = this.labelSel
      .enter()
      .append('text')
      .attr('class', 'link-label')
      .merge(this.labelSel)
      .text((d: GraphLink) => d.label)
      .attr('fill', (d: GraphLink) => this.colorMap.get(d.cidr) ?? '#888');

    // ── Nodes ─────────────────────────────────────────────────────────────
    this.nodeSel = this.g
      .select<SVGGElement>('.nodes')
      .selectAll<SVGGElement, GraphNode>('g.node')
      .data(nodes, (d: GraphNode) => d.id);

    this.nodeSel.exit().remove();

    const nodeEnter = this.nodeSel
      .enter()
      .append('g')
      .attr('class', 'node')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (e, d) => this.dragStart(e, d))
          .on('drag', (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on('end', (e, d) => this.dragEnd(e, d)),
      )
      .on('click', (e: MouseEvent, d: GraphNode) => {
        e.stopPropagation();
        this.highlightDevice(d.id);
        this.deviceSelected.emit(d);
      });

    // Background rect
    nodeEnter
      .append('rect')
      .attr('class', 'node-bg')
      .attr('x', -52)
      .attr('y', -20)
      .attr('width', 104)
      .attr('height', 40)
      .attr('rx', 8);

    // Device name
    nodeEnter.append('text').attr('class', 'node-name').attr('y', -4);

    // Device type
    nodeEnter.append('text').attr('class', 'node-type').attr('y', 11);

    // Interface colour bars (bottom of rect)
    nodeEnter.append('g').attr('class', 'iface-bars');

    // Status dot (top-right)
    nodeEnter
      .append('circle')
      .attr('class', 'status-dot')
      .attr('cx', 46)
      .attr('cy', -14)
      .attr('r', 4);

    // Merge and update all mutable attrs
    this.nodeSel = nodeEnter.merge(this.nodeSel);

    this.nodeSel.select('.node-bg').attr('stroke', (d: GraphNode) => this.primaryColor(d));

    this.nodeSel
      .select('.node-name')
      .text((d: GraphNode) =>
        d.hostname.length > 13 ? d.hostname.slice(0, 12) + '…' : d.hostname,
      );

    this.nodeSel.select('.node-type').text((d: GraphNode) => `${d.os ?? ''}/${d.arch ?? ''}`);

    this.nodeSel
      .select('.status-dot')
      .attr('fill', (d: GraphNode) => (d.status === 'online' ? '#00d4aa' : '#ff4757'));

    // Rebuild iface bars — capture colorMap via arrow function closure
    const colorMap = this.colorMap;
    this.nodeSel
      .select<SVGGElement>('.iface-bars')
      .each((d: GraphNode, _i: number, groups: SVGGElement[] | ArrayLike<SVGGElement>) => {
        const g = d3.select(Array.from(groups)[_i]);
        g.selectAll('*').remove();
        const cidrs = uniqueCidrs(d);
        if (cidrs.length === 0) return;
        const bw = 104 / cidrs.length;
        cidrs.forEach((cidr, idx) => {
          const color = colorMap.get(cidr) ?? '#888';
          g.append('rect')
            .attr('x', -52 + idx * bw)
            .attr('y', 16)
            .attr('width', bw)
            .attr('height', 4)
            .attr('fill', color)
            .attr('rx', idx === 0 ? 2 : idx === cidrs.length - 1 ? 2 : 0);
        });
      });

    // Restart simulation — only re-heat on structural changes to preserve positions
    this.sim.nodes(nodes);
    (this.sim.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(links);
    if (structural) {
      this.sim.alpha(0.3).restart();
    }
  }

  // ── Simulation tick ────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.linkSel || !this.labelSel || !this.nodeSel) return;

    this.linkSel
      .attr('x1', (d: GraphLink) => (d.source as GraphNode).x ?? 0)
      .attr('y1', (d: GraphLink) => (d.source as GraphNode).y ?? 0)
      .attr('x2', (d: GraphLink) => (d.target as GraphNode).x ?? 0)
      .attr('y2', (d: GraphLink) => (d.target as GraphNode).y ?? 0);

    this.labelSel
      .attr('x', (d: GraphLink) => ((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2)
      .attr('y', (d: GraphLink) => ((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2);

    this.nodeSel.attr('transform', (d: GraphNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  }

  // ── Highlight helpers ──────────────────────────────────────────────────────

  highlightDevice(id: string): void {
    this.nodeSel?.classed('dimmed', (d: GraphNode) => d.id !== id);
    this.linkSel?.classed('dimmed', (d: GraphLink) => {
      const s = (d.source as GraphNode).id,
        t = (d.target as GraphNode).id;
      return s !== id && t !== id;
    });
    this.linkSel?.classed('highlighted', (d: GraphLink) => {
      const s = (d.source as GraphNode).id,
        t = (d.target as GraphNode).id;
      return s === id || t === id;
    });
  }

  highlightNetwork(cidr: string): void {
    const nodeIds = new Set<string>();
    this.linkSel?.each((d: GraphLink) => {
      if (d.cidr === cidr) {
        nodeIds.add((d.source as GraphNode).id);
        nodeIds.add((d.target as GraphNode).id);
      }
    });
    this.nodeSel?.classed('dimmed', (d: GraphNode) => !nodeIds.has(d.id));
    this.linkSel?.classed('dimmed', (d: GraphLink) => d.cidr !== cidr);
    this.linkSel?.classed('highlighted', (d: GraphLink) => d.cidr === cidr);
  }

  highlightPath(hops: RouteHop[]): void {
    const hopIds = new Set(hops.map((h) => h.device_id));
    const edgeKeys = new Set<string>();
    for (let i = 1; i < hops.length; i++) {
      edgeKeys.add(`${hops[i - 1].device_id}|${hops[i].device_id}|${hops[i].via_cidr}`);
      edgeKeys.add(`${hops[i].device_id}|${hops[i - 1].device_id}|${hops[i].via_cidr}`);
    }
    this.nodeSel?.classed('dimmed', (d: GraphNode) => !hopIds.has(d.id));
    this.linkSel?.classed('dimmed', (d: GraphLink) => {
      const s = (d.source as GraphNode).id,
        t = (d.target as GraphNode).id;
      return !edgeKeys.has(`${s}|${t}|${d.cidr}`);
    });
    this.linkSel?.classed('highlighted', (d: GraphLink) => {
      const s = (d.source as GraphNode).id,
        t = (d.target as GraphNode).id;
      return edgeKeys.has(`${s}|${t}|${d.cidr}`);
    });
  }

  clearHighlight(): void {
    this.nodeSel?.classed('dimmed', false);
    this.linkSel?.classed('dimmed highlighted', false);
  }

  // ── Zoom controls ──────────────────────────────────────────────────────────

  zoomIn(): void {
    this.svg.transition().call(this.zoom.scaleBy, 1.4);
  }
  zoomOut(): void {
    this.svg.transition().call(this.zoom.scaleBy, 0.71);
  }
  resetZoom(): void {
    const wrap = this.wrapRef.nativeElement;
    this.svg
      .transition()
      .call(
        this.zoom.transform,
        d3.zoomIdentity.translate(wrap.clientWidth / 2, wrap.clientHeight / 2).scale(1),
      );
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

  private dragStart(e: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode): void {
    if (!e.active) this.sim.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  private dragEnd(e: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode): void {
    if (!e.active) this.sim.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  private onResize(): void {
    const wrap = this.wrapRef.nativeElement;
    this.svg.attr('width', wrap.clientWidth).attr('height', wrap.clientHeight);
    (this.sim.force('center') as d3.ForceCenter<GraphNode>)
      .x(wrap.clientWidth / 2)
      .y(wrap.clientHeight / 2);
    this.sim.alpha(0.1).restart();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private primaryColor(d: GraphNode): string {
    for (const iface of d.interfaces) {
      for (const addr of iface.addresses) {
        if (addr.family !== 'ipv4') continue;
        const net = cidrNetworkFromAddress(addr.address);
        if (net && this.colorMap.has(net)) return this.colorMap.get(net)!;
      }
    }
    return '#444';
  }

  getNetworkColor(cidr: string): string {
    return this.colorMap.get(cidr) ?? '#888';
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────────

function uniqueCidrs(d: GraphNode): string[] {
  const seen = new Set<string>();
  for (const iface of d.interfaces) {
    for (const addr of iface.addresses) {
      if (addr.family !== 'ipv4') continue;
      const net = cidrNetworkFromAddress(addr.address);
      if (net) seen.add(net);
    }
  }
  return [...seen];
}

function cidrNetworkFromAddress(address: string): string | null {
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
