import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tracks "delete on my side" — message stays in DB but is hidden for
 * the listed user. Recall (is_recalled on messages) is global.
 */
export default class extends BaseSchema {
  protected tableName = 'message_deletions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('message_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['message_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
