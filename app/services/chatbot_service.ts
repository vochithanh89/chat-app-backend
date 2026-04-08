import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import User from '#models/user'
import Message from '#models/message'

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
        // Random password — bot user is never used for login.
        password: Math.random().toString(36).slice(2) + Date.now(),
        bio: 'Built-in AI assistant powered by Google Gemini.',
      })
    }
    this.botUser = bot
    return bot
  }

  /**
   * Builds the chat history (oldest → newest) from the conversation, then
   * sends it to Gemini and returns the model reply.
   */
  async generateReply(conversationId: number, currentUserContent: string): Promise<string> {
    const apiKey = env.get('GEMINI_API_KEY')
    if (!apiKey) throw Object.assign(new Error('AI is disabled.'), { status: 503 })

    const model = env.get('GEMINI_MODEL') || 'gemini-1.5-flash'
    const bot = await this.getBotUser()

    const recent = await Message.query()
      .where('conversation_id', conversationId)
      .andWhere('is_recalled', false)
      .orderBy('id', 'desc')
      .limit(HISTORY_LIMIT)
    recent.reverse()

    const turns: AiTurn[] = recent
      .filter((m) => m.content)
      .map((m) => ({
        role: m.senderId === bot.id ? 'model' : 'user',
        content: m.content!,
      }))
    // Ensure the very latest user message is included even if it raced the query.
    if (turns.length === 0 || turns[turns.length - 1].content !== currentUserContent) {
      turns.push({ role: 'user', content: currentUserContent })
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`

    const body = {
      contents: turns.map((t) => ({
        role: t.role,
        parts: [{ text: t.content }],
      })),
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        logger.error({ status: res.status, text }, 'Gemini API error')
        throw Object.assign(new Error('AI provider error.'), { status: 502 })
      }
      const data = (await res.json()) as any
      const reply: string =
        data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? ''
      return reply.trim() || '...'
    } catch (err: any) {
      if (err.status) throw err
      logger.error({ err }, 'Gemini call failed')
      throw Object.assign(new Error('AI provider error.'), { status: 502 })
    }
  }
}

export default new ChatbotService()
