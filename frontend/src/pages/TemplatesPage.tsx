import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronRight } from 'lucide-react';

interface Template {
  id: string;
  icon: string;
  niche: string;
  name: string;
  description: string;
  objective: string;
  suggestedBudget: number;
  adSets: {
    name: string;
    targeting: string;
    optimizationGoal: string;
    ads: { name: string; headline: string; bodyText: string; cta: string }[];
  }[];
  tips: string[];
}

const TEMPLATES: Template[] = [
  {
    id: 'clinica',
    icon: '🏥',
    niche: 'Saúde',
    name: 'Clínica / Consultório',
    description: 'Captação de pacientes para consultas, exames ou procedimentos estéticos.',
    objective: 'LEAD_GENERATION',
    suggestedBudget: 1500,
    adSets: [
      {
        name: 'Público local — 25-55 anos',
        targeting: 'Pessoas dentro de 15km da clínica, 25-55 anos',
        optimizationGoal: 'LEAD_GENERATION',
        ads: [
          { name: 'Ad 1 — Dor + Solução', headline: 'Dores que atrapalham sua vida?', bodyText: 'Agende uma consulta hoje e descubra o tratamento ideal para você. Atendimento humanizado e resultados comprovados.', cta: 'SCHEDULE' },
          { name: 'Ad 2 — Urgência', headline: 'Vagas limitadas esta semana', bodyText: 'Nossa agenda está quase lotada. Garanta seu horário e venha cuidar da sua saúde com quem entende.', cta: 'BOOK_TRAVEL' },
        ],
      },
    ],
    tips: ['Use fotos reais da equipe — geram mais confiança', 'Destaque convênios aceitos no anúncio', 'Remarketing para quem visitou o site mas não agendou'],
  },
  {
    id: 'loja',
    icon: '🛍️',
    niche: 'Varejo',
    name: 'Loja / E-commerce',
    description: 'Geração de vendas online ou visitas à loja física.',
    objective: 'CONVERSIONS',
    suggestedBudget: 2000,
    adSets: [
      {
        name: 'Interesse em compras — 18-45 anos',
        targeting: 'Compradores online, interessados na categoria do produto',
        optimizationGoal: 'PURCHASES',
        ads: [
          { name: 'Ad 1 — Oferta', headline: 'Oferta especial por tempo limitado', bodyText: 'Produtos selecionados com até 30% de desconto. Aproveite antes que acabe!', cta: 'SHOP_NOW' },
          { name: 'Ad 2 — Benefício', headline: 'Entrega grátis + parcelamento', bodyText: 'Compre com segurança, receba em casa. Frete grátis em compras acima de R$ 150.', cta: 'SHOP_NOW' },
        ],
      },
    ],
    tips: ['Use carrossel para mostrar múltiplos produtos', 'Instale o Pixel do Meta no site para rastrear conversões', 'Teste vídeo de unboxing como criativo'],
  },
  {
    id: 'escola',
    icon: '🎓',
    niche: 'Educação',
    name: 'Escola / Curso Online',
    description: 'Captação de alunos para cursos, aulas particulares ou escolas.',
    objective: 'LEAD_GENERATION',
    suggestedBudget: 1000,
    adSets: [
      {
        name: 'Pais e responsáveis — 28-50 anos',
        targeting: 'Pais com filhos em idade escolar, interessados em educação',
        optimizationGoal: 'LEAD_GENERATION',
        ads: [
          { name: 'Ad 1 — Resultado', headline: 'Seu filho pode aprender mais rápido', bodyText: 'Método exclusivo que acelera o aprendizado. Vagas abertas para o próximo mês.', cta: 'LEARN_MORE' },
          { name: 'Ad 2 — Aula grátis', headline: 'Aula experimental gratuita', bodyText: 'Conheça nossa metodologia sem compromisso. Agende uma aula de demonstração hoje.', cta: 'SIGN_UP' },
        ],
      },
    ],
    tips: ['Depoimentos de alunos convertem muito bem', 'Ofereça uma aula grátis como isca', 'Segmente por bairros com escolas particulares'],
  },
  {
    id: 'academia',
    icon: '💪',
    niche: 'Fitness',
    name: 'Academia / Personal Trainer',
    description: 'Matrículas em academias, planos mensais ou sessões de personal.',
    objective: 'LEAD_GENERATION',
    suggestedBudget: 800,
    adSets: [
      {
        name: 'Fitness e saúde — 18-45 anos',
        targeting: 'Interessados em fitness, emagrecimento, musculação',
        optimizationGoal: 'LEAD_GENERATION',
        ads: [
          { name: 'Ad 1 — Transformação', headline: 'Transforme seu corpo em 90 dias', bodyText: 'Treino personalizado, acompanhamento nutricional e resultados reais. Primeira semana grátis!', cta: 'SIGN_UP' },
          { name: 'Ad 2 — Preço', headline: 'Academia completa por R$ X/mês', bodyText: 'Musculação, cardio e aulas coletivas. Venha conhecer sem compromisso.', cta: 'LEARN_MORE' },
        ],
      },
    ],
    tips: ['Antes e depois (com permissão) são os criativos que mais convertem', 'Promoção de início de ano / verão funciona muito bem', 'Geolocalização: raio de 5km da academia'],
  },
  {
    id: 'restaurante',
    icon: '🍽️',
    niche: 'Gastronomia',
    name: 'Restaurante / Delivery',
    description: 'Aumento de pedidos, reservas ou visitas ao restaurante.',
    objective: 'TRAFFIC',
    suggestedBudget: 600,
    adSets: [
      {
        name: 'Local — raio 8km',
        targeting: 'Pessoas próximas ao restaurante, interessadas em gastronomia',
        optimizationGoal: 'LINK_CLICKS',
        ads: [
          { name: 'Ad 1 — Prato destaque', headline: 'O melhor [prato] da cidade', bodyText: 'Venha provar! Ingredientes frescos, ambiente aconchegante e atendimento especial. Reserve já.', cta: 'BOOK_TRAVEL' },
          { name: 'Ad 2 — Delivery', headline: 'Sabor em casa sem sair do sofá', bodyText: 'Peça pelo iFood ou direto pelo WhatsApp. Entrega em 40 min na sua região.', cta: 'ORDER_NOW' },
        ],
      },
    ],
    tips: ['Fotos de comida com boa iluminação são fundamentais', 'Anúncie no horário do almoço e jantar', 'Promoção de segunda a quarta ajuda a preencher dias fracos'],
  },
  {
    id: 'imoveis',
    icon: '🏠',
    niche: 'Imóveis',
    name: 'Imóveis / Construtora',
    description: 'Geração de leads qualificados para compra, venda ou aluguel de imóveis.',
    objective: 'LEAD_GENERATION',
    suggestedBudget: 3000,
    adSets: [
      {
        name: 'Compradores potenciais — 28-55 anos',
        targeting: 'Interessados em imóveis, com renda compatível, na região de interesse',
        optimizationGoal: 'LEAD_GENERATION',
        ads: [
          { name: 'Ad 1 — Lançamento', headline: 'Apartamentos a partir de R$ X', bodyText: 'Localização privilegiada, infraestrutura completa. Condições especiais de lançamento. Fale com um consultor.', cta: 'LEARN_MORE' },
          { name: 'Ad 2 — Sonho', headline: 'A casa que você sempre sonhou', bodyText: 'Financiamento facilitado, entrada parcelada. Realize o sonho da casa própria este ano.', cta: 'CONTACT_US' },
        ],
      },
    ],
    tips: ['Vídeo tour do imóvel tem CTR muito maior', 'Segmente por interesse em financiamento imobiliário', 'Leads de imóveis demoram mais — tenha follow-up pronto'],
  },
  {
    id: 'servicos',
    icon: '🔧',
    niche: 'Serviços',
    name: 'Prestador de Serviços',
    description: 'Eletricista, encanador, advogado, contador, psicólogo e outros profissionais.',
    objective: 'LEAD_GENERATION',
    suggestedBudget: 500,
    adSets: [
      {
        name: 'Público local — problema específico',
        targeting: 'Moradores da região com necessidade do serviço',
        optimizationGoal: 'LEAD_GENERATION',
        ads: [
          { name: 'Ad 1 — Urgência', headline: 'Problema com [serviço]? Resolvemos hoje', bodyText: 'Atendimento rápido, orçamento grátis e garantia no serviço. Chame agora pelo WhatsApp.', cta: 'WHATSAPP_MESSAGE' },
          { name: 'Ad 2 — Confiança', headline: '10 anos de experiência na região', bodyText: '+500 clientes atendidos. Venha conhecer nosso trabalho. Primeiro orçamento sem compromisso.', cta: 'CONTACT_US' },
        ],
      },
    ],
    tips: ['WhatsApp como CTA é o que mais converte para serviços locais', 'Avaliações no Google fortalecem a credibilidade', 'Fotos de serviços executados aumentam confiança'],
  },
  {
    id: 'infoproduto',
    icon: '💻',
    niche: 'Digital',
    name: 'Infoproduto / Mentoria',
    description: 'Vendas de cursos digitais, mentorias, ebooks ou assinaturas.',
    objective: 'CONVERSIONS',
    suggestedBudget: 2500,
    adSets: [
      {
        name: 'Audiência quente — seguidores e engajados',
        targeting: 'Seguidores, visitantes do site, lista de e-mail',
        optimizationGoal: 'PURCHASES',
        ads: [
          { name: 'Ad 1 — Resultado', headline: 'De zero a [resultado] em [tempo]', bodyText: 'Método comprovado por +1.000 alunos. Aprenda no seu ritmo e tenha suporte direto. Vagas limitadas.', cta: 'LEARN_MORE' },
          { name: 'Ad 2 — Prova social', headline: 'Veja o que nossos alunos dizem', bodyText: 'Mais de 1.000 pessoas já transformaram sua vida com esse método. Você pode ser o próximo.', cta: 'SIGN_UP' },
        ],
      },
    ],
    tips: ['VSL (vídeo de vendas) converte muito mais que imagem', 'Crie um público lookalike dos seus compradores', 'Remarketing para quem assistiu o vídeo mas não comprou'],
  },
];

