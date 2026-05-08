import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/20 bg-red-50 p-10 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">Algo deu errado</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              {this.state.error?.message ?? 'Erro inesperado. Tente recarregar a página.'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
