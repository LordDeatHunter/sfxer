export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'sfxer-theme';

function load(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = $state({ choice: load() });

/** Apply and remember a theme. `system` follows the OS via prefers-color-scheme in theme.css. */
export function setTheme(choice: ThemeChoice): void {
  theme.choice = choice;
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
}
