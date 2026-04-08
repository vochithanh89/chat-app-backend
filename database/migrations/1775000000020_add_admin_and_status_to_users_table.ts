import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_admin').notNullable().defaultTo(false)
      table.enum('account_status', ['active', 'locked']).notNullable().defaultTo('active')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_admin')
      table.dropColumn('account_status')
    })
  }
}
