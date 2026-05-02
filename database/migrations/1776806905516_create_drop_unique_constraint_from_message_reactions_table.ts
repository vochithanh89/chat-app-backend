import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'message_reactions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index('message_id')
      table.index('user_id')
      table.dropUnique(['message_id', 'user_id', 'emoji'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.unique(['message_id', 'user_id', 'emoji'])
    })
  }
}