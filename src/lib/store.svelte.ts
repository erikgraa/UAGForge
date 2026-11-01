import { defaultConfig, stripSecrets, applyPatch, type Config } from './model';
import { isSupportedVersion, DEFAULT_VERSION } from './versions';
import type { SectionId } from './schema';
import type { SecretMode } from './generate';

const DRAFT_KEY = 'gateway-forge.draft';
const THEME_KEY = 'gateway-forge.theme';

/** One-time move of values saved under the pre-rename "uagforge.*" and "uag-forge.*" keys. */
function migrateLegacyKeys(): void {
  try {
    for (const [from, to] of [['uagforge.draft', DRAFT_KEY], ['uagforge.theme', THEME_KEY], ['uag-forge.draft', DRAFT_KEY], ['uag-forge.theme', THEME_KEY]]) {
      const v = localStorage.getItem(from);
      if (v !== null) {
        if (localStorage.getItem(to) === null) localStorage.setItem(to, v);
        localStorage.removeItem(from);
      }
    }
  } catch {
    /* storage unavailable */
  }
}
migrateLegacyKeys();

export type OutputTab = 'ini' | 'json' | 'ps' | 'docs';

function loadDraft(): Config {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Config;
      const merged = applyPatch(defaultConfig(), { version: parsed.version, platform: parsed.platform, values: parsed.values });
      merged.wrp = (parsed.wrp ?? []).map((i) => ({ ...i }));
      merged.syslog = (parsed.syslog ?? []).map((i) => ({ ...i }));
      if (!isSupportedVersion(merged.version)) merged.version = DEFAULT_VERSION;
      return merged;
    }
  } catch {
    /* corrupt draft - start fresh */
  }
  return defaultConfig();
}

function initialTheme(): 'dark' | 'light' {
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'light' : 'dark';
}

class AppState {
  config = $state<Config>(loadDraft());
  section = $state<SectionId>('general');
  tab = $state<OutputTab>('ini');
  secretMode = $state<SecretMode>('placeholder');
  theme = $state<'dark' | 'light'>(initialTheme());
  focusField = $state<string | null>(null);
  showImport = $state(false);
  showPalette = $state(false);
  toast = $state<string | null>(null);

  setTheme(t: 'dark' | 'light', persist = true) {
    this.theme = t;
    document.documentElement.dataset.theme = t;
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {
        /* storage unavailable */
      }
    }
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  say(msg: string) {
    this.toast = msg;
    setTimeout(() => {
      if (this.toast === msg) this.toast = null;
    }, 3200);
  }

  goTo(section: SectionId, fieldId?: string) {
    this.section = section;
    this.focusField = fieldId ?? null;
    if (fieldId) {
      setTimeout(() => {
        const el = document.getElementById(`f-${fieldId}`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        (el as HTMLElement | null)?.focus?.();
      }, 60);
    }
  }

  saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(stripSecrets(this.config)));
    } catch {
      /* storage unavailable */
    }
  }

  clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    this.config = defaultConfig();
  }
}

export const app = new AppState();
