import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
  async run() {
    await User.updateOrCreate(
      { email: 'admin@chatapp.com' },
      {
        name: 'Admin User',
        password: 'adminpassword',
        phone: '1111111111',
        verifiedAt: DateTime.now(),
        isAdmin: true,
        status: 'offline',
        accountStatus: 'active',
      }
    )
  }
}