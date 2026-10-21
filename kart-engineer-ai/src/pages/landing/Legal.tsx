import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentMeta } from '@/components/ui';
import { SiteHeader } from './Landing';
import { Footer } from './Footer';

function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-900">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Link to="/" className="text-sm text-fg-muted hover:text-fg">← Voltar ao início</Link>
        <h1 className="mt-6 text-4xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-fg-dim">Última atualização: {updated}</p>
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-fg-muted [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function Privacy() {
  useDocumentMeta('Política de privacidade | Kart Engineer AI', 'Como o Kart Engineer AI trata seus dados: processamento e armazenamento locais no navegador.');
  return (
    <LegalPage title="Política de privacidade" updated="outubro de 2026">
      <section>
        <h2>1. Resumo</h2>
        <p>Nesta versão, o Kart Engineer AI processa e armazena seus dados localmente, no navegador do seu dispositivo. Não há cadastro, login, banco de dados remoto nem envio dos seus arquivos de telemetria ou vídeos para servidores do Kart Engineer AI.</p>
      </section>
      <section>
        <h2>2. Dados que você fornece</h2>
        <ul>
          <li>Arquivos de telemetria (CSV, GPX) e os dados derivados deles: tempos, velocidades, coordenadas GPS e demais canais.</li>
          <li>Nomes de sessões e pistas, notas, marcadores e traçados desenhados.</li>
          <li>Vídeos onboard: são reproduzidos a partir do arquivo local e não são copiados para o armazenamento do aplicativo; apenas o nome, o tamanho do arquivo e os marcadores são salvos.</li>
        </ul>
      </section>
      <section>
        <h2>3. Onde os dados ficam</h2>
        <p>Os dados são gravados no IndexedDB do navegador. Eles permanecem no dispositivo e podem ser perdidos se você limpar os dados de navegação, usar o modo privado, trocar de navegador ou de dispositivo. Use a exportação de backup em Configurações para guardar uma cópia.</p>
        <p>Coordenadas GPS podem revelar o local onde você treinou. Tenha isso em mente ao compartilhar backups ou relatórios exportados.</p>
      </section>
      <section>
        <h2>4. Serviços de terceiros</h2>
        <ul>
          <li>As fontes tipográficas são carregadas do Google Fonts, o que implica uma requisição do seu navegador aos servidores do Google.</li>
          <li>A hospedagem do site pode registrar dados técnicos de acesso (como endereço IP), conforme a política do provedor de hospedagem escolhido pelo operador.</li>
          <li>Não utilizamos cookies de rastreamento, ferramentas de analytics nem APIs pagas de inteligência artificial.</li>
        </ul>
      </section>
      <section>
        <h2>5. Integração opcional com modelo de linguagem</h2>
        <p>Se você configurar, em Configurações, o endereço de um servidor de modelo de linguagem, o aplicativo enviará a esse endereço somente o texto da resposta do engenheiro virtual (números já calculados e explicações), nunca os arquivos de telemetria. Esse servidor é escolhido e controlado por você; a privacidade nele depende da sua configuração.</p>
      </section>
      <section>
        <h2>6. Seus controles</h2>
        <ul>
          <li>Excluir sessões individualmente ou apagar todos os dados locais em Configurações.</li>
          <li>Exportar seus dados em JSON e CSV.</li>
        </ul>
      </section>
      <section>
        <h2>7. Mudanças</h2>
        <p>Se uma versão futura introduzir sincronização online ou contas de usuário, ela será opcional e esta política será atualizada para informar claramente onde os dados serão armazenados.</p>
      </section>
    </LegalPage>
  );
}

export function Terms() {
  useDocumentMeta('Termos de uso | Kart Engineer AI', 'Termos de uso do Kart Engineer AI.');
  return (
    <LegalPage title="Termos de uso" updated="outubro de 2026">
      <section>
        <h2>1. O serviço</h2>
        <p>O Kart Engineer AI é uma ferramenta de software para visualizar e analisar dados de telemetria de kart. As análises são calculadas a partir dos arquivos que você fornece.</p>
      </section>
      <section>
        <h2>2. Natureza das análises</h2>
        <ul>
          <li>Diagnósticos e recomendações são análises técnicas auxiliares. Eles não garantem redução de tempo de volta nem substituem a orientação de instrutores, engenheiros ou equipes.</li>
          <li>A precisão depende da qualidade, da taxa de amostragem e da calibração dos dados. Valores derivados ou estimados são identificados como tais.</li>
          <li>O sistema não detecta automaticamente todos os erros de pilotagem e não calcula uma trajetória matematicamente ideal.</li>
        </ul>
      </section>
      <section>
        <h2>3. Segurança</h2>
        <p>Automobilismo envolve riscos. Qualquer alteração de pilotagem deve ser testada de forma gradual, em condições controladas, respeitando as regras do kartódromo, os equipamentos de segurança e os seus limites. Você é o único responsável pela forma como utiliza as informações.</p>
      </section>
      <section>
        <h2>4. Seus dados</h2>
        <p>Os dados que você importa permanecem seus e ficam armazenados localmente no seu navegador, conforme a Política de privacidade. Você é responsável por manter cópias de segurança.</p>
      </section>
      <section>
        <h2>5. Dados demonstrativos</h2>
        <p>A sessão demonstrativa e os gráficos da página inicial usam dados sintéticos de uma pista fictícia. Eles não representam pilotos, pistas ou resultados reais.</p>
      </section>
      <section>
        <h2>6. Disponibilidade e custos</h2>
        <p>O uso dos recursos atuais não exige pagamento. Recursos futuros que dependam de infraestrutura (como sincronização online ou modelos hospedados) poderão ter condições próprias, que serão informadas antes da contratação.</p>
      </section>
      <section>
        <h2>7. Limitação de responsabilidade</h2>
        <p>O software é fornecido “no estado em que se encontra”, sem garantias de adequação a um propósito específico, na extensão permitida pela legislação aplicável.</p>
      </section>
    </LegalPage>
  );
}
