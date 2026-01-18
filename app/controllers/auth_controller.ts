import User from '#models/user';
import { HttpContext } from '@adonisjs/core/http';
import mail from '@adonisjs/mail/services/main'
import VerifyEmailNotification from '#mails/verify_email_notification'
import { cuid } from '@adonisjs/core/helpers'
import { DateTime } from 'luxon'

export default class AuthController {
    public async login({ request, auth }: HttpContext) {
        const { email, password } = request.all();
        const user = await User.verifyCredentials(email, password);
        return await auth.use('jwt').generate(user);
    }

    public async me({ auth }: HttpContext) {
        return auth.getUserOrFail();
    }

    public async meJwt({ auth }: HttpContext) {
        return auth.use('jwt').getUserOrFail();
    }

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

    public async register({ request, response }: HttpContext) {
        const { email, password } = request.only(['email', 'password'])

        const user = await User.create({
            email,
            password,
            verificationToken: cuid(),
        })

        await mail.send(new VerifyEmailNotification(user, user.verificationToken!))

        return response.created({
            message: 'Registration successful. Please check your email for a verification link.',
        })
    }

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
