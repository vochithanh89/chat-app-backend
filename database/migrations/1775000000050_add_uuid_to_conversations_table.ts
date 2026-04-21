import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'conversations'

  async up() {
    // Add the column as nullable first so existing rows can be backfilled.
    this.schema.alterTable(this.tableName, (table) => {
      table.uuid('uuid').nullable()
    })

    // Backfill existing rows with a MySQL UUID(). Safe to re-run — only
    // touches rows that don't already have a uuid.
    this.schema.raw(`UPDATE ${this.tableName} SET uuid = UUID() WHERE uuid IS NULL`)

    // Now enforce NOT NULL + UNIQUE.
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
