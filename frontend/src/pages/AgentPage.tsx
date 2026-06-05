import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, Zap, BarChart3, FileText, Loader2, Download,
  TrendingUp, Target, FlaskConical, Palette, AlertTriangle, Megaphone, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

const CAPABILITIES = [
  {
    icon: BarChart3,
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    title: 'Análise de campanhas',
    description: 'Desempenho, ROAS, CTR, CPL e oportunidades',
    prompt: 'Analise o desempenho de todas as campanhas. Destaque as que estão abaixo do esperado e as que merecem escala.',
  },
  {
    icon: AlertTriangle,
    color: 'text-red-500',
    bg: 'bg-red-50',
    title: 'Alertas críticos',
    description: 'ROAS baixo, frequência alta, CTR abaixo da média',
    prompt: 'Verifique se há alertas críticos: campanhas com ROAS < 2x, frequência > 3,5 ou CTR < 0,8%. Liste tudo que precisa de atenção.',
  },
  {
    icon: TrendingUp,
    color: 'text-green-500',
    bg: 'bg-green-50',
    title: 'O que escalar',
    description: 'Identifique campanhas prontas para mais investimento',
    prompt: 'Quais campanhas ou conjuntos estão com bom desempenho e prontos para escalar o orçamento? Sugira os valores de aumento.',
  },
  {
    icon: Target,
    color: 'text-purple-500',
    bg: 'bg-purple-50',
    title: 'Estratégia de público',
    description: 'Sugestões de segmentação e públicos semelhantes',
    prompt: 'Com base nos meus públicos salvos e no histórico de campanhas, sugira novas segmentações e públicos semelhantes para testar.',
  },
  {
    icon: FileText,
    color: 'text-indigo-500',
    bg: 'bg-indigo-50',
    title: 'Relatório executivo',
    description: 'Resumo completo com métricas e recomendações',
    prompt: 'Gere um relatório executivo completo: investimento total, ROAS médio, CPL, principais resultados e 5 recomendações estratégicas.',
  },
  {
    icon: Palette,
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    title: 'Diagnóstico de criativos',
    description: 'Analise CTR por anúncio e identifique os melhores',
    prompt: 'Compare o CTR e CPC dos anúncios dentro de cada conjunto. Quais criativos estão performando melhor? O que devo pausar?',
  },
  {
    icon: FlaskConical,
    color: 'text-cyan-500',
    bg: 'bg-cyan-50',
    title: 'Sugestão de testes A/B',
    description: 'Hipóteses de teste baseadas nos dados reais',
    prompt: 'Baseado nos dados das minhas campanhas, quais testes A/B você sugere? Dê a hipótese, a variável e a métrica de sucesso para cada.',
  },
  {
    icon: Megaphone,
    color: 'text-yellow-500',
    bg: 'bg-yellow-50',
    title: 'Nova campanha',
    description: 'Briefing assistido para criar do zero',
    prompt: 'Quero criar uma nova campanha. Me ajude com o briefing: qual objetivo escolher, estrutura de conjuntos, segmentação e orçamento sugerido.',
  },
];

// ─── Quick prompts ────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { icon: BarChart3,    label: 'Analisar desempenho',  prompt: 'Analise o desempenho geral das campanhas e me dê os 3 pontos mais críticos.' },
  { icon: AlertTriangle, label: 'Ver alertas',          prompt: 'Há algum alerta crítico nas campanhas agora? ROAS baixo, frequência alta ou CTR ruim?' },
  { icon: TrendingUp,   label: 'O que escalar',         prompt: 'Quais campanhas estão prontas para aumentar o orçamento? Sugira os valores.' },
  { icon: FileText,     label: 'Relatório semanal',     prompt: 'Gere um relatório executivo completo com investimento, ROAS, CPL e recomendações.' },
];

// ─── Markdown simples ─────────────────────────────────────────────────────────

