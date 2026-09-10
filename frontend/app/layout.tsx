import './globals.css';
import { Shell } from '../components/Shell';

export const metadata = { title: 'Inventário', description: 'Sistema interno de gestão patrimonial' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
