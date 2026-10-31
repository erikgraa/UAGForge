<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { buildTopology } from '../lib/topology';

  const topo = $derived(buildTopology(app.config));
  const right = $derived(topo.nodes.filter((n) => n.id !== 'client' && n.id !== 'uag'));
  const rowH = 54;
  const H = $derived(Math.max(150, right.length * rowH + 20));
  const uagY = $derived(H / 2);

  function pos(id: string): { x: number; y: number; w: number; h: number } {
    if (id === 'client') return { x: 10, y: uagY - 25, w: 130, h: 50 };
    if (id === 'uag') return { x: 255, y: uagY - 35, w: 150, h: 70 };
    const i = right.findIndex((n) => n.id === id);
    return { x: 500, y: 10 + i * rowH, w: 150, h: 44 };
  }
  function path(from: string, to: string): string {
    const a = pos(from);
    const b = pos(to);
    const [x1, y1, x2, y2] = a.x < b.x ? [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2] : [a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2];
    const mx = (x1 + x2) / 2;
    return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  }
  function mid(from: string, to: string) {
    const a = pos(from);
    const b = pos(to);
    return { x: (a.x + a.w + b.x) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 - 4 };
  }
  const trim = (s: string | undefined, n = 22) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
</script>

<section class="card topo" aria-label="Topology">
  <div class="card-head"><h3>Topology</h3></div>
  <svg viewBox={`0 0 660 ${H}`} role="img" aria-label="Deployment topology diagram">
    <defs>
      <linearGradient id="tg" x1="0" x2="1">
        <stop offset="0" stop-color="#6c8cff" />
        <stop offset="1" stop-color="#38e1c6" />
      </linearGradient>
    </defs>
    {#each topo.edges as e (e.from + e.to)}
      <path class="edge" d={path(e.from, e.to)} />
      {#if e.label}
        <text class="elabel" x={mid(e.from, e.to).x} y={mid(e.from, e.to).y}>{e.label}</text>
      {/if}
    {/each}
    {#each topo.nodes as n (n.id)}
      {@const p = pos(n.id)}
      <g class={`node ${n.kind}`}>
        <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="10" />
        <text x={p.x + p.w / 2} y={p.y + p.h / 2 - (n.sub ? 2 : -4)} font-weight={n.kind === 'uag' ? 700 : 400}>{trim(n.label)}</text>
        {#if n.sub}<text class="sub" x={p.x + p.w / 2} y={p.y + p.h / 2 + 13}>{trim(n.sub, 26)}</text>{/if}
      </g>
    {/each}
  </svg>
</section>
