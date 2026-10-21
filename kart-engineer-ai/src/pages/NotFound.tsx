import { Link } from 'react-router-dom';
import { useDocumentMeta } from '@/components/ui';

export default function NotFound({ inApp }: { inApp?: boolean }) {
  useDocumentMeta('Página não encontrada | Kart Engineer AI');
  return (
    <div className={inApp ? 'py-16 text-center' : 'flex min-h-screen flex-col items-center justify-center bg-ink-900 px-4 text-center'}>
      <div className="num text-6xl font-bold text-gain">404</div>
      <h1 className="mt-4 text-2xl font-bold">Página não encontrada</h1>
      <p className="mt-2 text-fg-muted">O endereço acessado não existe.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/" className="btn-secondary">Início</Link>
        <Link to="/app" className="btn-primary">Abrir o aplicativo</Link>
      </div>
    </div>
  );
}
