import User from '#models/user';
import { HttpContext } from '@adonisjs/core/http';
import mail from '@adonisjs/mail/services/main'
import VerifyEmailNotification from '#mails/verify_email_notification'
import { cuid } from '@adonisjs/core/helpers'
import { DateTime } from 'luxon'
import { userRegistrationValidator } from '#validators/user_registration'
import { userLoginValidator } from '#validators/user_login'
import db from '@adonisjs/lucid/services/db'
import { forgotPasswordValidator } from '#validators/forgot_password'
import { resetPasswordValidator } from '#validators/reset_password'
import ForgotPasswordNotification from '#mails/forgot_password_notification'
import { randomBytes } from 'crypto'

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

    /**
     * @forgotPassword
     * @operationId forgotPassword
     * @description Sends a password reset email to the user.
     * @requestBody {"email": "string"}
     * @responseBody 200 - {"message": "string"}
     */
    public async forgotPassword({ request, response }: HttpContext) {
        const { email } = await request.validateUsing(forgotPasswordValidator)
        const user = await User.findBy('email', email)

        if (!user) {
            return response.ok({ message: 'If your email is registered, you will receive a password reset link.' })
        }

        const token = randomBytes(32).toString('hex')
        await db.table('password_reset_tokens').insert({
            email: user.email,
            token: token,
            created_at: DateTime.now().toISO(),
        })

        await mail.send(new ForgotPasswordNotification(user, token))

        return response.ok({ message: 'Password reset email sent.' })
    }

    /**
     * @resetPassword
     * @operationId resetPassword
     * @description Resets the user's password.
     * @requestBody {"token": "string", "password": "string", "password_confirmation": "string"}
     * @responseBody 200 - {"message": "string"}
     */
    public async resetPassword({ request, response }: HttpContext) {
        const { token, password } = await request.validateUsing(resetPasswordValidator)

        const resetRequest = await db.from('password_reset_tokens').where('token', token).first()

        if (!resetRequest || DateTime.fromISO(resetRequest.created_at).plus({ minutes: 60 }) < DateTime.now()) {
            return response.badRequest({ message: 'Invalid or expired password reset token.' })
        }

        const user = await User.findBy('email', resetRequest.email)
        if (!user) {
            return response.badRequest({ message: 'User not found.' })
        }

        user.password = password
        await user.save()

        await db.from('password_reset_tokens').where('token', token).delete()

        return response.ok({ message: 'Password has been reset successfully.' })
    }
}
