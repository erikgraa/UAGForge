import type { Config } from './model';
import { generateIni, generateJson, iniFileName, jsonFileName, platformScript, type SecretMode } from './generate';
import { platformDef } from './versions';

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** PowerShell that writes the INI and runs the deployment script. */
export function generatePowerShell(c: Config, mode: SecretMode = 'placeholder'): string {
  const ini = generateIni(c, { secrets: mode });
  const file = iniFileName(c);
  const script = platformScript(c);
  const def = platformDef(c.platform);
  const out: string[] = [
    `# UAGForge - UAG ${c.version} on ${def.label}`,
    `# Prerequisites: extract the uagdeploy scripts from the Omnissa Customer Connect download`,
    `# (${script} + uagdeploy.psm1)${c.platform === 'vsphere' ? ' and install OVF Tool 4.4.3 or later' : ''}.`,
    '',
    `# 1. Write the INI file`,
    `$ini = @'`,
    ini.trimEnd(),
    `'@`,
    `Set-Content -Path .\\${file} -Value $ini -Encoding ASCII`,
    ''
  ];
  if (mode === 'placeholder' && ini.includes('<REDACTED>')) out.push('# Replace every <REDACTED> value in the INI before deploying.', '');
  out.push(`# 2a. Interactive deployment (prompts for the root and admin passwords)`);
  out.push(c.platform === 'azure' ? `.\\${script} .\\${file}` : `.\\${script} -iniFile .\\${file}`, '');
  out.push(`# 2b. Non-interactive deployment`);
  out.push(`$rootPwd  = Read-Host 'UAG root password'  -AsSecureString`);
  out.push(`$adminPwd = Read-Host 'UAG admin password' -AsSecureString`);
  out.push(`$plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }`);
  if (def.nonInteractive === 'positional') {
    out.push(`.\\${script} .\\${file} (& $plain $rootPwd) (& $plain $adminPwd) no   # <ceip-yes-no> is the last argument`);
  } else {
    out.push(`.\\${script} -iniFile .\\${file} -rootPwd (& $plain $rootPwd) -adminPwd (& $plain $adminPwd)`);
  }
  out.push('');
  return out.join('\n');
}

/** PowerShell that pushes the settings JSON to the admin REST API of a running appliance. */
export function generateRestPowerShell(c: Config): string {
  const json = generateJson(c, { secrets: 'placeholder' });
  const file = jsonFileName(c);
  const mgmt = String(c.values.ip1 || c.values.ip0 || '<uag-management-ip>');
  return [
    `# Apply the settings JSON to a running UAG (admin API listens on 9443)`,
    `$json = @'`,
    json.trimEnd(),
    `'@`,
    `Set-Content -Path .\\${file} -Value $json -Encoding UTF8`,
    `$cred = Get-Credential admin`,
    `Invoke-RestMethod -Method Put -Uri ${psq(`https://${mgmt}:9443/rest/v1/config/settings`)} \``,
    `  -Credential $cred -ContentType 'application/json' -Body $json -SkipCertificateCheck`,
    ''
  ].join('\n');
}
