import type { Values } from './schema';

/** Proxy pattern for the outer UAG, from "Minimum Horizon Protocols" (double DMZ). */
export const CASCADE_PATTERN = '(/broker/xml(.*)|/xmlapi(.*)|/broker/resources/(.*)|/ice/(.*)|/r/(.*)|/portal(.*)|/view-client/(.*)|/)';
export const CASCADE_PATTERN_OPSWAT = '(/broker/xml(.*)|/xmlapi(.*)|/broker/resources/(.*)|/ice/(.*)|/r/(.*)|/portal(.*)|/|/gateway/resources/(.*))';
export const CASCADE_INSTANCE_ID = 'Horizon-WRP';

export type CascadeRole = 'none' | 'outer' | 'inner';

export const FORWARD_FLAGS: { id: string; proto: 'tcp' | 'udp'; port: number }[] = [
  { id: 'cascade_fwdBlastTcp', proto: 'tcp', port: 8443 },
  { id: 'cascade_fwdBlastUdp', proto: 'udp', port: 8443 },
  { id: 'cascade_fwdUdpTunnel', proto: 'udp', port: 443 },
  { id: 'cascade_fwdPcoipTcp', proto: 'tcp', port: 4172 },
  { id: 'cascade_fwdPcoipUdp', proto: 'udp', port: 4172 }
];

export function cascadeRole(v: Values): CascadeRole {
  return v.cascade_role === 'outer' || v.cascade_role === 'inner' ? v.cascade_role : 'none';
}

/** `forwardrules` value for the outer UAG ([General]), e.g. tcp/8443/192.168.2.101:8443,udp/8443/... */
export function forwardRules(v: Values): string {
  const ip = String(v.cascade_innerIp ?? '').trim();
  if (!ip) return '';
  return FORWARD_FLAGS.filter((f) => v[f.id] === true)
    .map((f) => `${f.proto}/${f.port}/${ip}:${f.port}`)
    .join(',');
}

export function hasForwardRules(v: Values): boolean {
  return FORWARD_FLAGS.some((f) => v[f.id] === true);
}

/** Apply a `forwardrules` string onto the cascade flags; returns the inner IP found (if any). */
export function parseForwardRules(value: string, v: Values): void {
  for (const f of FORWARD_FLAGS) v[f.id] = false;
  for (const raw of value.split(',')) {
    const m = /^\s*(tcp|udp)\/(\d+)\/([^:\s]+):(\d+)\s*$/i.exec(raw);
    if (!m) continue;
    const flag = FORWARD_FLAGS.find((f) => f.proto === m[1].toLowerCase() && f.port === Number(m[2]));
    if (flag) v[flag.id] = true;
    if (!v.cascade_innerIp) v.cascade_innerIp = m[3];
  }
}
