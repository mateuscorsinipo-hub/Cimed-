import { Link } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';

export function Footer() {
  return (
    <footer className="border-t border-ink-700 bg-ink-950">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-muted">
            Engenheiro virtual de kart: análise de telemetria, comparação de voltas, vídeo onboard e traçado, com processamento local no navegador.
          </p>
        </div>
        <nav aria-label="Produto">
          <div className="label mb-3">Produto</div>
          <ul className="space-y-2 text-sm text-fg-muted">
            <li><Link to="/app" className="hover:text-fg">Plataforma</Link></li>
            <li><a href="/#funcionalidades" className="hover:text-fg">Funcionalidades</a></li>
            <li><a href="/#como-funciona" className="hover:text-fg">Como funciona</a></li>
            <li><a href="/#faq" className="hover:text-fg">FAQ</a></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <div className="label mb-3">Legal</div>
          <ul className="space-y-2 text-sm text-fg-muted">
            <li><Link to="/privacidade" className="hover:text-fg">Política de privacidade</Link></li>
            <li><Link to="/termos" className="hover:text-fg">Termos de uso</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-ink-700">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-fg-dim sm:px-6 md:flex-row md:justify-between">
          <p>As recomendações são análises técnicas auxiliares baseadas nos dados fornecidos e não garantem ganhos de performance. Pilote com segurança.</p>
          <p>© {new Date().getFullYear()} Kart Engineer AI</p>
        </div>
      </div>
    </footer>
  );
}
