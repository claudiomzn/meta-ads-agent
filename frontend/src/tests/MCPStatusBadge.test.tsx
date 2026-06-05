import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MCPStatusBadge } from '@/components/MCPStatusBadge';

const mockSync = vi.fn();

vi.mock('@/hooks/useMCP', () => ({
  useMCPStatus: vi.fn(),
  useSyncNow: () => ({ mutate: mockSync, isPending: false }),
}));

import { useMCPStatus } from '@/hooks/useMCP';

describe('MCPStatusBadge', () => {
  it('mostra "Verificando..." durante carregamento', () => {
    vi.mocked(useMCPStatus).mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useMCPStatus>);
    render(<MCPStatusBadge />);
    expect(screen.getByText(/verificando/i)).toBeInTheDocument();
  });

  it('mostra "Desconectado" quando MCP não está conectado', () => {
    vi.mocked(useMCPStatus).mockReturnValue({
      data: { connected: false, adAccountIds: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useMCPStatus>);
    render(<MCPStatusBadge />);
    expect(screen.getByText(/desconectado/i)).toBeInTheDocument();
  });

  it('mostra "Meta Ads conectado" e número de contas', () => {
    vi.mocked(useMCPStatus).mockReturnValue({
      data: { connected: true, adAccountIds: ['act_111', 'act_222'], provider: 'pipeboard' },
      isLoading: false,
    } as unknown as ReturnType<typeof useMCPStatus>);
    render(<MCPStatusBadge />);
    expect(screen.getByText(/meta ads conectado/i)).toBeInTheDocument();
    expect(screen.getByText(/2 conta/i)).toBeInTheDocument();
  });

  it('chama sync ao clicar no botão', async () => {
    vi.mocked(useMCPStatus).mockReturnValue({
      data: { connected: true, adAccountIds: ['act_123'] },
      isLoading: false,
    } as unknown as ReturnType<typeof useMCPStatus>);
    render(<MCPStatusBadge />);
    await userEvent.click(screen.getByRole('button', { name: /sincronizar/i }));
    expect(mockSync).toHaveBeenCalledOnce();
  });
});
