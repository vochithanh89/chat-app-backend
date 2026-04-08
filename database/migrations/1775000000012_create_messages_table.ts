import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('conversation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('conversations')
        .onDelete('CASCADE')
      table
        .integer('sender_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.text('content').nullable()
      table
        .integer('reply_to_message_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('SET NULL')
      table
        .integer('forwarded_from_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('SET NULL')
      table.boolean('is_recalled').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['conversation_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
