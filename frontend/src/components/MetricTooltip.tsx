import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface Props {
  metric: keyof typeof DEFINITIONS;
  children: React.ReactNode;
}

const DEFINITIONS = {
  roas: {
    name: 'ROAS',
    full: 'Retorno sobre Investimento em Anúncios',
    explain: 'Para cada R$ 1 investido, quanto voltou em vendas. ROAS de 3x significa que você ganhou R$ 3 para cada R$ 1 gasto.',
    good: '≥ 3x é bom · ≥ 5x é excelente',
    bad: 'Abaixo de 2x merece atenção',
  },
  ctr: {
    name: 'CTR',
    full: 'Taxa de Cliques',
    explain: 'De 100 pessoas que viram seu anúncio, quantas clicaram. CTR de 2% significa 2 cliques a cada 100 visualizações.',
    good: '≥ 1,5% no Feed é bom',
    bad: 'Abaixo de 0,8% o criativo pode estar fraco',
  },
  cpl: {
    name: 'CPL',
    full: 'Custo por Lead',
    explain: 'Quanto você pagou para conseguir cada contato interessado. Quanto menor, melhor.',
    good: 'Depende do nicho — compare com o valor da venda',
    bad: 'CPL > 30% do ticket médio merece revisão',
  },
  cpc: {
    name: 'CPC',
    full: 'Custo por Clique',
    explain: 'Quanto você paga cada vez que alguém clica no seu anúncio.',
    good: 'Varia por nicho — R$ 1 a R$ 3 é comum',
    bad: 'Acima de R$ 5 revise segmentação ou copy',
  },
  frequencia: {
    name: 'Frequência',
    full: 'Frequência de Exibição',
    explain: 'Quantas vezes a mesma pessoa viu seu anúncio. Alta frequência significa que o público já conhece demais o anúncio.',
    good: 'Entre 1,5 e 3x é saudável',
    bad: 'Acima de 3,5x troque o criativo — as pessoas estão cansando',
  },
  impressoes: {
    name: 'Impressões',
    full: 'Impressões',
    explain: 'Quantas vezes seu anúncio foi exibido no total (contando repetições para a mesma pessoa).',
    good: 'Mais impressões = mais alcance',
    bad: 'Impressões altas com cliques baixos = criativo fraco',
  },
  cliques: {
    name: 'Cliques',
    full: 'Cliques no Anúncio',
    explain: 'Quantas vezes as pessoas clicaram no seu anúncio.',
    good: 'Compare com impressões para calcular o CTR',
    bad: 'Poucos cliques com muitas impressões = anúncio sem atração',
  },
  alcance: {
    name: 'Alcance',
    full: 'Alcance',
    explain: 'Quantas pessoas únicas viram seu anúncio (diferente de impressões, que conta repetições).',
    good: 'Alcance amplo com CTR bom = ótima campanha',
    bad: 'Alcance baixo pode indicar público muito restrito',
  },
  orcamento: {
    name: 'Orçamento Diário',
    full: 'Orçamento Diário',
    explain: 'Quanto você autoriza gastar por dia nesse conjunto de anúncios. O Meta pode gastar até 25% a mais em um dia, mas compensa nos outros.',
    good: 'Distribua o orçamento entre conjuntos diferentes',
    bad: 'Orçamento muito baixo limita o aprendizado da IA',
  },
};

export function MetricTooltip({ metric, children }: Props) {
  const [open, setOpen] = useState(false);
  const def = DEFINITIONS[metric];

  return (
    <span className="relative inline-flex items-center gap-1 group">
      {children}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-gray-300 hover:text-gray-500 transition-colors"
        title={`O que é ${def.name}?`}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-xl bg-gray-900 text-white p-3.5 shadow-xl text-left"
          style={{ fontSize: 12 }}
        >
          {/* Triângulo */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />

          <p className="font-bold text-white mb-0.5">{def.name} — {def.full}</p>
          <p className="text-gray-300 leading-relaxed mb-2">{def.explain}</p>
          <div className="space-y-1">
            <p className="text-green-400">✅ {def.good}</p>
            <p className="text-yellow-400">⚠️ {def.bad}</p>
          </div>
        </div>
      )}
    </span>
  );
}
