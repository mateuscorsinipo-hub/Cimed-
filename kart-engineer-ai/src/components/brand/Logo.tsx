import { Link } from 'react-router-dom';
import { cn } from '../ui';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-7 w-7', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#14171C" stroke="#323844" />
      <path d="M12 44 C 20 18, 34 16, 40 30 S 50 46, 54 20" fill="none" stroke="#C6F432" strokeWidth="6" strokeLinecap="round" />
      <circle cx="54" cy="20" r="4" fill="#F2F4F7" />
    </svg>
  );
}

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2.5', className)} aria-label="Kart Engineer AI — início">
      <LogoMark />
      <span className="font-display text-[17px] font-bold uppercase tracking-[0.06em]">
        Kart Engineer <span className="text-gain">AI</span>
      </span>
    </Link>
  );
}
