import User from '#models/user'
import { updateProfileValidator } from '#validators/update_profile'
import { updateStatusValidator } from '#validators/update_status'
import { updateAvatarValidator } from '#validators/update_avatar'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'

export default class UsersController {
    /**
     * @show
     * @operationId getUserById
     * @description Returns a user by ID.
     * @paramPath id - The ID of the user to retrieve.
     * @responseBody 200 - {"user": "User"}
     */
    public async show({ params }: HttpContext) {
        const user = await User.findOrFail(params.id)
        return { user }
    }

    /**
     * @update
     * @operationId updateUser
     * @description Updates a user's information.
     * @paramPath id - The ID of the user to update.
     * @requestBody {"name": "string"}
     * @responseBody 200 - {"user": "User"}
     */
    public async update({ params, request }: HttpContext) {
        const user = await User.findOrFail(params.id)
        const payload = await request.validateUsing(updateProfileValidator)
        user.merge(payload)
        await user.save()
        return { user }
    }

    /**
     * @updateAvatar
     * @operationId updateUserAvatar
     * @description Updates the authenticated user's avatar.
     * @requestBody {"avatar": "file"}
     * @responseBody 200 - {"user": "User"}
     */
    public async updateAvatar({ request, auth }: HttpContext) {
        const user = auth.user!
        const { avatar } = await request.validateUsing(updateAvatarValidator)

        await avatar.move(app.makePath('uploads'), {
            name: `${user.id}_${new Date().getTime()}.${avatar.extname}`
        })

        // Assuming you have an 'avatar_url' column on your User model
        // user.avatarUrl = `/uploads/${avatar.fileName}`
        await user.save()

        return { user }
    }

    /**
     * @updateStatus
     * @operationId updateUserStatus
     * @description Updates the authenticated user's status.
     * @requestBody {"status": "string"}
     * @responseBody 200 - {"user": "User"}
     */
    public async updateStatus({ request, auth }: HttpContext) {
        const user = auth.user!
        const { status } = await request.validateUsing(updateStatusValidator)
        // user.status = status
        await user.save()
        return { user }
    }

    /**
     * @updateProfile
     * @operationId updateUserProfile
     * @description Updates the authenticated user's profile.
     * @requestBody {"name": "string"}
     * @responseBody 200 - {"user": "User"}
     */
    public async updateProfile({ request, auth }: HttpContext) {
        const user = auth.user!
        const payload = await request.validateUsing(updateProfileValidator)
        user.merge(payload)
        await user.save()
        return { user }
    }

    /**
     * @me
     * @operationId getCurrentUser
     * @description Returns the authenticated user's information.
     * @responseBody 200 - {"user": "User"}
     */
    public async me({ auth }: HttpContext) {
        return { user: auth.user }
    }
}