function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    if (!line) return <div key={i} className="h-3" />;

    // Heading ## ou ###
    if (line.startsWith('### ')) return <p key={i} className="font-bold text-gray-900 mt-3 mb-1">{line.slice(4)}</p>;
    if (line.startsWith('## '))  return <p key={i} className="font-bold text-gray-900 text-base mt-4 mb-1">{line.slice(3)}</p>;

    // Linha horizontal
    if (line.startsWith('---')) return <hr key={i} className="my-3 border-gray-200" />;

    // Lista com -
    if (line.startsWith('- ') || line.startsWith('• ')) {
      const content = line.slice(2);
      return <p key={i} className="pl-4 before:content-['•'] before:mr-2 before:text-[#1877F2]">{renderInline(content)}</p>;
    }

    // Lista numerada
    const numMatch = line.match(/^(\d+)\.\s(.+)/);
    if (numMatch) {
      return (
        <p key={i} className="pl-4">
          <span className="font-bold text-[#1877F2] mr-1">{numMatch[1]}.</span>
          {renderInline(numMatch[2])}
        </p>
      );
    }

    return <p key={i}>{renderInline(line)}</p>;
  });
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : part,
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  const isUser = msg.role === 'user';
  const time = new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'bg-[#1877F2] text-white' : 'bg-gray-100 text-gray-500',
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble */}
      <div className={cn('max-w-[78%] space-y-1', isUser && 'items-end flex flex-col')}>
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-[#1877F2] text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-700 rounded-tl-sm shadow-sm',
        )}>
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <div className="space-y-0.5">
              {msg.content
                ? renderMarkdown(msg.content)
                : isStreaming && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              }
              {isStreaming && msg.content && (
                <span className="inline-block w-1.5 h-4 bg-[#1877F2] animate-pulse rounded-sm ml-0.5 align-text-bottom" />
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 px-1">{time}</p>
      </div>
    </div>
  );
}

// ─── Export PDF ───────────────────────────────────────────────────────────────

