import type { FastifyInstance } from 'fastify'
import type { NotificationType, Prisma } from '@prisma/client'

export interface NotifyInput {
  recipientId: string
  actorId: string
  type: NotificationType
  postId?: string
  /** Short preview, e.g. the comment text */
  messageText?: string
  /** Frontend path the notification opens */
  link?: string
}

// Same shape in the list endpoint and in the realtime push
export const notificationSelect = {
  id: true,
  type: true,
  messageText: true,
  link: true,
  postId: true,
  isRead: true,
  readAt: true,
  createdAt: true,
  actor: {
    select: { id: true, username: true, fullName: true, profileImage: true },
  },
} satisfies Prisma.NotificationSelect

// Actions that can be toggled (like → unlike → like) notify only once
const DEDUPED: NotificationType[] = [
  'like_post',
  'comment_liked',
  'follow',
  'follow_request',
]

export const excerpt = (text: string, max = 100) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/**
 * Stores a notification and pushes it to the recipient's open sockets.
 * Never throws: a failed notification must not fail the like / comment /
 * follow that triggered it, so errors are logged instead.
 */
export async function notify(
  fastify: FastifyInstance,
  input: NotifyInput,
): Promise<void> {
  if (input.recipientId === input.actorId) return

  const key = {
    userId: input.recipientId,
    actorId: input.actorId,
    type: input.type,
    postId: input.postId ?? null,
    link: input.link ?? null,
  }

  try {
    if (DEDUPED.includes(input.type)) {
      const existing = await fastify.prisma.notification.findFirst({
        where: { ...key, isDeleted: false },
        select: { id: true },
      })
      if (existing) return
    }

    const notification = await fastify.prisma.notification.create({
      data: { ...key, messageText: input.messageText ?? null },
      select: notificationSelect,
    })
    fastify.sendNotification(input.recipientId, notification)
  } catch (err) {
    fastify.log.error({ err, ...key }, 'Failed to create notification')
  }
}

/** Removes a notification that no longer applies (e.g. cancelled request) */
export async function withdrawNotification(
  fastify: FastifyInstance,
  input: Pick<NotifyInput, 'recipientId' | 'actorId' | 'type'>,
): Promise<void> {
  try {
    await fastify.prisma.notification.updateMany({
      where: {
        userId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        isDeleted: false,
      },
      data: { isDeleted: true, deletedAt: new Date() },
    })
  } catch (err) {
    fastify.log.error({ err, ...input }, 'Failed to withdraw notification')
  }
}

/** Marks notifications as read, e.g. a request once it has been answered */
export async function markNotificationsRead(
  fastify: FastifyInstance,
  input: Pick<NotifyInput, 'recipientId' | 'actorId' | 'type'>,
): Promise<void> {
  try {
    await fastify.prisma.notification.updateMany({
      where: {
        userId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    })
  } catch (err) {
    fastify.log.error({ err, ...input }, 'Failed to mark notifications read')
  }
}
