import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Cartilha da Primeira Comissão no TikTok Shop",
  description:
    "O passo a passo para sair do zero e receber sua primeira comissão no TikTok Shop.",
};

const problems = [
  "Sabe que o TikTok Shop paga comissão, mas não sabe exatamente como funciona o cadastro de afiliado",
  "Não sabe qual produto escolher para promover e tem medo de perder tempo com produto que não vende",
  "Não quer aparecer nos vídeos e acha que isso é obrigatório para ter resultado",
  "Já tentou, mas travou na hora de colocar o link de afiliado",
  "Vê outros criadores faturando, mas não sabe por onde replicar o mesmo método",
];

const thoughts = [
  "Se eu conseguisse só UMA venda, eu já ia acreditar que dá certo.",
  "Já assisti um monte de vídeo e continuo travada, não sei nem por onde começar.",
  "Eu só queria fazer uma venda pra saber que eu consigo, sabe?",
  "Tô cansada de ficar só no salário, queria ter uma renda extra de verdade.",
  "Vou ficar tentando sozinha, sem ninguém pra me dizer se tô fazendo certo.",
];

const modules = [
  ["01", "Como se cadastrar como afiliado TikTok Shop", "Passo a passo do cadastro, configuração do perfil e ativação do programa — do zero, sem surpresas", "R$47"],
  ["02", "Como escolher o produto certo para promover", "5 critérios simples para filtrar produtos com alto potencial de venda e comissão acima da média", "R$67"],
  ["03", "Como pedir amostra grátis de qualquer marca", "Como usar o sistema de colaboração aberta do TikTok Shop para receber produtos sem pagar nada", "R$47"],
  ["04", "Estrutura do vídeo que gera comissão", "O formato exato de vídeo que funciona: gancho, apresentação e CTA — sem aparecer na câmera se não quiser", "R$67"],
  ["05", "Como adicionar o link e rastrear as vendas", "Onde o link vai, como funciona o rastreamento de comissão e quando o dinheiro cai na sua conta", "R$37"],
  ["06", "O que fazer após postar para maximizar alcance", "As ações simples pós-publicação que aumentam o alcance orgânico e multiplicam as chances de conversão", "R$47"],
];

const audience = [
  "Você quer uma renda extra trabalhando de casa, no seu tempo",
  "Você já ouviu falar de TikTok Shop mas nunca conseguiu fazer a primeira venda",
  "Você não tem seguidores e acha que isso te impede de começar",
  "Você tem medo ou vergonha de aparecer nos vídeos",
  "Você já tentou sozinha, travou em alguma etapa e desistiu",
  "Você não quer gastar com anúncio antes de saber se funciona",
];

const faqs = [
  "Preciso aparecer nos vídeos para funcionar?",
  "Preciso de muitos seguidores para ser afiliado?",
  "Sou iniciante total. Funciona pra mim?",
  "Preciso gastar dinheiro com anúncios?",
  "Como recebo o acesso após a compra?",
  "Por que o preço é tão baixo se o conteúdo vale mais?",
];

function CTA({ label = "Quero minha primeira comissão" }: { label?: string }) {
  return <Link className={styles.cta} href="#oferta">{label}<span aria-hidden="true">→</span></Link>;
}

