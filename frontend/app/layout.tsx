import './globals.css';
import './refinements.css';
import './workspace.css';
import { Shell } from '../components/Shell';

export const metadata = { title: { default: 'Inventário · Cia do Crédito', template: '%s · Inventário' }, description: 'Seu espaço de gestão de ativos, estoque e patrimônio da Cia do Crédito.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='inventory_theme';var s=localStorage.getItem(k);var t=s==='dark'||s==='light'?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`,
          }}
        />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
