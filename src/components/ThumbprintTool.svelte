<script lang="ts">
  import { app } from '../lib/store.svelte';
  import {
    thumbprints,
    uagThumbprint,
    powershellThumbprintCommand,
    helperAvailable,
    helperFetch,
    HELPER_URL,
    type HashAlg,
    type ThumbprintSet
  } from '../lib/thumbprint';
  import { copy } from '../lib/render';

  type Mode = 'paste' | 'ps' | 'helper';
  let mode = $state<Mode>('paste');
  let pem = $state('');
  let alg = $state<HashAlg>('SHA-256');
  let set = $state<ThumbprintSet | null>(null);
  let err = $state('');
  let helperUp = $state<boolean | null>(null);
  let helperMsg = $state('');
  let busy = $state(false);

  const hostPort = $derived(String(app.config.values.proxyDestinationUrl || 'cs01.corp.local'));
  const psCmd = $derived(powershellThumbprintCommand(hostPort));

  async function compute(input: string | Uint8Array) {
    err = '';
    try {
      set = await thumbprints(input);
    } catch (e) {
      set = null;
      err = (e as Error).message;
    }
  }

  async function onFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    await compute(buf);
  }

  function apply(value: string) {
    const existing = String(app.config.values.proxyDestinationUrlThumbprints || '').trim();
    app.config.values.proxyDestinationUrlThumbprints = existing && existing !== value ? `${existing},${value}` : value;
    app.say('Thumbprint added to the Horizon edge service');
  }

  async function checkHelper() {
    helperUp = await helperAvailable();
    helperMsg = helperUp ? 'Helper detected.' : 'Helper not running (optional). Start it with: node helper/uag-forge-helper.mjs';
  }

  async function fetchViaHelper() {
    busy = true;
    helperMsg = '';
    try {
      const r = await helperFetch(hostPort);
      const colon = (hex: string) => hex;
      set = { 'SHA-1': colon(r.sha1), 'SHA-256': colon(r.sha256), 'SHA-384': colon(r.sha384 ?? ''), 'SHA-512': colon(r.sha512) };
      helperMsg = `Fetched certificate of ${r.subject ?? r.host}${r.validTo ? ` (valid to ${r.validTo})` : ''}.`;
      apply(uagThumbprint(set, alg));
    } catch (e) {
      helperMsg = `Helper request failed: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (mode === 'helper' && helperUp === null) void checkHelper();
  });
</script>

<section class="card">
  <div class="card-head"><h3>Thumbprint helper</h3></div>
  <p class="help">
    A static web page cannot read a remote server's TLS certificate. Paste the certificate, run the one-liner, or use the optional local helper. Everything stays on your machine.
  </p>
  <div class="tabs2" role="tablist">
    <button role="tab" aria-selected={mode === 'paste'} class:on={mode === 'paste'} onclick={() => (mode = 'paste')}>Paste certificate</button>
    <button role="tab" aria-selected={mode === 'ps'} class:on={mode === 'ps'} onclick={() => (mode = 'ps')}>PowerShell</button>
    <button role="tab" aria-selected={mode === 'helper'} class:on={mode === 'helper'} onclick={() => (mode = 'helper')}>Local helper (optional)</button>
  </div>

  {#if mode === 'paste'}
    <textarea rows="5" class="mono" bind:value={pem} oninput={() => pem.trim() && compute(pem)} placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" aria-label="Certificate PEM"></textarea>
    <div class="row" style="margin-top:8px">
      <input type="file" accept=".pem,.crt,.cer,.der" onchange={onFile} aria-label="Certificate file (PEM or DER)" />
    </div>
  {:else if mode === 'ps'}
    <p class="help">Run on any Windows/PowerShell host that can reach <code>{hostPort}</code>, then paste the printed value into the Connection Server thumbprint field.</p>
    <div class="result">{psCmd}</div>
    <div class="row" style="margin-top:8px"><button class="small" onclick={async () => app.say((await copy(psCmd)) ? 'Copied' : 'Copy failed')}>Copy one-liner</button></div>
  {:else}
    <p class="help">
      Run <code>node helper/uag-forge-helper.mjs</code> locally. It listens on <code>{HELPER_URL}</code>, fetches the certificate of <code>{hostPort}</code> and returns only its public fingerprints. The app works fully without it.
    </p>
    <div class="row">
      <button class="small" onclick={checkHelper}>Check helper</button>
      <button class="small primary" onclick={fetchViaHelper} disabled={busy || helperUp === false}>Fetch &amp; apply thumbprint</button>
      <span class="chip">{helperUp === null ? 'checking…' : helperUp ? 'running' : 'not running'}</span>
    </div>
    {#if helperMsg}<p class="help" style="margin-top:8px">{helperMsg}</p>{/if}
  {/if}

  {#if err}<p class="err" style="color:var(--bad)">{err}</p>{/if}
  {#if set}
    <div style="margin-top:12px">
      {#each ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as a (a)}
        {#if set[a as HashAlg]}
          <div class="srow"><b>{a}</b><div class="result">{set[a as HashAlg]}</div></div>
        {/if}
      {/each}
      <div class="row">
        <label class="row">Use <select class="t" bind:value={alg}>
            <option>SHA-256</option><option>SHA-384</option><option>SHA-512</option><option>SHA-1</option>
          </select></label>
        <button class="small primary" onclick={() => set && apply(uagThumbprint(set, alg))}>Add to Horizon thumbprints</button>
      </div>
    </div>
  {/if}
</section>
