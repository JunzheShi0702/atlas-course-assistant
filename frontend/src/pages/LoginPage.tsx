import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = () => {
    try {
      setLoading(true);
      setError(null);
      login();
    } catch {
      setError('Failed to start sign-in. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Sparkles className="h-10 w-10 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Atlas</h1>
        <p className="text-muted-foreground max-w-sm">
          Your 24/7 AI course advisor. Sign in to build schedules, get
          personalized recommendations, and plan your semester.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          onClick={handleLogin}
          disabled={loading}
          aria-label="Sign in with Google"
        >
          {loading ? 'Redirecting…' : 'Sign in with Google'}
        </Button>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
