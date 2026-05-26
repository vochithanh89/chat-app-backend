import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conversations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('comments_restricted').notNullable().defaultTo(false)
      table.string('invite_code', 32).nullable().unique()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('comments_restricted')
      table.dropColumn('invite_code')
    })
  }
}
