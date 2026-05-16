import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conversation_members'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_muted').notNullable().defaultTo(false)
      table.boolean('is_pinned').notNullable().defaultTo(false)
      table.integer('pin_order').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_muted')
      table.dropColumn('is_pinned')
      table.dropColumn('pin_order')
    })
  }
}
