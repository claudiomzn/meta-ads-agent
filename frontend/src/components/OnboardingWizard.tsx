import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Rocket, Target, DollarSign, Sparkles, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const NICHES = [
  { id: 'clinica',     icon: '🏥', label: 'Clínica / Consultório' },
  { id: 'loja',        icon: '🛍️', label: 'Loja / E-commerce' },
  { id: 'escola',      icon: '🎓', label: 'Escola / Curso' },
  { id: 'academia',    icon: '💪', label: 'Academia / Personal' },
  { id: 'restaurante', icon: '🍽️', label: 'Restaurante / Delivery' },
  { id: 'imoveis',     icon: '🏠', label: 'Imóveis / Construtora' },
  { id: 'servicos',    icon: '🔧', label: 'Serviços / Prestador' },
  { id: 'outro',       icon: '💼', label: 'Outro negócio' },
];

const OBJECTIVES = [
  { id: 'leads',    icon: '📋', label: 'Captar leads / contatos', desc: 'Pessoas que se interessam e deixam o contato' },
  { id: 'vendas',   icon: '💳', label: 'Gerar vendas online',     desc: 'Vendas diretas pelo anúncio ou site' },
  { id: 'whatsapp', icon: '💬', label: 'Mensagens no WhatsApp',   desc: 'Clientes mandando mensagem direto pra você' },
  { id: 'alcance',  icon: '📣', label: 'Divulgar a marca',        desc: 'Mais pessoas conhecendo seu negócio' },
];

const BUDGETS = [
  { id: '500',  label: 'Até R$ 500/mês',       desc: 'Iniciante' },
  { id: '1500', label: 'R$ 500 a R$ 1.500',    desc: 'Intermediário' },
  { id: '3000', label: 'R$ 1.500 a R$ 3.000',  desc: 'Avançado' },
  { id: '5000', label: 'Acima de R$ 3.000',    desc: 'Profissional' },
];

interface Props {
  onDismiss: () => void;
}

