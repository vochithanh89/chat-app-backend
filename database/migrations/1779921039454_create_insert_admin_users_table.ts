import { BaseSchema } from '@adonisjs/lucid/schema'
import User from '#models/user'
import { DateTime } from 'luxon'

export default class extends BaseSchema {
  async up() {
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
        isPrivatePresence: false,
      }
    )
  }

  async down() {
    const user = await User.findBy('email', 'admin@chatapp.com')
    if (user) {
      await user.delete()
    }
  }
}