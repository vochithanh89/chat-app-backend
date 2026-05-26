import { DateTime } from 'luxon'
import fs from 'node:fs/promises'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import User from '#models/user'
import Message from '#models/message'
import db from '@adonisjs/lucid/services/db'

const BOT_EMAIL = 'ai-bot@system.local'
const BOT_NAME = 'AI Assistant'
const HISTORY_LIMIT = 20

export interface AiTurn {
  role: 'user' | 'model'
  content: string
}

/**
 * Wraps Google Gemini's REST API. Disabled gracefully if GEMINI_API_KEY is
 * not set — `isEnabled()` returns false and the controller can 503.
 */
class ChatbotService {
  private botUser: User | null = null

  isEnabled(): boolean {
    return Boolean(env.get('GEMINI_API_KEY'))
  }

  /** Find or lazily create the system user that owns AI replies. */
  async getBotUser(): Promise<User> {
    if (this.botUser) return this.botUser
    let bot = await User.findBy('email', BOT_EMAIL)
    if (!bot) {
      bot = await User.create({
        email: BOT_EMAIL,
        name: BOT_NAME,
        phone: '0000000000',
        // Random password — bot user is never used for login.
        password: Math.random().toString(36).slice(2) + Date.now(),
        bio: 'Built-in AI assistant powered by Google Gemini.',
        verifiedAt: DateTime.now(),
      })
    }
    this.botUser = bot
    return bot
  }