export default function TemplatesPage() {
  const navigate = useNavigate();

  function useTemplate(template: Template) {
    sessionStorage.setItem('templateData', JSON.stringify({
      name: `Campanha — ${template.niche}`,
      product: template.name,
      objective: template.objective,
      budget: template.suggestedBudget,
      adSets: template.adSets.map((as) => ({
        name: as.name,
        dailyBudget: Math.round(template.suggestedBudget / 30),
        targeting: { description: as.targeting },
        optimizationGoal: as.optimizationGoal,
        billingEvent: 'IMPRESSIONS',
        ads: as.ads.map((ad) => ({
          name: ad.name,
          headline: ad.headline,
          bodyText: ad.bodyText,
          ctaType: ad.cta,
          destinationUrl: '',
        })),
      })),
    }));
    navigate('/campaigns/new');
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Templates por Nicho</h1>
        <p className="text-muted-foreground mt-1">
          Escolha o mais próximo do seu negócio e crie uma campanha em minutos — estrutura, copies e segmentação já prontos.
        </p>
      </div>

      {/* Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => (
          <div
            key={t.id}
            className="bg-white rounded-2xl border hover:shadow-md transition-shadow overflow-hidden flex flex-col"
          >
            {/* Card header */}
            <div className="p-5 flex-1">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl">{t.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{t.name}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1877F2]/10 text-[#1877F2]">
                      {t.niche}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                </div>
              </div>

              {/* Estrutura */}
              <div className="space-y-2 mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">O que está incluso</p>
                {t.adSets.map((as, i) => (
                  <div key={i} className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-xs font-medium text-gray-700">{as.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{as.ads.length} anúncio(s) pronto(s)</p>
                  </div>
                ))}
              </div>

              {/* Orçamento sugerido */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>💰 Orçamento sugerido</span>
                <span className="font-semibold text-gray-800">
                  R$ {t.suggestedBudget.toLocaleString('pt-BR')}/mês
                </span>
              </div>

              {/* Tips */}
              <div className="mt-3 space-y-1">
                {t.tips.map((tip, i) => (
                  <p key={i} className="text-xs text-gray-400 flex gap-1.5">
                    <span className="text-[#1877F2] flex-shrink-0">•</span>
                    {tip}
                  </p>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="px-5 pb-5">
              <button
                onClick={() => useTemplate(t)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#1877F2] text-white text-sm font-semibold hover:bg-[#1465d8] transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                Usar este template
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
