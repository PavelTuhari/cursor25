import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'SEO-платформа',
  description: 'Управление AI-продвижением сайтов и учётным контуром UNA.md',
};

const NAV = [
  { href: '/', label: 'Портфель сайтов' },
  { href: '/playbooks', label: 'Плейбуки' },
  { href: '/schedules', label: 'Расписания' },
  { href: '/runs', label: 'Сессии' },
  { href: '/approvals', label: 'Очередь утверждения' },
  { href: '/budget', label: 'Бюджет и документы' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              SEO-платформа
              <span>AI-продвижение + учёт UNA.md</span>
            </div>
            <nav className="nav">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
