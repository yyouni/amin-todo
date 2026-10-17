import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowRightIcon } from 'lucide-react';
import { credentialsSchema, loginSchema, type Credentials, type User } from '@todo/contracts';
import { api, RequestError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ErrorNotice } from './error-notice';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const mutation = useMutation({
    mutationFn: (credentials: Credentials) =>
      api<{ user: User }>(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(credentials),
      }),
    onSuccess: ({ user }) => onAuthenticated(user),
    onError: (error) => {
      if (error instanceof RequestError && error.payload.fields) setFields(error.payload.fields);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = (register ? credentialsSchema : loginSchema).safeParse({ email, password });
    setFields({});
    mutation.reset();
    if (!result.success) {
      const next: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0]);
        next[key] = [...(next[key] ?? []), issue.message];
      }
      setFields(next);
      return;
    }
    mutation.mutate(result.data);
  }
  return (
    <main className="auth-layout">
      <section className="auth-form-area" aria-label={register ? 'Регистрация' : 'Вход'}>
        <Card className="auth-card overflow-visible">
          <CardHeader>
            <CardTitle>{register ? 'Начнем с чистого листа' : 'С возвращением'}</CardTitle>
            <CardDescription>
              {register
                ? 'Создайте аккаунт, чтобы сохранить свои планы.'
                : 'Войдите, чтобы вернуться к своим задачам.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="auth-form" onSubmit={submit} noValidate>
              <FieldGroup>
                <Field data-invalid={!!fields.email} data-disabled={mutation.isPending}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    maxLength={254}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={!!fields.email}
                    aria-describedby={fields.email ? 'email-error' : undefined}
                    disabled={mutation.isPending}
                    required
                  />
                  <FieldError id="email-error">{fields.email?.[0]}</FieldError>
                </Field>
                <Field data-invalid={!!fields.password} data-disabled={mutation.isPending}>
                  <FieldLabel htmlFor="password">Пароль</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={register ? 'new-password' : 'current-password'}
                    placeholder={register ? 'Придумайте надежный пароль' : 'Введите пароль'}
                    value={password}
                    maxLength={128}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!fields.password}
                    aria-describedby={
                      fields.password ? 'password-error' : register ? 'password-hint' : undefined
                    }
                    disabled={mutation.isPending}
                    required
                  />
                  {register && (
                    <FieldDescription id="password-hint">От 12 до 128 символов.</FieldDescription>
                  )}
                  <FieldError id="password-error">{fields.password?.[0]}</FieldError>
                </Field>
                <ErrorNotice error={mutation.error} />
                <Button type="submit" size="lg" disabled={mutation.isPending}>
                  {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {register ? 'Создать аккаунт' : 'Войти'}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="border-0">
            <p>
              {register ? 'Уже есть аккаунт?' : 'Еще нет аккаунта?'}{' '}
              <Button
                variant="link"
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setRegister(!register);
                  setPassword('');
                  setFields({});
                  mutation.reset();
                }}
              >
                {register ? 'Войти' : 'Зарегистрироваться'}
              </Button>
            </p>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}
