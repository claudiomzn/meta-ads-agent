import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  }

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
            <CardTitle className="text-lg">
              {mode === 'login' ? 'Entrar na conta' : 'Criar conta'}
            </CardTitle>
            <CardDescription>
              {mode === 'login' ? 'Use demo@metaads.com / demo1234 para testar' : 'Preencha os dados abaixo'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <Input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} required />
              )}
              <Input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <Input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" variant="meta" className="w-full" disabled={loading}>
                {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
              </Button>
            </form>

            <button
              className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Não tem conta? Criar agora' : 'Já tem conta? Entrar'}
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
