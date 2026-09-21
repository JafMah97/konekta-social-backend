import { z } from 'zod'

export const listNotificationsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export const notificationParamsSchema = z.object({
  notificationId: z.cuid('Invalid notification ID'),
})