export default function PrimeiraComissaoPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroCopy}>
          <p className={styles.badge}>★ TikTok Shop · Afiliado · 2026</p>
          <h1>Sua primeira <em>comissão</em> no TikTok Shop</h1>
          <p className={styles.lead}>O passo a passo completo para qualquer pessoa — mesmo sem seguidores, sem aparecer na câmera e sem investir em anúncios — receber a primeira comissão no TikTok Shop em até 7 dias.</p>
          <div className={styles.checks}><span>✓ Sem aparecer</span><span>✓ Sem anúncios</span><span>✓ Do zero ao pagamento</span></div>
          <CTA />
          <p className={styles.priceLine}>De R$197 por apenas <strong>R$47</strong> · Acesso imediato</p>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.imageFrame}><Image src="/primeira-comissao-hero.png" alt="Mulher comemorando uma conquista pelo celular" fill priority sizes="(max-width: 840px) 92vw, 42vw" /></div>
          <div className={styles.notification}><span>✓</span><div><small>Primeira comissão</small><strong>Você começou.</strong></div></div>
        </div>
      </section>

      <section className={styles.darkSection}>
        <div className={styles.sectionHead}><p className={styles.kicker}>Você se identifica?</p><h2>Por que sua primeira comissão ainda não chegou</h2><p>A maioria das pessoas trava antes mesmo de começar. Não por falta de vontade… por falta de direção.</p></div>
        <div className={styles.problemGrid}>{problems.map((item, index) => <article key={item}><span>0{index + 1}</span><p>{item}</p></article>)}</div>
      </section>

      <section className={styles.thoughtSection}>
        <div className={styles.sectionHead}><p className={styles.kicker}>A gente sabe o que passa na sua cabeça</p><h2>Você já pensou isso hoje?</h2></div>
        <div className={styles.quotes}>{thoughts.map((thought, index) => <blockquote key={thought} className={index === 2 ? styles.featuredQuote : ""}>“{thought}”</blockquote>)}</div>
        <p className={styles.centerCopy}>Se você se identificou com pelo menos uma dessas frases, não é falta de capacidade. É falta de um caminho claro. E é exatamente isso que você vai ter a partir daqui.</p>
      </section>

      <section className={styles.stepsSection}>
        <div className={styles.sectionHead}><p className={styles.kicker}>Como funciona</p><h2>Três passos. Só isso.</h2><p>A cartilha foi feita para quem quer resultado rápido, não mais um curso de 40 horas que nunca termina.</p></div>
        <div className={styles.steps}>
          <article><b>1</b><h3>Acesse a cartilha agora</h3><p>Após a compra, você recebe acesso imediato por email. Abra, leia e já comece a aplicar. Leva menos de 1 hora para percorrer todo o material.</p></article>
          <article><b>2</b><h3>Siga o passo a passo na ordem</h3><p>Do cadastro de afiliado até o primeiro vídeo publicado, cada etapa está descrita de forma clara. Sem jargão, sem conhecimento prévio.</p></article>
          <article><b>3</b><h3>Poste e acompanhe</h3><p>Com o conteúdo publicado e o link de afiliado ativo, é só acompanhar. A primeira notificação de comissão é uma questão de tempo.</p></article>
        </div>
      </section>

      <section className={styles.modulesSection}>
        <div className={styles.sectionHead}><p className={styles.kicker}>O que está dentro</p><h2>Tudo que você precisa.<br />Nada que você não precisa.</h2></div>
        <div className={styles.modules}>{modules.map(([number, title, text, value]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div><strong>{value}</strong></article>)}</div>
        <div className={styles.bonuses}><p>+ Bônus incluídos</p><article><span>🎁</span><div><strong>Checklist da Primeira Comissão</strong><small>Valor: R$27</small></div></article><article><span>🎁</span><div><strong>Script de Vídeo Pronto, só adaptar</strong><small>Valor: R$37</small></div></article></div>
      </section>

      <section className={styles.audienceSection}>
        <div><p className={styles.kicker}>É pra você?</p><h2>A cartilha é pra você se:</h2></div>
        <div className={styles.audienceList}>{audience.map(item => <p key={item}><span>✓</span>{item}</p>)}</div>
        <p className={styles.audienceClose}>Se você se identificou com pelo menos 2 desses pontos, a Cartilha da Primeira Comissão foi feita pra você.</p>
      </section>

      <section className={styles.offerSection} id="oferta">
        <div className={styles.offerIntro}><p className={styles.kicker}>Investimento</p><h2>Menos do que uma comissão.</h2><p>Um caminho claro, do cadastro ao primeiro conteúdo publicado.</p></div>
        <div className={styles.offerCard}>
          <div className={styles.offerTop}><span>Acesso completo</span><span>Pagamento único</span></div>
          <ul><li><span>Cartilha completa (6 módulos)</span><b>R$312</b></li><li><span>Checklist da Primeira Comissão</span><b>R$27</b></li><li><span>Script de Vídeo Pronto</span><b>R$37</b></li></ul>
          <div className={styles.total}><span>Valor total</span><s>R$376</s></div>
          <div className={styles.today}><span>Hoje, por apenas</span><strong><small>R$</small>47</strong></div>
          <div className={styles.includes}><span>✓ 6 módulos</span><span>✓ 2 bônus</span><span>✓ Acesso vitalício + atualizações</span></div>
          <CTA label="Garantir acesso por R$47" />
          <div className={styles.guarantee}><span>🛡️</span><p><strong>7 dias de garantia incondicional</strong>Se por qualquer motivo você não ficar satisfeita, devolvo 100% do seu dinheiro. Sem questionamentos, sem burocracia. O risco é todo meu.</p></div>
        </div>
      </section>

      <section className={styles.truthSection}>
        <p className={styles.kicker}>Antes de fechar essa aba</p><h2>Me responde só a verdade.</h2><p className={styles.truthQuestion}>Quantas comissões você recebeu esse mês tentando sozinha, sem um passo a passo?</p><strong>Nenhuma, né?</strong><p>E se você continuar do jeito que está — sem cadastro certo, sem saber qual produto escolher, sem saber onde colocar o link — daqui a 30 dias você vai estar exatamente no mesmo lugar. Só que 30 dias mais frustrada.</p><p>A diferença entre quem já recebeu a primeira comissão e quem ainda não recebeu não é sorte, nem seguidor, nem aparecer na câmera. É ter o passo a passo certo, na ordem certa.</p>
      </section>

      <section className={styles.mentorSection}>
        <div><p className={styles.kicker}>Quem te ensina isso</p><h2>Quem já colocou mais de 6 mil pessoas pra vender com a internet</h2></div>
        <div className={styles.mentorCopy}><p>Meu nome é <strong>Patrícia Passos</strong>, especialista em TikTok Shop.</p><p>Já ajudei mais de 6.000 pessoas a construir renda pelo celular. E hoje posso afirmar: com TikTok Shop, você não precisa de tráfego pago, nem de ferramentas complexas, nem de computador. Só celular e TikTok instalado.</p><div className={styles.results}><p><strong>63 anos</strong>Pessoas como a Dona Eldimara, que hoje faz em média R$2.500 por mês.</p><p><strong>R$1.900</strong>Ou a Jackeline, que em um único dia vendeu R$1.900.</p></div><p>Hoje marcas me procuram pra fechar parceria comigo e com meus alunos, porque o mercado sabe quem entende desse jogo.</p><p><strong>Se elas conseguiram sair do zero até a primeira comissão, você também consegue.</strong></p></div>
      </section>

      <section className={styles.faqSection}><div className={styles.sectionHead}><p className={styles.kicker}>Dúvidas frequentes</p><h2>O que você precisa saber</h2></div><div className={styles.faqs}>{faqs.map((faq, index) => <div key={faq}><span>0{index + 1}</span><p>{faq}</p></div>)}</div></section>

      <section className={styles.finalSection}><p className={styles.kicker}>Seu próximo passo</p><h2>Sua primeira comissão começa agora.</h2><p>Acesso imediato. Passo a passo completo. Garantia de 7 dias. Não tem desculpa — só decisão.</p><CTA label="Garantir acesso por R$47" /><small>De R$197 por apenas R$47 · 7 dias de garantia · Acesso imediato</small></section>
    </main>
  );
}
