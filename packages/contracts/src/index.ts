import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.email('Введите корректный email').max(254).trim().toLowerCase(),
  password: z.string().min(12, 'Минимум 12 символов').max(128, 'Максимум 128 символов'),
});
export const loginSchema = credentialsSchema.extend({
  password: z.string().min(1, 'Введите пароль').max(128),
});
export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Введите название задачи')
  .max(200, 'Максимум 200 символов');
export const createTaskSchema = z.object({ title: taskTitleSchema }).strict();
export const updateTaskSchema = z
  .object({ title: taskTitleSchema.optional(), completed: z.boolean().optional() })
  .strict()
  .refine((v) => v.title !== undefined || v.completed !== undefined, 'Нет изменений');
export const taskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  completed: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const userSchema = z.object({ id: z.uuid(), email: z.email() });
export type User = z.infer<typeof userSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type ApiError = {
  error: { code: string; message: string; fields?: Record<string, string[]> };
};