export function OnboardingWizard({ onDismiss }: Props) {
  const navigate = useNavigate();
  const [step, setStep]           = useState(0);
  const [experience, setExp]      = useState('');   // 'beginner' | 'advanced'
  const [niche, setNiche]         = useState('');
  const [businessName, setBizName]= useState('');   // nome real do negócio
  const [objective, setObj]       = useState('');
  const [budget, setBudget]       = useState('');

  const steps = [
    {
      icon: HelpCircle,
      title: 'Você já anunciou no Facebook/Instagram antes?',
      sub: 'Isso nos ajuda a personalizar a experiência para você',
    },
    {
      icon: Target,
      title: 'Qual é o seu negócio?',
      sub: 'Vamos personalizar tudo para o seu setor',
    },
    {
      icon: Rocket,
      title: 'O que você quer com os anúncios?',
      sub: 'Escolha o objetivo principal',
    },
    {
      icon: DollarSign,
      title: 'Qual é seu orçamento mensal?',
      sub: 'Uma estimativa já é suficiente',
    },
    {
      icon: Sparkles,
      title: 'Pronto! Vamos criar sua primeira campanha',
      sub: 'A IA vai montar tudo para você com base nas suas respostas',
    },
  ];

  const canNext = [!!experience, !!niche, !!objective, !!budget, true][step];

  function handleCreate() {
    const nicheLabel = NICHES.find((n) => n.id === niche)?.label ?? niche;
    const objLabel   = OBJECTIVES.find((o) => o.id === objective)?.label ?? objective;

    // Salva modo do usuário para personalizar toda a experiência do app
    localStorage.setItem('metaAdsMode', experience);

    sessionStorage.setItem('onboardingContext', JSON.stringify({
      niche, nicheLabel,
      businessName: businessName.trim() || nicheLabel,
      objective, objLabel,
      budget, experience,
    }));
    navigate('/campaigns/new');
  }

  const stepInfo = steps[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-[#1877F2] transition-all duration-500"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-8 pt-8 pb-4 text-center">
          <div className="w-12 h-12 rounded-full bg-[#1877F2]/10 flex items-center justify-center mx-auto mb-3">
            <stepInfo.icon className="w-6 h-6 text-[#1877F2]" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">{stepInfo.title}</h2>
          <p className="text-sm text-gray-400 mt-1">{stepInfo.sub}</p>
        </div>

        {/* Content */}
        <div className="px-8 pb-6">

          {/* Step 0 — Experiência */}
          {step === 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setExp('beginner')}
                className={cn(
                  'w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all',
                  experience === 'beginner'
                    ? 'border-[#1877F2] bg-[#1877F2]/5'
                    : 'border-gray-200 hover:border-gray-300',
                )}
              >
                <span className="text-3xl">🙋</span>
                <div>
                  <p className={cn('text-sm font-semibold', experience === 'beginner' ? 'text-[#1877F2]' : 'text-gray-800')}>
                    Não, é minha primeira vez
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                    Vou usar linguagem simples, dicas e orientações passo a passo
                  </p>
                </div>
              </button>

              <button
                onClick={() => setExp('advanced')}
                className={cn(
                  'w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all',
                  experience === 'advanced'
                    ? 'border-[#1877F2] bg-[#1877F2]/5'
                    : 'border-gray-200 hover:border-gray-300',
                )}
              >
                <span className="text-3xl">🚀</span>
                <div>
                  <p className={cn('text-sm font-semibold', experience === 'advanced' ? 'text-[#1877F2]' : 'text-gray-800')}>
                    Sim, já tenho experiência
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                    Vou mostrar métricas técnicas e recursos avançados
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Step 1 — Nicho */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {NICHES.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setNiche(n.id)}
                    className={cn(
                      'flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all',
                      niche === n.id
                        ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2] font-semibold'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300',
                    )}
                  >
                    <span className="text-xl">{n.icon}</span>
                    <span className="text-sm">{n.label}</span>
                  </button>
                ))}
              </div>

              {/* Nome do negócio — aparece ao selecionar o nicho */}
              {niche && (
                <div className="space-y-1.5 pt-1">
                  <label className="text-sm font-medium text-gray-700">
                    Como chama o seu negócio? <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <Input
                    placeholder={`Ex: ${
                      niche === 'clinica'     ? 'Clínica São Paulo, Dr. Silva...' :
                      niche === 'loja'        ? 'Loja da Maria, Moda Feminina...' :
                      niche === 'escola'      ? 'Instituto Saber, Escola Futuro...' :
                      niche === 'academia'    ? 'Academia Fitness, Studio Personal...' :
                      niche === 'restaurante' ? 'Sabor Caseiro, Pizzaria Roma...' :
                      niche === 'imoveis'     ? 'Imobiliária Central, Construtora X...' :
                      niche === 'servicos'    ? 'Eletricista João, Advocacia Silva...' :
                      'Nome do seu negócio...'
                    }`}
                    value={businessName}
                    onChange={(e) => setBizName(e.target.value)}
                    className="text-sm"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400">
                    A IA vai usar o nome nos anúncios — deixa muito mais personalizado.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Objetivo */}
          {step === 2 && (
            <div className="space-y-2">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setObj(o.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all',
                    objective === o.id
                      ? 'border-[#1877F2] bg-[#1877F2]/5'
                      : 'border-gray-200 hover:border-gray-300',
                  )}
                >
                  <span className="text-2xl">{o.icon}</span>
                  <div>
                    <p className={cn('text-sm font-semibold', objective === o.id ? 'text-[#1877F2]' : 'text-gray-800')}>
                      {o.label}
                    </p>
                    <p className="text-xs text-gray-400">{o.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 3 — Orçamento */}
          {step === 3 && (
            <div className="grid grid-cols-2 gap-2">
              {BUDGETS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBudget(b.id)}
                  className={cn(
                    'p-4 rounded-xl border text-center transition-all',
                    budget === b.id
                      ? 'border-[#1877F2] bg-[#1877F2]/5'
                      : 'border-gray-200 hover:border-gray-300',
                  )}
                >
                  <p className={cn('text-sm font-bold', budget === b.id ? 'text-[#1877F2]' : 'text-gray-800')}>
                    {b.label}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{b.desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* Step 4 — Resumo */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 border p-4 space-y-2">
                <Row label="Experiência"  value={experience === 'beginner' ? '🙋 Iniciante' : '🚀 Experiente'} />
                <Row label="Negócio"      value={businessName.trim() || (NICHES.find((n) => n.id === niche)?.label ?? '')} />
                <Row label="Setor"        value={NICHES.find((n) => n.id === niche)?.label ?? ''} />
                <Row label="Objetivo"     value={OBJECTIVES.find((o) => o.id === objective)?.label ?? ''} />
                <Row label="Orçamento"    value={BUDGETS.find((b) => b.id === budget)?.label ?? ''} />
              </div>
              <div className="rounded-xl bg-[#1877F2]/5 border border-[#1877F2]/20 p-4">
                <p className="text-sm text-[#1877F2] font-semibold mb-1">✨ O que a IA vai fazer</p>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Com base nas suas respostas, o assistente vai sugerir a estrutura ideal de campanha,
                  segmentação de público e textos de anúncio. Você revisa e publica.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex items-center justify-between gap-3">
          <button
            onClick={step === 0 ? onDismiss : () => setStep((s) => s - 1)}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {step === 0 ? 'Pular por agora' : 'Voltar'}
          </button>

          {step < 4 ? (
            <Button
              variant="meta"
              disabled={!canNext}
              onClick={() => setStep((s) => s + 1)}
              className="flex items-center gap-2"
            >
              Continuar
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="meta"
              onClick={handleCreate}
              className="flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Criar minha primeira campanha
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}