  /** Clean up duplicate AI conversations and delete messages older than 24 hours. */
  async cleanupAiConversations(userId?: number) {
    try {
      const bot = await this.getBotUser()
      const limitTime = DateTime.now().minus({ hours: 24 }).toJSDate()
      
      // 1. Delete messages older than 24 hours in all AI conversations
      await db
        .from('messages')
        .where('created_at', '<', limitTime)
        .whereIn(
          'conversation_id',
          db.from('conversation_members').select('conversation_id').where('user_id', bot.id)
        )
        .delete()

      // 2. Merge/delete duplicates
      if (userId) {
        await this.mergeConversationsForUser(userId, bot.id)
      } else {
        const duplicates = await db
          .from('conversation_members as m1')
          .join('conversation_members as m2', (q) => {
            q.on('m1.conversation_id', 'm2.conversation_id').andOnVal('m2.user_id', bot.id)
          })
          .join('conversations as c', 'c.id', 'm1.conversation_id')
          .where('c.type', 'direct')
          .where('m1.user_id', '!=', bot.id)
          .groupBy('m1.user_id')
          .havingRaw('count(c.id) > 1')
          .select('m1.user_id as userId')
        
        for (const row of duplicates) {
          await this.mergeConversationsForUser(row.userId, bot.id)
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to cleanup AI conversations')
    }
  }

  /** Ensure there is a greeting message if the conversation is empty. */
  async ensureGreetingMessage(conversationId: number) {
    try {
      const countResult = await db
        .from('messages')
        .where('conversation_id', conversationId)
        .count('* as total')
      const total = Number(countResult[0]?.total || 0)
      
      if (total === 0) {
        const bot = await this.getBotUser()
        const { default: messageService } = await import('#services/message_service')
        await messageService.createMessage({
          conversationId,
          senderId: bot.id,
          content: `Xin chào! Tôi là Trợ lý AI Assistant của ChatApp. Tôi có thể giúp gì cho bạn hôm nay?

Bạn có thể hỏi tôi một số tính năng của ứng dụng như:
1. Cách quản lý nhóm chat, phân quyền quản trị viên, hoặc bật tính năng duyệt thành viên mới.
2. Cách kết bạn, đồng ý hoặc từ chối yêu cầu kết bạn.
3. Cách ghim tin nhắn, tạo bình chọn (Poll) trong các cuộc trò chuyện.
4. Cách tìm kiếm bạn bè hoặc thiết lập hồ sơ cá nhân.`,
          skipAiTrigger: true,
        })
      }
    } catch (err) {
      logger.error({ err }, 'Failed to ensure AI greeting message')
    }
  }

  private async mergeConversationsForUser(userId: number, botId: number) {
    // Find all direct conversations between this user and the bot
    const rows = await db
      .from('conversations as c')
      .select('c.id')
      .join('conversation_members as m1', 'm1.conversation_id', 'c.id')
      .join('conversation_members as m2', 'm2.conversation_id', 'c.id')
      .where('c.type', 'direct')
      .andWhere('m1.user_id', userId)
      .andWhere('m2.user_id', botId)
      .orderBy('c.id', 'desc') // keep the newest one (highest ID)

    if (rows.length <= 1) return

    const deleteIds = rows.slice(1).map((r) => r.id)

    // Delete members, messages, and conversation rows of duplicate conversations
    await db.from('messages').whereIn('conversation_id', deleteIds).delete()
    await db.from('conversation_members').whereIn('conversation_id', deleteIds).delete()
    await db.from('conversations').whereIn('id', deleteIds).delete()
  }

  /**
   * Builds the chat history (oldest → newest) from the conversation, then
   * sends it to Gemini and returns the model reply.
   * On 429 errors, automatically reduces history size to avoid overload.
   */
  async generateReply(conversationId: number, currentUserContent: string): Promise<string> {
    const apiKey = env.get('GEMINI_API_KEY')
    if (!apiKey) throw Object.assign(new Error('AI is disabled.'), { status: 503 })

    const model = env.get('GEMINI_MODEL') || 'gemini-3.5-flash'
    const bot = await this.getBotUser()

    // Load AI chatbot system instruction knowledge
    let systemInstruction = 'Bạn là trợ lý AI Assistant thông minh của ChatApp.'
    try {
      const instructionPath = path.join(process.cwd(), 'config', 'ai_bot_instruction.txt')
      systemInstruction = await fs.readFile(instructionPath, 'utf-8')
    } catch (err) {
      logger.error({ err }, 'Failed to read AI system instruction file, using default.')
    }

    // Retry configuration with progressive history reduction
    const MAX_RETRIES = 3
    const INITIAL_DELAY_MS = 2000
    const BACKOFF_MULTIPLIER = 2
    
    // Load full history once
    const recent = await Message.query()
      .where('conversation_id', conversationId)
      .andWhere('is_recalled', false)
      .orderBy('id', 'desc')
      .limit(HISTORY_LIMIT)
    recent.reverse()

    const allTurns: AiTurn[] = recent
      .filter((m) => m.content)
      .map((m) => ({
        role: m.senderId === bot.id ? 'model' : 'user',
        content: m.content!,
      }))
    
    // Ensure the very latest user message is included
    if (allTurns.length === 0 || allTurns[allTurns.length - 1].content !== currentUserContent) {
      allTurns.push({ role: 'user', content: currentUserContent })
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`

    // Retry loop with progressive history reduction on 429
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Reduce history size on each retry: 20 -> 10 -> 5 -> 2
      let historyLimit = HISTORY_LIMIT
      if (attempt === 2) historyLimit = 10
      if (attempt === 3) historyLimit = 5
      if (attempt > 3) historyLimit = 2
      
      // Take only the most recent messages (keep current user message)
      const turns = allTurns.slice(-historyLimit)
      
      const body = {
        contents: turns.map((t) => ({
          role: t.role,
          parts: [{ text: t.content }],
        })),
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        
        if (!res.ok) {
          const text = await res.text()
          logger.error({ status: res.status, text, attempt, historyLimit }, 'Gemini API error')
          
          // Handle 429 and 503 with retry and history reduction
          if (res.status === 429 || res.status === 503) {
            if (attempt < MAX_RETRIES) {
              const delay = INITIAL_DELAY_MS * (BACKOFF_MULTIPLIER ** (attempt - 1))
              const errorType = res.status === 429 ? 'rate limit' : 'high demand'
              logger.info({ attempt, delay, nextHistoryLimit: attempt === 1 ? 10 : (attempt === 2 ? 5 : 2) }, 
                `Retrying after ${res.status} error (${errorType}) with reduced history`)
              await new Promise(resolve => setTimeout(resolve, delay))
              continue // Retry with reduced history
            }
            // All retries exhausted
            const message = res.status === 429 
              ? 'AI đang quá tải, vui lòng thử lại sau vài phút.'
              : 'AI tạm thời không khả dụng do nhu cầu cao, vui lòng thử lại sau.'
            throw Object.assign(new Error(message), { status: res.status })
          }
          
          // Other errors: throw immediately without retry
          throw Object.assign(new Error('AI provider error.'), { status: 502 })
        }
        
        const data = (await res.json()) as any
        const reply: string =
          data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
        
        if (attempt > 1) {
          logger.info({ attempt, historyLimit }, 'Successfully generated reply after retry with reduced history')
        }
        
        return reply.trim() || '...'
      } catch (err: any) {
        // If error has status, it's already formatted - rethrow
        if (err.status) {
          // For 429, only rethrow if we've exhausted retries
          if (err.status === 429 && attempt < MAX_RETRIES) {
            const delay = INITIAL_DELAY_MS * (BACKOFF_MULTIPLIER ** (attempt - 1))
            logger.info({ attempt, delay, nextHistoryLimit: attempt === 1 ? 10 : (attempt === 2 ? 5 : 2) }, 
              'Retrying after 429 error with reduced history')
            await new Promise(resolve => setTimeout(resolve, delay))
            continue // Retry with reduced history
          }
          throw err
        }
        // Network or other errors
        logger.error({ err, attempt }, 'Gemini call failed')
        throw Object.assign(new Error('AI provider error.'), { status: 502 })
      }
    }

    // Should never reach here, but TypeScript needs it
    throw Object.assign(new Error('AI provider error.'), { status: 502 })
  }
}

export default new ChatbotService()
