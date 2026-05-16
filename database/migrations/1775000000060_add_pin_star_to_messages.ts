import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Pin fields on messages table
    this.schema.alterTable('messages', (table) => {
      table.boolean('is_pinned').notNullable().defaultTo(false)
      table.integer('pinned_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('pinned_at').nullable()
    })

    // Star table — per-user bookmarks
    this.schema.createTable('message_stars', (table) => {
      table.increments('id')
      table.integer('message_id').unsigned().notNullable().references('id').inTable('messages').onDelete('CASCADE')
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
      table.unique(['message_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('message_stars')
    this.schema.alterTable('messages', (table) => {
      table.dropColumn('is_pinned')
      table.dropColumn('pinned_by')
      table.dropColumn('pinned_at')
    })
  }
}
