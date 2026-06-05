import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type Mode = 'login' | 'register' | 'forgot';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Estado do esqueci-senha
  const [resetUrl, setResetUrl] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        navigate('/dashboard');
      } else if (mode === 'register') {
        await register(name, email, password);
        navigate('/dashboard');
      } else {
        // forgot
        const res = await api.post<{ success: boolean; resetUrl?: string }>('/auth/forgot-password', { email });
        setForgotSent(true);
        if (res.resetUrl) setResetUrl(res.resetUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setForgotSent(false);
    setResetUrl('');
  }

  const titles: Record<Mode, string> = {
    login: 'Entrar na conta',
    register: 'Criar conta',
    forgot: 'Recuperar senha',
  };

  const descriptions: Record<Mode, string> = {
    login: 'Entre com seu e-mail e senha cadastrados',
    register: 'Preencha os dados abaixo',
    forgot: 'Informe seu e-mail cadastrado',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 px-4">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1877F2]">
            <span className="text-2xl font-bold text-white">f</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Meta Ads Agent</h1>
          <p className="text-sm text-muted-foreground">Gerencie campanhas com IA</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{titles[mode]}</CardTitle>
            <CardDescription>{descriptions[mode]}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Esqueci senha — após envio */}
            {mode === 'forgot' && forgotSent ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
                  {resetUrl
                    ? 'Link de redefinição gerado. Copie o endereço abaixo:'
                    : 'Se o e-mail estiver cadastrado, você receberá o link em breve.'}
                </div>
                {resetUrl && (
                  <div className="space-y-2">
                    <Input readOnly value={resetUrl} className="text-xs font-mono" onClick={(e) => (e.target as HTMLInputElement).select()} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => { navigator.clipboard.writeText(resetUrl); }}
                    >
                      Copiar link
                    </Button>
                  </div>
                )}
                <button className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => switchMode('login')}>
                  Voltar para o login
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <Input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} required />
                )}
                <Input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
                {mode !== 'forgot' && (
                  <Input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" variant="meta" className="w-full" disabled={loading}>
                  {loading
                    ? 'Aguarde...'
                    : mode === 'login' ? 'Entrar'
                    : mode === 'register' ? 'Criar conta'
                    : 'Enviar link de recuperação'}
                </Button>
              </form>
            )}

            {/* Links de navegação entre modos */}
            {!(mode === 'forgot' && forgotSent) && (
              <div className="mt-4 flex flex-col items-center gap-1.5">
                {mode === 'login' && (
                  <>
                    <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => switchMode('register')}>
                      Não tem conta? Criar agora
                    </button>
                    <button className="text-sm text-[#1877F2] hover:underline" onClick={() => switchMode('forgot')}>
                      Esqueci minha senha
                    </button>
                  </>
                )}
                {mode === 'register' && (
                  <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => switchMode('login')}>
                    Já tem conta? Entrar
                  </button>
                )}
                {mode === 'forgot' && (
                  <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => switchMode('login')}>
                    Voltar para o login
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
