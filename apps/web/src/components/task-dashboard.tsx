import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCheckIcon,
  ListTodoIcon,
  LogOutIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  ArrowUpRightIcon,
  InboxIcon,
  LockKeyholeIcon,
} from 'lucide-react';
import { taskTitleSchema, type Task, type User } from '@todo/contracts';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Brand } from './brand';
import { ErrorNotice } from './error-notice';

export function TaskDashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const [deleting, setDeleting] = useState<Task | null>(null);
  const tasksQuery = useQuery({
    queryKey: ['tasks', user.id],
    queryFn: async () => (await api<{ tasks: Task[] }>('/tasks')).tasks,
  });
  const taskKey = ['tasks', user.id];
  const create = useMutation({
    mutationFn: (value: string) =>
      api<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify({ title: value }) }),
    onSuccess: ({ task }) => {
      queryClient.setQueryData<Task[]>(taskKey, (old) => [task, ...(old ?? [])]);
      setTitle('');
      setTitleError('');
      titleInput.current?.focus();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; title?: string; completed?: boolean }) =>
      api<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: ({ task }) => {
      queryClient.setQueryData<Task[]>(taskKey, (old) =>
        old?.map((item) => (item.id === task.id ? task : item)),
      );
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Task[]>(taskKey, (old) => old?.filter((item) => item.id !== id));
      setDeleting(null);
    },
  });
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: onLogout,
  });
  const all = tasksQuery.data ?? [];
  const active = all.filter((task) => !task.completed);
  const done = all.filter((task) => task.completed);
  const percent = all.length ? Math.round((done.length / all.length) * 100) : 0;
  const busy = update.isPending || remove.isPending;
  function addTask(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    const result = taskTitleSchema.safeParse(title);
    setTitleError(result.success ? '' : result.error.issues[0].message);
    if (result.success) create.mutate(result.data);
  }
  function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!editing || update.isPending) return;
    const result = taskTitleSchema.safeParse(draft);
    setDraftError(result.success ? '' : result.error.issues[0].message);
    if (result.success) update.mutate({ id: editing.id, title: result.data });
  }
  function taskRow(task: Task) {
    return (
      <li key={task.id} className={cn('task-row', task.completed && 'task-completed')}>
        <Field orientation="horizontal" className="min-w-0 flex-1">
          <Checkbox
            id={`task-${task.id}`}
            checked={task.completed}
            onCheckedChange={(checked) => {
              update.reset();
              update.mutate({ id: task.id, completed: checked === true });
            }}
            disabled={busy}
          />
          <FieldLabel htmlFor={`task-${task.id}`} className="min-w-0">
            <span className="task-title">{task.title}</span>
          </FieldLabel>
        </Field>
        <div className="task-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Изменить задачу: ${task.title}`}
            title="Изменить"
            disabled={busy}
            onClick={() => {
              update.reset();
              setDraftError('');
              setDraft(task.title);
              setEditing(task);
            }}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Удалить задачу: ${task.title}`}
            title="Удалить"
            disabled={busy}
            onClick={() => {
              remove.reset();
              setDeleting(task);
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      </li>
    );
  }
  return (
    <div className="app-layout">
      <div className="app-main">
        <header className="app-header">
          <div className="flex flex-col">
            <Brand />
            <span className="text-muted-foreground text-xs">Соберите дела в порядок</span>
          </div>

          <div className="account">
            <span className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <p className="account-name">Мой аккаунт</p>
              <p className="account-email" title={user.email}>
                {user.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOutIcon data-icon="inline-start" />
            </Button>
          </div>
        </header>
        <main id="main-content" className="workspace">
          <ErrorNotice error={logout.error} />
          <div className="progress-summary">
            <span className="summary-icon">
              <CheckCheckIcon className="size-5" />
            </span>
            <div className="summary-text">
              <p>
                {done.length} из {all.length} задач выполнено
              </p>
            </div>
            <div className="summary-progress">
              <span>{percent}%</span>
              <Progress value={percent} aria-label="Выполнено задач" />
            </div>
          </div>
          <Card className="tasks-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Мои задачи</CardTitle>
              </div>
              <CardDescription>Запишите, что хочется сделать.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={addTask} noValidate>
                <FieldGroup>
                  <Field data-invalid={!!titleError} data-disabled={create.isPending}>
                    <FieldLabel htmlFor="new-task" className="sr-only">
                      Новая задача
                    </FieldLabel>
                    <div className="add-task-controls">
                      <Input
                        ref={titleInput}
                        id="new-task"
                        placeholder="Что нужно сделать?"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={200}
                        aria-invalid={!!titleError}
                        aria-describedby={titleError ? 'task-error' : undefined}
                        disabled={create.isPending || tasksQuery.isPending || tasksQuery.isError}
                        autoComplete="off"
                      />
                      <Button
                        type="submit"
                        size="lg"
                        disabled={create.isPending || tasksQuery.isPending || tasksQuery.isError}
                      >
                        {create.isPending ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <PlusIcon data-icon="inline-start" />
                        )}
                        Добавить
                      </Button>
                    </div>
                    <FieldError id="task-error">{titleError}</FieldError>
                  </Field>
                  <ErrorNotice error={create.error} />
                </FieldGroup>
              </form>
              <div className="task-list-area" aria-live="polite" aria-busy={tasksQuery.isPending}>
                {tasksQuery.isPending ? (
                  <div className="flex flex-col gap-4 py-6" aria-label="Загрузка задач">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-4/5" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : tasksQuery.isError ? (
                  <div className="flex flex-col items-start gap-4 py-5">
                    <ErrorNotice error={tasksQuery.error} />
                    <Button variant="outline" onClick={() => void tasksQuery.refetch()}>
                      Попробовать снова
                    </Button>
                  </div>
                ) : all.length === 0 ? (
                  <Empty className="py-14">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <InboxIcon />
                      </EmptyMedia>
                      <EmptyTitle>Начните с одной задачи</EmptyTitle>
                      <EmptyDescription>
                        Пусть планы не держатся в голове.
                        <br />
                        Добавьте первое дело и станет чуть спокойнее.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button variant="link" onClick={() => titleInput.current?.focus()}>
                        Записать первую задачу
                        <ArrowUpRightIcon data-icon="inline-end" />
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <>
                    {active.length > 0 && (
                      <section aria-labelledby="active-heading">
                        <h2 id="active-heading" className="task-section-heading">
                          В планах <span>{active.length}</span>
                        </h2>
                        <ul>{active.map(taskRow)}</ul>
                      </section>
                    )}
                    {done.length > 0 && (
                      <section aria-labelledby="done-heading">
                        <h2 id="done-heading" className="task-section-heading">
                          Готово <span>{done.length}</span>
                        </h2>
                        <ul>{done.map(taskRow)}</ul>
                      </section>
                    )}
                  </>
                )}
              </div>
              {!editing && <ErrorNotice error={update.error} />}
              {!deleting && <ErrorNotice error={remove.error} />}
            </CardContent>
          </Card>
        </main>
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setEditing(null);
        }}
      >
        <DialogContent showCloseButton={!update.isPending}>
          <DialogHeader>
            <DialogTitle>Изменить задачу</DialogTitle>
            <DialogDescription>Уточните название — остальное уже сохранено.</DialogDescription>
          </DialogHeader>
          <form id="edit-task-form" onSubmit={saveTask} noValidate>
            <FieldGroup>
              <Field data-invalid={!!draftError}>
                <FieldLabel htmlFor="edit-title">Название задачи</FieldLabel>
                <Input
                  id="edit-title"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={200}
                  disabled={update.isPending}
                  aria-invalid={!!draftError}
                  aria-describedby={draftError ? 'draft-error' : undefined}
                />
                <FieldError id="draft-error">{draftError}</FieldError>
              </Field>
              <ErrorNotice error={update.error} />
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button variant="outline" disabled={update.isPending} onClick={() => setEditing(null)}>
              Отмена
            </Button>
            <Button type="submit" form="edit-task-form" disabled={update.isPending}>
              {update.isPending && <Spinner data-icon="inline-start" />}Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="[overflow-wrap:anywhere]">«{deleting?.title}»</span> будет удалена.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorNotice error={remove.error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleting && !remove.isPending) remove.mutate(deleting.id);
              }}
            >
              {remove.isPending && <Spinner data-icon="inline-start" />}Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
