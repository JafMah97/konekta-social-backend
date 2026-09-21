import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { z } from 'zod'
import { listSavedPostsSchema } from '../postSchemas'
import { postErrorHandler } from '../postErrorHandler'
import type { Prisma } from '@prisma/client'
import { toPostDTO, type PostDTO } from '../dto/postDTO'

type ListSavedPostsInput = z.infer<typeof listSavedPostsSchema>

interface AuthenticatedRequest extends FastifyRequest {
  user?: NonNullable<FastifyRequest['user']>
}

const MAX_LIMIT = 50

const savedPostsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/saved',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest

      try {
        const parsed = listSavedPostsSchema.safeParse(req.query)
        if (!parsed.success) throw parsed.error

        const { page, limit }: ListSavedPostsInput = parsed.data
        const cappedLimit = Math.min(limit, MAX_LIMIT)
        const skip = (page - 1) * cappedLimit
        const userId = req.user!.id

        const where: Prisma.SavedPostWhereInput = {
          userId,
          isRemoved: false,
          post: {
            isDeleted: false,
            OR: [
              { visibility: 'PUBLIC' },
              { authorId: userId },
              {
                visibility: 'FOLLOWERS_ONLY',
                author: {
                  followers: {
                    some: {
                      followerId: userId,
                      isPending: false,
                      isBlocked: false,
                      isRemoved: false,
                    },
                  },
                },
              },
            ],
          },
        }

        const [savedPosts, total] = await fastify.prisma.$transaction([
          fastify.prisma.savedPost.findMany({
            where,
            skip,
            take: cappedLimit,
            orderBy: { savedAt: 'desc' },
            include: {
              post: {
                include: {
                  tags: { include: { tag: true } },
                  author: {
                    select: {
                      id: true,
                      username: true,
                      fullName: true,
                      profileImage: true,
                      isPrivate: true,
                    },
                  },
                },
              },
            },
          }),
          fastify.prisma.savedPost.count({ where }),
        ])

        const validSavedPosts = savedPosts.filter((sp) => sp.post !== null)
        if (validSavedPosts.length === 0) {
          return reply.send({
            success: true,
            data: {
              savedPosts: [],
              pagination: {
                page,
                limit: cappedLimit,
                total,
                pages: Math.ceil(total / cappedLimit),
              },
            },
          })
        }

        const postIds = validSavedPosts.map((sp) => sp.post!.id)

        // One batch for the whole page instead of one lookup per post (N+1)
        const [likesGroup, commentsGroup, likedByMe] = await Promise.all([
          fastify.prisma.postLike.groupBy({
            by: ['postId'],
            where: { postId: { in: postIds }, isRemoved: false },
            _count: { _all: true },
          }),
          fastify.prisma.comment.groupBy({
            by: ['postId'],
            where: { postId: { in: postIds }, isDeleted: false },
            _count: { _all: true },
          }),
          fastify.prisma.postLike.findMany({
            where: { postId: { in: postIds }, userId, isRemoved: false },
            select: { postId: true },
          }),
        ])

        const likesMap = new Map(
          likesGroup.map((g) => [g.postId, g._count._all]),
        )
        const commentsMap = new Map(
          commentsGroup.map((g) => [g.postId, g._count._all]),
        )
        const likedSet = new Set(likedByMe.map((l) => l.postId))

        const mapped = validSavedPosts.map((savedPost) => {
          const post = savedPost.post!
          const dto: PostDTO = toPostDTO(post, {
            isLiked: likedSet.has(post.id),
            isSaved: true,
            tags: post.tags.map((t) => t.tag.name),
          })
          dto.likesCount = likesMap.get(post.id) ?? 0
          dto.commentsCount = commentsMap.get(post.id) ?? 0
          dto.viewsCount = post.viewsCount

          return {
            id: savedPost.id,
            savedAt: savedPost.savedAt,
            post: dto,
          }
        })

        return reply.send({
          success: true,
          data: {
            savedPosts: mapped,
            pagination: {
              page,
              limit: cappedLimit,
              total,
              pages: Math.ceil(total / cappedLimit),
            },
          },
        })
      } catch (err) {
        return postErrorHandler(req, reply, err, {
          action: 'list_saved_posts',
          userId: req.user!.id,
        })
      }
    },
  )
}

export default savedPostsRoute
