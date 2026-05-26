import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('conversations', (table) => {
      table.boolean('approve_members').notNullable().defaultTo(false)
    })

    this.schema.createTable('group_join_requests', (table) => {
      table.increments('id').primary()
      table.integer('conversation_id').unsigned().references('id').inTable('conversations').onDelete('CASCADE').notNullable()
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE').notNullable()
      table.string('status', 20).notNullable().defaultTo('pending') // 'pending' | 'approved' | 'rejected'
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable('group_join_requests')
    this.schema.alterTable('conversations', (table) => {
      table.dropColumn('approve_members')
    })
  }
}
