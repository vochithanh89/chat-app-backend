import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('bio').nullable()
      table.boolean('is_online').notNullable().defaultTo(false)
      table.timestamp('last_seen_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('bio')
      table.dropColumn('is_online')
      table.dropColumn('last_seen_at')
    })
  }
}
