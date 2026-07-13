'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

// The five persistent tabs. The centre is a raised FAB (capture / add).
const tabs = [
  { href: '/', label: 'HOME', icon: 'home' },
  { href: '/plan', label: 'CALENDAR', icon: 'calendar_month' },
  { href: '/metrics', label: 'METRICS', icon: 'monitoring' },
  { href: '/profile', label: 'PROFILE', icon: 'person' },
];

// Full-screen flows have their own fixed footer (Save / Start), so the tab bar
// is hidden on them to match the mockups. /unlock is the pre-auth gate — no
// navigation exists yet.
const HIDE_ON = ['/checkin', '/inbody', '/plan/new', '/plan/', '/unlock'];

export default function BottomNav() {
  const path = usePathname();
  const router = useRouter();

  // /plan (list) keeps the bar; /plan/<id>, /plan/new lose it.
  const hidden =
    HIDE_ON.some((p) => path.startsWith(p)) && path !== '/plan';
  if (hidden) return null;

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href);

  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  return (
    <nav className="tabbar">
      {left.map((t) => (
        <Link key={t.href} href={t.href} className={isActive(t.href) ? 'active' : ''}>
          <span className={`tab-ico ${isActive(t.href) ? 'msr-fill' : 'msr'}`}>{t.icon}</span>
          <span className="tab-lbl">{t.label}</span>
        </Link>
      ))}
      <div className="fab-slot">
        <button
          className="fab"
          aria-label="Capture / add"
          onClick={() => router.push('/inbody')}
        >
          <span className="msr-fill">add</span>
        </button>
      </div>
      {right.map((t) => (
        <Link key={t.href} href={t.href} className={isActive(t.href) ? 'active' : ''}>
          <span className={`tab-ico ${isActive(t.href) ? 'msr-fill' : 'msr'}`}>{t.icon}</span>
          <span className="tab-lbl">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
