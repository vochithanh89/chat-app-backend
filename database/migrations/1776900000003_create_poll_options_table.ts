import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'poll_options'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('uuid', 36).notNullable().unique()
      table
        .integer('poll_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('polls')
        .onDelete('CASCADE')
      table.string('text', 300).notNullable()
      table.integer('position').notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['poll_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