function exportToPDF(messages: ChatMessage[]) {
  const printContent = messages
    .filter((m) => m.role !== 'system' as unknown as string)
    .map((m) => {
      const role = m.role === 'user' ? '👤 Você' : '🤖 Agente Meta Ads';
      const time = new Date(m.createdAt).toLocaleString('pt-BR');
      const content = m.content
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `<div class="message ${m.role}">
        <div class="meta"><strong>${role}</strong> <span>${time}</span></div>
        <div class="content">${content}</div>
      </div>`;
    }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Agente Meta Ads — ${new Date().toLocaleDateString('pt-BR')}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; max-width: 800px; margin: 0 auto; padding: 24px; }
  h1 { color: #1877F2; font-size: 20px; border-bottom: 2px solid #1877F2; padding-bottom: 8px; margin-bottom: 24px; }
  .message { margin-bottom: 20px; padding: 12px 16px; border-radius: 8px; page-break-inside: avoid; }
  .message.user      { background: #e7f0fd; border-left: 4px solid #1877F2; }
  .message.assistant { background: #f9f9f9; border-left: 4px solid #10b981; }
  .meta { font-size: 12px; color: #666; margin-bottom: 6px; }
  .meta strong { color: #111; }
  .meta span { margin-left: 8px; }
  .content { font-size: 14px; line-height: 1.6; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h1>📊 Agente Meta Ads — ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h1>
  ${printContent}
  <p style="font-size:11px;color:#999;margin-top:32px;text-align:center;">Gerado por Meta Ads Agent</p>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { toast.error('Permita pop-ups para exportar o PDF'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 500);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Olá! Sou seu **Agente Meta Ads** com IA.\n\nTenho acesso às suas campanhas, conjuntos, anúncios e públicos em tempo real. Posso analisar performance, identificar alertas, sugerir otimizações e criar relatórios.\n\nComo posso ajudar hoje?',
  createdAt: new Date().toISOString(),
};

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Carrega histórico persistido ao abrir ──────────────────────────────────
  useEffect(() => {
    api.get<ChatMessage[]>('/agent/chat-history')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages([WELCOME, ...data]);
        }
      })
      .catch(() => { /* silencia erros de rede */ })
      .finally(() => setHistoryLoading(false));
  }, []);

  // ── Limpa histórico ────────────────────────────────────────────────────────
  async function clearHistory() {
    if (!confirm('Apagar todo o histórico da conversa?')) return;
    await api.delete('/agent/chat-history');
    setMessages([WELCOME]);
    toast.success('Histórico apagado');
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setInput('');

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };

    // Histórico para enviar (sem a mensagem welcome de boas-vindas)
    const history = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);
    setStreamingId(assistantId);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text.trim(), history }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.chunk) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + data.chunk } : m,
                ),
              );
            }
            if (data.error) {
              toast.error(data.error);
              setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      console.error('[Agent] Erro:', err);
      toast.error('Erro ao conectar com o agente. Tente novamente.');
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setLoading(false);
      setStreamingId(null);
    }
  }, [loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const showQuickPrompts = messages.length <= 1;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-6 overflow-hidden">

      {/* ── Chat ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#1877F2]/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-[#1877F2]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Agente Meta Ads</p>
              <div className="flex items-center gap-1.5">
                <div className={cn('w-1.5 h-1.5 rounded-full', loading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400')} />
                <p className="text-xs text-gray-400">
                  {loading ? 'digitando...' : 'claude-sonnet-4-6 · pronto'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 1 && (
              <>
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
                  title="Apagar histórico"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpar
                </button>
                <button
                  onClick={() => exportToPDF(messages)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs text-gray-500 hover:text-gray-800 hover:border-[#1877F2]/50 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar PDF
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {historyLoading ? (
            <div className="space-y-4 pt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className={cn('flex gap-3', i % 2 === 0 && 'flex-row-reverse')}>
                  <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
                  <div className={cn('rounded-2xl px-4 py-3 animate-pulse', i % 2 === 0 ? 'bg-blue-100 w-40' : 'bg-gray-200 w-64')} style={{ height: 48 }} />
                </div>
              ))}
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isStreaming={msg.id === streamingId}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick prompts — só aparece antes de qualquer mensagem */}
        {showQuickPrompts && (
          <div className="px-6 pb-3 grid grid-cols-2 gap-2 flex-shrink-0">
            {QUICK_PROMPTS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                onClick={() => sendMessage(prompt)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-sm text-gray-600 hover:text-[#1877F2] hover:border-[#1877F2]/40 hover:shadow-sm transition-all text-left disabled:opacity-50"
              >
                <Icon className="w-4 h-4 text-[#1877F2] flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-6 py-4 bg-white border-t flex-shrink-0">
          <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte sobre suas campanhas, peça análises, relatórios ou otimizações..."
              rows={1}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#1877F2]/30 focus:border-[#1877F2] transition-all"
              style={{ minHeight: 44, maxHeight: 140 }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-[#1877F2] flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1465d8] transition-colors flex-shrink-0"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Enter para enviar · Shift+Enter para nova linha
          </p>
        </div>
      </div>

      {/* ── Sidebar de capacidades ─────────────────────────────────────────── */}
      <div className="w-64 border-l bg-white flex flex-col overflow-hidden flex-shrink-0">
        <div className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-[#1877F2]" />
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">O que posso fazer</p>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Clique para usar no chat</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {CAPABILITIES.map((cap) => (
            <button
              key={cap.title}
              onClick={() => sendMessage(cap.prompt)}
              disabled={loading}
              className="w-full text-left rounded-xl p-3 border border-transparent hover:border-[#1877F2]/30 hover:bg-[#1877F2]/5 transition-all group disabled:opacity-50"
            >
              <div className="flex items-start gap-2.5">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', cap.bg)}>
                  <cap.icon className={cn('w-3.5 h-3.5', cap.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 group-hover:text-[#1877F2] transition-colors leading-snug">
                    {cap.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">{cap.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Rodapé da sidebar */}
        <div className="px-4 py-3 border-t flex-shrink-0">
          <div className="rounded-lg bg-[#1877F2]/5 border border-[#1877F2]/20 p-3">
            <p className="text-xs font-semibold text-[#1877F2] mb-1">💡 Contexto em tempo real</p>
            <p className="text-xs text-gray-500 leading-snug">
              O agente acessa suas campanhas, métricas, públicos e copies ao responder.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
