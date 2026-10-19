import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, Settings as Cog, Users } from 'lucide-react';
import { useDraft } from '@/hooks/use-draft';

const NAV = [
  { href: '/', label: 'Live draft', icon: Activity },
  { href: '/roster', label: 'Roster', icon: Users },
  { href: '/settings', label: 'Settings', icon: Cog },
];

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { state, saveError } = useDraft();
  return (
    <div className="min-h-[100dvh] pb-16 md:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2" data-testid="link-home">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary font-mono text-[11px] font-semibold text-primary-foreground">9</span>
            <span className="text-[15px] font-bold tracking-tight">9-Cat Draft Assistant</span>
          </Link>
          <nav className="ml-auto hidden gap-1 md:flex" aria-label="Primary">
            {NAV.map((n) => {
              const on = loc === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  data-testid={`link-nav-${n.label.toLowerCase().replace(' ', '-')}`}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${on ? 'bg-sidebar-accent font-semibold' : 'opacity-75 hover:opacity-100 hover:bg-sidebar-accent/60'}`}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <span
            data-testid="status-saved"
            className={`ml-auto font-mono text-[11px] md:ml-2 ${saveError ? 'text-[hsl(44_90%_65%)]' : 'opacity-70'}`}
          >
            {saveError ? 'Not saved' : 'Auto-saved'}
          </span>
          <Link href="/settings" className="font-mono text-[11px] underline opacity-80 hover:opacity-100" data-testid="link-backup-shell">Backup</Link>
        </div>
        {state.source.isDemo && (
          <div className="bg-[hsl(44_90%_60%)] px-4 py-1 text-center text-xs font-semibold text-[hsl(222_32%_13%)]" data-testid="banner-demo">
            Illustrative demo players. Not verified, not current rankings. Import real per-game projections in Settings before drafting.
          </div>
        )}
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-5">
        {saveError && <div role="alert" className="mb-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm" data-testid="text-save-error">{saveError}</div>}
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-sidebar-border bg-sidebar text-sidebar-foreground md:hidden" aria-label="Primary mobile">
        {NAV.map((n) => {
          const on = loc === n.href;
          return (
            <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} data-testid={`link-tab-${n.label.toLowerCase().replace(' ', '-')}`} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? 'font-semibold text-primary' : 'opacity-75'}`}>
              <n.icon className="h-5 w-5" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
