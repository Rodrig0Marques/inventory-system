import type { CSSProperties } from 'react';

export type IconName = 'box' | 'arrow' | 'arrow-left' | 'plus' | 'upload' | 'wallet' | 'check' | 'layers' | 'search' | 'chart' | 'shield' | 'refresh' | 'panel' | 'grid' | 'logout' | 'mail' | 'lock' | 'eye' | 'eye-off' | 'close' | 'chevron-down' | 'download' | 'list' | 'filter' | 'bookmark' | 'folder' | 'users' | 'clipboard' | 'history' | 'command' | 'alert' | 'calendar';

export function Icon({ name, style }: { name: IconName; style?: CSSProperties }) {
  const paths: Record<IconName, React.ReactNode> = {
    close: <path d="m6 6 12 12M6 18 18 6" />,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    list: <><path d="M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01" /></>,
    filter: <><path d="M4 7h16M7 12h10M10 17h4" /><circle cx="8" cy="7" r="2" fill="var(--surface)" /></>,
    bookmark: <path d="M6 4h12v17l-6-4-6 4V4Z" />,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    users: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M17 4a4 4 0 0 1 0 7m5 10v-2a5 5 0 0 0-3-4.6" /></>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3" /></>,
    history: <><path d="M3 4v5h5M3 9a9 9 0 1 1 1 9M12 7v5l3 2" /></>,
    command: <><path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z" /></>,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.01" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    'eye-off': <><path d="m3 3 18 18M10.6 5.1 12 5c6 0 10 7 10 7a20 20 0 0 1-3.1 3.9M6 6.5A23 23 0 0 0 2 12s4 7 10 7c1.8 0 3.5-.6 5-1.5M10 10a3 3 0 0 0 4 4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m4-11 3 3-3 3" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    logout: <><path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h13" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    'arrow-left': <path d="M19 12H5m5-5-5 5 5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 9h18m-5 5h5M6 5V3h11" /></>,
    check: <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="m8 12 3 3 5-6" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    chart: <><path d="M4 3v18h17M9 16v-4m5 4V7m5 9v-6" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg className="ui-icon" style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
