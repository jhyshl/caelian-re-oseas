import { z } from 'zod';

const commandBase = {
  id: z.string().min(1).max(160),
};

export const domainCommandSchema = z.discriminatedUnion('type', [
  z.object({
    ...commandBase,
    type: z.literal('character.update'),
    payload: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        className: z.string().trim().min(1).max(80).optional(),
        subclass: z.string().trim().max(80).optional(),
        level: z.number().int().min(1).max(999).optional(),
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: '至少需要修改一个人物字段',
      }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('world.move'),
    payload: z.object({
      region: z.string().trim().min(1).max(120),
      location: z.string().trim().min(1).max(120),
      gameDate: z.string().trim().max(80).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal('inventory.adjust'),
    payload: z.object({
      itemId: z.string().trim().min(1).max(120),
      name: z.string().trim().min(1).max(120).optional(),
      delta: z.number().int().min(-999999).max(999999).refine((value) => value !== 0),
    }),
  }),
]);

export type DomainCommand = z.infer<typeof domainCommandSchema>;

export interface CommandResult {
  id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  message?: string;
}
