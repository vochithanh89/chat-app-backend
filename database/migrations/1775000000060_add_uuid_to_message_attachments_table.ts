import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'message_attachments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.uuid('uuid').nullable()
    })
    this.schema.raw(
      `UPDATE ${this.tableName} SET uuid = UUID() WHERE uuid IS NULL`
    )
    this.schema.alterTable(this.tableName, (table) => {
      table.uuid('uuid').notNullable().unique().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('uuid')
    })
  }
}
