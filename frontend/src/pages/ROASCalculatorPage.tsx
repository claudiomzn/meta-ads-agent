import { useState, useMemo } from 'react';
import { Calculator, TrendingUp, DollarSign, Users, Target, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatCurrency } from '@/lib/utils';

function Slider({ label, value, onChange, min, max, step, prefix, suffix, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
          <Input
            type="number"
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-7 w-28 text-right text-sm"
            min={min}
            max={max}
            step={step}
          />
          {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#1877F2]"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{prefix}{min.toLocaleString('pt-BR')}{suffix}</span>
        <span>{prefix}{max.toLocaleString('pt-BR')}{suffix}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground italic">{hint}</p>}
    </div>
  );
}

function ResultCard({ label, value, sub, icon: Icon, color }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'yellow' | 'purple';
}) {
  const colors = {
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };
  return (
    <div className={cn('rounded-xl border p-4 space-y-1', colors[color])}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-70">{sub}</p>}
    </div>
  );
}

function roasLabel(roas: number) {
  if (roas >= 5)   return { text: 'Excelente', color: 'text-green-600' };
  if (roas >= 3)   return { text: 'Bom', color: 'text-blue-600' };
  if (roas >= 1.5) return { text: 'Razoável', color: 'text-yellow-600' };
  return             { text: 'Abaixo do ideal', color: 'text-red-600' };
}

export default function ROASCalculatorPage() {
  const [orcamento,   setOrcamento]   = useState(3000);
  const [ticket,      setTicket]      = useState(500);
  const [conversao,   setConversao]   = useState(10);   // %
  const [cplHistorico, setCplHistorico] = useState(80);

  const calc = useMemo(() => {
    const leads         = cplHistorico > 0 ? orcamento / cplHistorico : 0;
    const conversoes    = leads * (conversao / 100);
    const faturamento   = conversoes * ticket;
    const roas          = orcamento > 0 ? faturamento / orcamento : 0;
    const custoPorVenda = conversoes > 0 ? orcamento / conversoes : 0;
    const lucroLiquido  = faturamento - orcamento;
    return { leads, conversoes, faturamento, roas, custoPorVenda, lucroLiquido };
  }, [orcamento, ticket, conversao, cplHistorico]);

  // Quanto investir para atingir uma meta de faturamento
  const [metaFaturamento, setMetaFaturamento] = useState(20000);
  const investimentoNecessario = useMemo(() => {
    if (calc.roas <= 0) return 0;
    return metaFaturamento / calc.roas;
  }, [metaFaturamento, calc.roas]);

  const rl = roasLabel(calc.roas);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="h-6 w-6 text-[#1877F2]" />
          Calculadora de ROAS
        </h1>
        <p className="text-muted-foreground mt-1">
          Projete seu retorno antes de investir. Ajuste os sliders com os dados históricos da sua conta.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">

        {/* Inputs */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Parâmetros da campanha</CardTitle>
              <CardDescription>Use médias históricas para maior precisão</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Slider
                label="Orçamento mensal"
                value={orcamento}
                onChange={setOrcamento}
                min={500} max={50000} step={500}
                prefix="R$ "
                hint="Valor total que pretende investir no mês"
              />
              <Slider
                label="Ticket médio do plano"
                value={ticket}
                onChange={setTicket}
                min={50} max={5000} step={50}
                prefix="R$ "
                hint="Valor médio de cada venda fechada"
              />
              <Slider
                label="Taxa de conversão lead → venda"
                value={conversao}
                onChange={setConversao}
                min={1} max={50} step={1}
                suffix="%"
                hint="Ex: de cada 10 leads, quantos você fecha?"
              />
              <Slider
                label="CPL histórico médio"
                value={cplHistorico}
                onChange={setCplHistorico}
                min={10} max={500} step={10}
                prefix="R$ "
                hint="Custo médio por lead das campanhas anteriores"
              />
            </CardContent>
          </Card>

          {/* Meta de faturamento */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Qual é sua meta de faturamento?</CardTitle>
              <CardDescription>Calculamos o investimento necessário para atingi-la</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Slider
                label="Meta de faturamento no mês"
                value={metaFaturamento}
                onChange={setMetaFaturamento}
                min={5000} max={200000} step={5000}
                prefix="R$ "
              />
              <div className={cn(
                'rounded-lg border px-4 py-3 text-sm',
                investimentoNecessario <= orcamento
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-yellow-200 bg-yellow-50 text-yellow-800',
              )}>
                {calc.roas <= 0 ? (
                  <span>Ajuste os parâmetros para calcular.</span>
                ) : investimentoNecessario <= orcamento ? (
                  <span>
                    ✅ Com o orçamento de <strong>{formatCurrency(orcamento)}</strong>, você deve atingir{' '}
                    <strong>{formatCurrency(metaFaturamento)}</strong> com folga.
                  </span>
                ) : (
                  <span>
                    Para faturar <strong>{formatCurrency(metaFaturamento)}</strong> você precisaria investir{' '}
                    <strong>{formatCurrency(investimentoNecessario)}</strong> —{' '}
                    {formatCurrency(investimentoNecessario - orcamento)} a mais que o orçamento atual.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Resultados */}
        <div className="space-y-4">
          {/* ROAS em destaque */}
          <Card className="border-2 border-[#1877F2]">
            <CardContent className="pt-6 text-center space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">ROAS Projetado</p>
              <p className="text-6xl font-black text-[#1877F2]">
                {calc.roas > 0 ? calc.roas.toFixed(2) : '—'}
                <span className="text-2xl font-normal text-muted-foreground">x</span>
              </p>
              <p className={cn('text-sm font-semibold', rl.color)}>{rl.text}</p>
              <p className="text-xs text-muted-foreground">
                Para cada R$ 1 investido, retorna R$ {calc.roas.toFixed(2)}
              </p>
            </CardContent>
          </Card>

          {/* Cards de resultado */}
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Leads estimados" value={Math.round(calc.leads).toLocaleString('pt-BR')} icon={Users} color="blue" />
            <ResultCard label="Vendas estimadas" value={Math.round(calc.conversoes).toLocaleString('pt-BR')} icon={Target} color="purple" />
            <ResultCard
              label="Faturamento"
              value={formatCurrency(calc.faturamento)}
              sub={`Lucro: ${formatCurrency(calc.lucroLiquido)}`}
              icon={TrendingUp}
              color="green"
            />
            <ResultCard
              label="Custo por venda"
              value={formatCurrency(calc.custoPorVenda)}
              sub="Investido por cliente"
              icon={DollarSign}
              color="yellow"
            />
          </div>

          {/* Referência de ROAS */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                Referência de ROAS para saúde
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { range: '< 1.5x', label: 'Prejuízo — pausar e revisar', color: 'bg-red-100 text-red-700' },
                { range: '1.5 – 3x', label: 'Razoável — otimizar segmentação', color: 'bg-yellow-100 text-yellow-700' },
                { range: '3 – 5x', label: 'Bom — manter e escalar gradual', color: 'bg-blue-100 text-blue-700' },
                { range: '> 5x',   label: 'Excelente — escalar agressivamente', color: 'bg-green-100 text-green-700' },
              ].map((r) => (
                <div key={r.range} className={cn('flex items-center justify-between rounded-md px-3 py-1.5 text-xs font-medium', r.color)}>
                  <span className="font-bold">{r.range}</span>
                  <span>{r.label}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
