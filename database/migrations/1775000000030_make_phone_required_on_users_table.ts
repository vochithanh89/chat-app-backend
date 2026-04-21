import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    // Backfill any pre-existing NULL phones with a unique placeholder so
    // the NOT NULL + UNIQUE constraints can be applied safely. The
    // placeholder uses the user id to guarantee uniqueness.
    this.schema.raw(`UPDATE users SET phone = CONCAT('_unset_', id) WHERE phone IS NULL`)

    this.schema.alterTable(this.tableName, (table) => {
      table.string('phone', 32).notNullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('phone', 32).nullable().alter()
    })
  }
}
