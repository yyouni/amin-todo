import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@todo/contracts';
import { api, RequestError } from '@/lib/api';
import { AuthScreen } from '@/components/auth-screen';
import { TaskDashboard } from '@/components/task-dashboard';
import { Brand } from '@/components/brand';
import { ErrorNotice } from '@/components/error-notice';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export default function App() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (error) {
        if (error instanceof RequestError && error.status === 401) return null;
        throw error;
      }
    },
  });
  function signedOut() {
    client.removeQueries({ queryKey: ['tasks'] });
    client.setQueryData(['me'], null);
  }
  useEffect(() => {
    const listener = () => {
      client.removeQueries({ queryKey: ['tasks'] });
      client.setQueryData(['me'], null);
    };
    window.addEventListener('todo:unauthorized', listener);
    return () => window.removeEventListener('todo:unauthorized', listener);
  }, [client]);
  if (me.isPending)
    return (
      <main className="loading-screen">
        <Brand />
        <Spinner />
        <p>Собираем всё по порядку…</p>
      </main>
    );
  if (me.isError)
    return (
      <main className="loading-screen">
        <Brand />
        <ErrorNotice error={me.error} />
        <Button onClick={() => void me.refetch()}>Попробовать снова</Button>
      </main>
    );
  return me.data ? (
    <TaskDashboard user={me.data} onLogout={signedOut} />
  ) : (
    <AuthScreen
      onAuthenticated={(user) => {
        client.removeQueries({ queryKey: ['tasks'] });
        client.setQueryData(['me'], user);
      }}
    />
  );
}
