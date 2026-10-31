import { describe, expect, it } from 'vitest';
import { defaultConfig, applyPatch } from './model';
import { generateIni, generateJson } from './generate';
import { importIni, importJson, importText, parseIni, versionFromSource } from './importer';
import { TEMPLATES } from './templates';

const SAMPLE = `
# comment
[General]
name=UAG1
source=C:\\ova\\euc-unified-access-gateway-25.06.0.0-15261880358_OVF10.ova
deploymentOption=threenic
uagName=UAG1
dns=192.0.2.1 192.0.2.2
ntpServers=pool.ntp.org
tls10Enabled=false
tls12Enabled=true
snmpEnabled=TRUE
bogusKey=1

[Horizon]
proxyDestinationUrl=https://cs.corp.local
proxyDestinationUrlThumbprints=sha1=C3 89 A2 19 DC 7A 48 2B 85 1C 81 EC 5E 8F 6A 3C 33 F2 95 C3
authMethods=radius-auth
blastEnabled=true
blastExternalUrl=https://uag.example.com:443

[RADIUSAuth]
hostName=r1.corp.local
authPort=1812
authType=MSCHAP2
sharedSecret=*****
numAttempts=3
serverTimeout=5

[WebReverseProxy1]
instanceId=view
proxyDestinationUrl=https://intranet.corp.local
proxyPattern=/(.*)

[SyslogServerSettings1]
sysLogType=TCP
syslogUrl=syslog.corp.local:514

[SnmpSettings]
version=V1+V2c
communityName=abc
`;

describe('INI parsing', () => {
  it('parses sections, comments and values with "="', () => {
    const doc = parseIni('[A]\n# c\nk=v=w\n; x\n\n[B]\nk2 = v2 ');
    expect(doc).toEqual([
      { section: 'A', entries: [{ key: 'k', value: 'v=w' }] },
      { section: 'B', entries: [{ key: 'k2', value: 'v2' }] }
    ]);
  });
  it('detects the UAG version from the image file name', () => {
    expect(versionFromSource('C:\\x\\euc-unified-access-gateway-25.06.0.0-15261880358_OVF10.ova')).toBe('2506');
    expect(versionFromSource('euc-unified-access-gateway-21.00.0.0-1.ova')).toBeUndefined();
  });
});

describe('INI import', () => {
  const r = importIni(SAMPLE);
  it('maps documented keys onto form fields', () => {
    expect(r.format).toBe('ini');
    expect(r.config.version).toBe('2506');
    expect(r.config.values).toMatchObject({
      uagName: 'UAG1',
      deploymentOption: 'threenic',
      dns: '192.0.2.1 192.0.2.2',
      horizon_enabled: true,
      proxyDestinationUrl: 'https://cs.corp.local',
      authMethods: 'radius-auth',
      blastEnabled: true,
      radius_enabled: true,
      radius_hostName: 'r1.corp.local',
      radius_authPort: 1812,
      radius_authType: 'MSCHAP2',
      snmp_enabled: true,
      snmp_communityName: 'abc'
    });
    expect(r.config.wrp).toHaveLength(1);
    expect(r.config.wrp[0].instanceId).toBe('view');
    expect(r.config.syslog[0]).toMatchObject({ sysLogType: 'TCP', syslogUrl: 'syslog.corp.local:514' });
  });
  it('reports unknown keys and ignores masked secrets', () => {
    expect(r.unmapped).toContainEqual({ where: '[General]', key: 'bogusKey', value: '1' });
    expect(r.config.values.radius_sharedSecret).toBe('');
  });
  it('disables Horizon when no [Horizon] section exists', () => {
    expect(importIni('[General]\nuagName=x').config.values.horizon_enabled).toBe(false);
  });
  it('warns about keys newer than the detected version', () => {
    const w = importIni('[General]\nsource=euc-unified-access-gateway-22.12.0.0-1.ova\nheadersToBeLogged=host').warnings;
    expect(w.join('\n')).toMatch(/headersToBeLogged.*2312/);
  });
  it('detects Azure from the [Azure] section', () => {
    expect(importIni('[General]\nuagName=x\n[Azure]\nsubscriptionID=1\nlocation=uksouth').config.platform).toBe('azure');
  });
});

describe('round trip', () => {
  it('INI -> config -> INI -> config is stable for every template', () => {
    for (const t of TEMPLATES) {
      const cfg = t.build(defaultConfig());
      const ini = generateIni(cfg, { secrets: 'include' });
      const back = importIni(ini, cfg).config;
      expect(generateIni(back, { secrets: 'include' })).toBe(ini);
    }
  });
  it('JSON -> config -> JSON is stable for every template', () => {
    for (const t of TEMPLATES) {
      const cfg = t.build(defaultConfig());
      const json = generateJson(cfg, { secrets: 'include' });
      const res = importJson(json, cfg);
      expect(res.unmapped).toEqual([]);
      expect(generateJson(res.config, { secrets: 'include' })).toBe(json);
    }
  });
});

describe('JSON import', () => {
  it('rejects invalid JSON gracefully', () => {
    const r = importJson('{nope');
    expect(r.warnings[0]).toMatch(/Invalid JSON/);
  });
  it('imports an admin-UI style export and reports unsupported blocks', () => {
    const doc = {
      systemSettings: { uagName: 'U2', tls12Enabled: true, tls10Enabled: false, cipherSuites: ['A', 'B'], snmpEnabled: true, someFutureKey: 1 },
      edgeServiceSettingsList: {
        edgeServiceSettingsList: [
          { identifier: 'VIEW', enabled: true, proxyDestinationUrl: 'https://cs', blastEnabled: true, authMethods: 'radius-auth' },
          { identifier: 'WEB_REVERSE_PROXY', instanceId: 'wiki', proxyDestinationUrl: 'https://wiki', proxyPattern: '/(.*)' },
          { identifier: 'TUNNEL', enabled: true }
        ]
      },
      authMethodSettingsList: { authMethodSettingsList: [{ name: 'radius-auth', enabled: true, hostName: 'r', authPort: 1812 }, { name: 'securid-auth' }] },
      unknownTop: {}
    };
    const r = importText(JSON.stringify(doc));
    expect(r.format).toBe('json');
    expect(r.config.values).toMatchObject({ uagName: 'U2', cipherSuites: 'A,B', horizon_enabled: true, radius_enabled: true, radius_hostName: 'r', snmp_enabled: true });
    expect(r.config.wrp[0].instanceId).toBe('wiki');
    const keys = r.unmapped.map((u) => u.key);
    expect(keys).toEqual(expect.arrayContaining(['someFutureKey', 'identifier=TUNNEL', 'name=securid-auth', 'unknownTop']));
  });
  it('autodetects format', () => {
    expect(importText('{"systemSettings":{}}').format).toBe('json');
    expect(importText('[General]\nuagName=a').format).toBe('ini');
  });
});

describe('patching', () => {
  it('applyPatch keeps defaults for list items', () => {
    const c = applyPatch(defaultConfig(), { wrp: [{ instanceId: 'a' }] });
    expect(c.wrp[0].proxyPattern).toBe('/(.*)');
  });
});
