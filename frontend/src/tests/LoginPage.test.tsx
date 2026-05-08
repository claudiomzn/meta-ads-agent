import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';

// Mock do useAuth
const mockLogin = vi.fn();
const mockRegister = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ login: mockLogin, register: mockRegister, user: null, loading: false }),
}));

// Mock do useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue({ token: 'tok', user: { id: '1', name: 'Test', email: 'a@b.com' } });
  });

  it('renderiza formulário de login', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('E-mail')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Senha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  it('chama login com os dados do formulário', async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('E-mail'), 'demo@metaads.com');
    await user.type(screen.getByPlaceholderText('Senha'), 'demo1234');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('demo@metaads.com', 'demo1234');
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('exibe mensagem de erro quando login falha', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Credenciais inválidas'));
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('E-mail'), 'wrong@email.com');
    await user.type(screen.getByPlaceholderText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(screen.getByText('Credenciais inválidas')).toBeInTheDocument();
    });
  });

  it('alterna para modo de cadastro', async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByText(/criar agora/i));

    expect(screen.getByPlaceholderText('Seu nome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar conta/i })).toBeInTheDocument();
  });

  it('chama register no modo de cadastro', async () => {
    mockRegister.mockResolvedValueOnce({ token: 'tok', user: { id: '2', name: 'New', email: 'n@n.com' } });
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByText(/criar agora/i));
    await user.type(screen.getByPlaceholderText('Seu nome'), 'Novo Usuário');
    await user.type(screen.getByPlaceholderText('E-mail'), 'novo@test.com');
    await user.type(screen.getByPlaceholderText('Senha'), 'senha123');
    await user.click(screen.getByRole('button', { name: /criar conta/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('Novo Usuário', 'novo@test.com', 'senha123');
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('desabilita botão durante carregamento', async () => {
    mockLogin.mockImplementationOnce(() => new Promise(() => {})); // nunca resolve
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('E-mail'), 'a@a.com');
    await user.type(screen.getByPlaceholderText('Senha'), 'senha');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /aguarde/i })).toBeDisabled();
    });
  });
});
