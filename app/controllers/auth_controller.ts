import User from '#models/user';
import { HttpContext } from '@adonisjs/core/http';
import mail from '@adonisjs/mail/services/main'
import VerifyEmailNotification from '#mails/verify_email_notification'
import { cuid } from '@adonisjs/core/helpers'
import { DateTime } from 'luxon'
import { userRegistrationValidator } from '#validators/user_registration'
import { userLoginValidator } from '#validators/user_login'

export default class AuthController {
    /**
     * @login
     * @operationId login
     * @description Authenticates a user and returns a JWT token.
     * @requestBody {"email": "string", "password": "string"}
     * @responseBody 200 - {"token": "string", "refreshToken": "string", "user": "User"}
     */
    public async login({ request, auth }: HttpContext) {
        const { email, password } = await request.validateUsing(userLoginValidator);
        const user = await User.verifyCredentials(email, password);
        return await auth.use('jwt').generate(user);
    }

    /**
     * @me
     * @operationId getAuthenticatedUser
     * @description Returns the authenticated user.
     * @responseBody 200 - <User>
     */
    public async me({ auth }: HttpContext) {
        return auth.use('jwt').getUserOrFail();
    }

    /**
     * @refresh
     * @operationId refreshToken
     * @description Refreshes a JWT token.
     * @requestBody {"token": "string"}
     * @responseBody 200 - {"token": "string", "refreshToken": "string", "user": "User"}
     */
    public async refresh({ request, auth }: HttpContext) {
        const refreshToken = request.input('token');
        const user = await auth.use('jwt').authenticateWithRefreshToken(refreshToken);
        const newToken = await auth.use('jwt').generate(user);
        const newRefreshToken = user.currentToken;

        return {
            token: newToken,
            refreshToken: newRefreshToken,
            ...user.serialize(),
        }
    }

    /**
     * @register
     * @operationId registerUser
     * @description Registers a new user and sends a verification email.
     * @requestBody {"name": "string", "email": "string", "password": "string", "password_confirmation": "string"}
     * @responseBody 201 - {"message": "string"}
     */
    public async register({ request, response }: HttpContext) {
        const payload = await request.validateUsing(userRegistrationValidator)

        const user = await User.create({
            ...payload,
            verificationToken: cuid(),
        })

        await mail.send(new VerifyEmailNotification(user, user.verificationToken!))

        return response.created({
            message: 'Registration successful. Please check your email for a verification link.',
        })
    }

    /**
     * @verifyEmail
     * @operationId verifyEmail
     * @description Verifies a user's email address.
     * @paramQuery token - The verification token.
     * @responseBody 200 - {"message": "string"}
     */
    public async verifyEmail({ request, response }: HttpContext) {
        const token = request.input('token')

        if (!token) {
            return response.badRequest({ message: 'Verification token is missing.' })
        }

        const user = await User.findBy('verificationToken', token)

        if (!user) {
            return response.badRequest({ message: 'Invalid verification token.' })
        }

        user.verifiedAt = DateTime.now()
        user.verificationToken = undefined
        await user.save()

        return response.ok({ message: 'Email verified successfully.' })
    }
}
