import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'message_attachments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('message_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('messages')
        .onDelete('CASCADE')
      table
        .integer('uploaded_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('url', 1024).notNullable()
      table.enum('type', ['image', 'video', 'document', 'audio']).notNullable()
      table.string('file_name').nullable()
      table.string('mime_type').nullable()
      table.integer('file_size').unsigned().nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['message_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
