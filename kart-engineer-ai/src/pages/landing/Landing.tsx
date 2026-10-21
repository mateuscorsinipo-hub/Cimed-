import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight, BarChart3, BrainCircuit, Cpu, Crosshair, FileUp, FlaskConical, GitCompareArrows, HelpCircle, Map, Menu,
  MousePointerClick, Repeat, Route, ShieldCheck, Video, X,
} from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Accordion, cn, useDocumentMeta } from '@/components/ui';
import { HeroVisual } from './HeroVisual';
import { InteractiveDemo } from './InteractiveDemo';
import { EngineerExample } from './EngineerExample';
import { Footer } from './Footer';

const LINKS = [
  { href: '#plataforma', label: 'Plataforma' },
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#faq', label: 'FAQ' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const onHome = useLocation().pathname === '/';
  const href = (h: string) => (onHome ? h : `/${h}`);
  return (
    <header className={cn('sticky top-0 z-40 border-b transition-colors', scrolled || open ? 'border-ink-700 bg-ink-900/90 backdrop-blur' : 'border-transparent')}>
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3.5 sm:px-6">
        <Logo />
        <nav aria-label="Seções" className="ml-6 hidden items-center gap-6 text-sm text-fg-muted md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={href(l.href)} className="transition-colors hover:text-fg">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a href={href('#plataforma')} className="btn-secondary">
            Explorar plataforma
          </a>
          <Link to="/app" className="btn-primary">
            Começar gratuitamente
          </Link>
        </div>
        <button className="btn-ghost ml-auto md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Fechar menu' : 'Abrir menu'}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Seções" className="border-t border-ink-700 px-4 pb-5 pt-2 md:hidden">
          {LINKS.map((l) => (
            <a key={l.href} href={href(l.href)} onClick={() => setOpen(false)} className="block border-b border-ink-700/60 py-3 text-base text-fg-muted hover:text-fg">
              {l.label}
            </a>
          ))}
          <div className="mt-4 grid gap-2">
            <a href={href('#plataforma')} onClick={() => setOpen(false)} className="btn-secondary">
              Explorar plataforma
            </a>
            <Link to="/app" className="btn-primary">
              Começar gratuitamente
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

function SectionTitle({ eyebrow, title, children, center }: { eyebrow: string; title: string; children?: React.ReactNode; center?: boolean }) {
  return (
    <div className={cn('mb-10 max-w-3xl', center && 'mx-auto text-center')}>
      <div className="label mb-3 text-gain">{eyebrow}</div>
      <h2 className="text-3xl font-bold leading-[1.1] sm:text-[42px]">{title}</h2>
      {children && <p className="mt-4 text-base leading-relaxed text-fg-muted sm:text-lg">{children}</p>}
    </div>
  );
}

const FEATURES = [
  {
    icon: BarChart3,
    title: 'Análise de telemetria',
    text: 'Compare velocidades, tempos, acelerações e segmentos da pista. Identifique oportunidades de melhoria a partir dos dados disponíveis.',
    to: '/app/analise',
    cta: 'Importar telemetria',
  },
  {
    icon: GitCompareArrows,
    title: 'Comparação de voltas',
    text: 'Coloque duas voltas lado a lado e identifique em quais segmentos cada uma ganha ou perde tempo.',
    to: '/app/comparar',
    cta: 'Comparar voltas',
  },
  {
    icon: Video,
    title: 'Análise de onboard',
    text: 'Assista ao vídeo da pilotagem, marque pontos importantes e sincronize a imagem com os gráficos de telemetria quando os dados permitirem.',
    to: '/app/onboard',
    cta: 'Abrir player onboard',
  },
  {
    icon: Map,
    title: 'Mapa e traçado',
    text: 'Visualize o percurso, identifique curvas e compare trajetórias registradas ou desenhadas manualmente.',
    to: '/app/tracado',
    cta: 'Ver traçado',
  },
];

const STEPS = [
  { icon: FileUp, title: 'Importe seus dados', text: 'Envie arquivos de telemetria compatíveis ou prepare uma sessão com dados disponíveis.' },
  { icon: GitCompareArrows, title: 'Compare suas voltas', text: 'Selecione uma volta de referência e compare os segmentos de outras voltas.' },
  { icon: Crosshair, title: 'Identifique oportunidades', text: 'Observe diferenças de velocidade, tempos, trajetórias e pontos que merecem investigação.' },
  { icon: Repeat, title: 'Teste e evolua', text: 'Experimente ajustes de pilotagem de forma controlada e compare os resultados em novas sessões.' },
];

export const FAQ = [
  {
    q: 'Preciso de um equipamento profissional de telemetria?',
    a: 'Não necessariamente. A plataforma trabalha com arquivos CSV e GPX de diferentes fontes — registradores dedicados, receptores GPS ou aplicativos que exportem esses formatos. A disponibilidade das análises depende dos dados fornecidos: sem GPS não há mapa; sem canal de acelerador, o momento de aceleração não é medido.',
  },
  {
    q: 'Posso analisar vídeos onboard?',
    a: 'Sim. A versão atual permite reprodução local, controle de velocidade, avanço quadro a quadro, marcação manual de entrada, ápice e saída, notas e sincronização do vídeo com a telemetria a partir de pontos de referência que você define. Não há análise automática de imagem nesta versão.',
  },
  {
    q: 'Consigo descobrir onde perco tempo?',
    a: 'É possível identificar diferenças entre voltas quando existem dados comparáveis. A plataforma alinha as voltas por distância e calcula a diferença de tempo acumulada e por segmento. A precisão depende da qualidade dos arquivos, da taxa de amostragem e do alinhamento das voltas.',
  },
  {
    q: 'O sistema mostra o traçado ideal?',
    a: 'O sistema compara trajetórias reais, mede desvios laterais e permite desenhar uma linha de referência manual. Uma trajetória matematicamente ideal exige dados e um modelo físico adequados — por isso ela não é prometida. As sugestões de trajetória são apresentadas como hipóteses para testar.',
  },
  {
    q: 'Preciso pagar por uma API de inteligência artificial?',
    a: 'Não. O núcleo usa processamento próprio, cálculos determinísticos e bibliotecas gratuitas, executados no seu navegador. Há uma integração opcional, desativada por padrão, para um modelo open source executado em infraestrutura própria — apenas para reescrever explicações, nunca para calcular.',
  },
  {
    q: 'Funciona no celular?',
    a: 'A interface é responsiva e funciona em celulares e tablets. O desempenho com vídeos e arquivos grandes depende do dispositivo; para sessões longas, um computador oferece uma experiência melhor.',
  },
  {
    q: 'Meus dados são armazenados onde?',
    a: 'No próprio navegador, no seu dispositivo (IndexedDB). Nenhum arquivo é enviado a servidores. Isso também significa que os dados podem ser perdidos se você limpar os dados do navegador ou usar outro dispositivo — exporte backups pela tela de Configurações.',
  },
];

export default function Landing() {
  useDocumentMeta(
    'Kart Engineer AI | Telemetria e análise de performance para kart',
    'Compare voltas, visualize telemetria, analise vídeos onboard e descubra oportunidades para melhorar sua pilotagem de kart.',
  );
  return (
    <div className="min-h-screen bg-ink-900">
      <SiteHeader />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:pb-28 lg:pt-16">
            <div className="animate-fadeUp">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1 text-xs text-fg-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-gain" /> Engenharia de performance para kart
              </div>
              <h1 className="text-[44px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
                Pilote melhor.
                <br />
                <span className="text-gain">Entenda cada décimo.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
                Transforme suas voltas em dados, seus dados em decisões e suas decisões em performance. Analise telemetria, compare voltas e descubra onde você pode evoluir no kart.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/app/analise" className="btn-primary px-5 py-3 text-base">
                  Analisar minha telemetria <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#plataforma" className="btn-secondary px-5 py-3 text-base">
                  Conhecer a plataforma
                </a>
              </div>
              <p className="mt-5 flex items-center gap-2 text-xs text-fg-dim">
                <Cpu className="h-3.5 w-3.5" /> Ferramentas de análise com processamento local e sem necessidade de APIs de IA pagas.
              </p>
            </div>
            <div className="animate-fadeUp [animation-delay:150ms]">
              <HeroVisual />
            </div>
          </div>
        </section>

        {/* PROBLEMA */}
        <section className="border-t border-ink-700 bg-ink-950 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="O problema" title="Você sente que pode andar mais rápido. Mas onde está perdendo tempo?">
              Uma volta pode parecer boa e ainda esconder oportunidades de melhoria. Uma entrada de curva diferente, uma saída menos eficiente ou uma perda de velocidade podem fazer diferença no tempo final. Sem comparar os dados, é difícil identificar exatamente onde investigar.
            </SectionTitle>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { icon: Crosshair, t: 'Não saber em qual curva concentrar os esforços.' },
                { icon: GitCompareArrows, t: 'Não conseguir comparar objetivamente duas voltas.' },
                { icon: BrainCircuit, t: 'Depender apenas da memória e da percepção para avaliar a pilotagem.' },
              ].map(({ icon: Icon, t }, i) => (
                <div key={t} className="panel p-6">
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-loss" aria-hidden />
                    <span className="num text-xs text-fg-dim">0{i + 1}</span>
                  </div>
                  <p className="mt-5 text-lg font-medium leading-snug">{t}</p>
                </div>
              ))}
            </div>
            <p className="mt-10 font-display text-2xl font-semibold text-gain">É aqui que a análise de telemetria entra.</p>
          </div>
        </section>

        {/* FUNCIONALIDADES */}
        <section id="funcionalidades" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Funcionalidades" title="Tudo o que você precisa para entender suas voltas." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, text, to, cta }) => (
                <Link key={title} to={to} className="panel group flex flex-col p-6 transition-all hover:-translate-y-0.5 hover:border-gain/50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-500 bg-ink-800 text-gain transition-colors group-hover:bg-gain group-hover:text-ink-950">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{text}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gain">
                    {cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* DEMONSTRAÇÃO */}
        <section id="plataforma" className="scroll-mt-20 border-y border-ink-700 bg-ink-950 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Demonstração interativa" title="Veja o que os dados podem revelar.">
              Duas voltas sintéticas num circuito fictício. Selecione um segmento, passe o cursor pelos gráficos ou clique no mapa. Os cálculos são os mesmos usados no aplicativo.
            </SectionTitle>
            <InteractiveDemo />
          </div>
        </section>

        {/* COMO FUNCIONA */}
        <section id="como-funciona" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Como funciona" title="Da pista à análise em quatro etapas." />
            <ol className="relative grid gap-4 md:grid-cols-4">
              <div className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-gain/60 via-ink-500 to-transparent md:block" aria-hidden />
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="relative flex gap-4 md:block">
                  <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-ink-500 bg-ink-900 text-gain">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="md:mt-5">
                    <div className="num text-xs text-fg-dim">Etapa {i + 1}</div>
                    <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ENGENHEIRO */}
        <section className="border-y border-ink-700 bg-ink-950 py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <SectionTitle eyebrow="Engenheiro virtual" title="Uma análise técnica para cada sessão.">
                O Kart Engineer AI transforma medições em informações compreensíveis. Em vez de mostrar apenas gráficos, organiza os dados e destaca os segmentos que merecem atenção.
              </SectionTitle>
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Evidência observada', 'Os números medidos ou calculados que sustentam o diagnóstico.'],
                  ['Interpretação', 'O que as diferenças indicam, sem extrapolar os dados.'],
                  ['Hipótese técnica', 'Possíveis causas, sempre declaradas como hipóteses.'],
                  ['Teste recomendado', 'Uma mudança por vez, gradual, para confirmar na próxima sessão.'],
                  ['Confiança da análise', 'Alta, média ou baixa, com o motivo explicado.'],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gain" aria-hidden />
                    <div>
                      <div className="font-semibold">{t}</div>
                      <div className="text-sm text-fg-muted">{d}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs text-fg-dim">O sistema não detecta automaticamente todos os erros de pilotagem. Ele aponta diferenças mensuráveis e sugere o que investigar.</p>
            </div>
            <EngineerExample />
          </div>
        </section>

        {/* ACESSO */}
        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="panel grid-bg relative overflow-hidden px-6 py-12 sm:px-12">
              <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
                <div>
                  <h2 className="text-3xl font-bold sm:text-4xl">Comece analisando suas próprias voltas.</h2>
                  <p className="mt-3 max-w-xl text-fg-muted">Explore as ferramentas disponíveis e descubra como seus dados podem ajudar na evolução da pilotagem.</p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link to="/app" className="btn-primary px-5 py-3 text-base">
                      Começar gratuitamente <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <p className="mt-4 text-xs text-fg-dim">Sem cadastro e sem cartão. Os recursos atuais funcionam no seu navegador; recursos futuros que dependam de infraestrutura poderão ter condições próprias.</p>
                </div>
                <ul className="space-y-3 text-sm">
                  {[
                    [MousePointerClick, 'Sessão demonstrativa para explorar antes de importar'],
                    [Route, 'CSV e GPX com assistente de colunas e unidades'],
                    [FlaskConical, 'Cálculos determinísticos, testados e explicáveis'],
                    [HelpCircle, 'Diagnósticos com evidências, confiança e limitações'],
                  ].map(([Icon, t]) => {
                    const I = Icon as typeof Route;
                    return (
                      <li key={t as string} className="flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-900/80 px-4 py-3">
                        <I className="h-4 w-4 text-gain" aria-hidden /> {t as string}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-ink-700 bg-ink-950 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionTitle eyebrow="FAQ" title="Perguntas frequentes" center />
            <Accordion items={FAQ} />
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="relative overflow-hidden py-24">
          <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full opacity-40" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden>
            <path d="M0 120 C 200 120, 260 40, 420 50 S 640 140, 800 110 S 1040 30, 1200 60" fill="none" stroke="#C6F432" strokeWidth="1.5" />
            <path d="M0 132 C 210 128, 270 62, 420 70 S 650 150, 800 128 S 1040 52, 1200 80" fill="none" stroke="#4DA3FF" strokeWidth="1" strokeDasharray="4 4" />
          </svg>
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="text-4xl font-bold leading-tight sm:text-5xl">Sua próxima volta começa com uma análise melhor.</h2>
            <p className="mt-4 text-lg text-fg-muted">Entenda o que aconteceu na pista. Identifique oportunidades. Teste sua evolução.</p>
            <Link to="/app" className="btn-primary mt-8 px-6 py-3.5 text-base">
              Analisar minhas voltas <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
