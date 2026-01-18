/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/


import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'
import AutoSwagger from "adonis-autoswagger";
import swagger from "#config/swagger";

const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')

// returns swagger in YAML
router.get("/swagger", async () => {
    return AutoSwagger.default.docs(router.toJSON(), swagger);
});

// Renders Swagger-UI and passes YAML-output of /swagger
router.get("/docs", async () => {
    return AutoSwagger.default.ui("/swagger", swagger);
    // return AutoSwagger.default.scalar("/swagger"); to use Scalar instead. If you want, you can pass proxy url as second argument here.
    // return AutoSwagger.default.rapidoc("/swagger", "view"); to use RapiDoc instead (pass "view" default, or "read" to change the render-style)
});

router
    .group(() => {
        // Auth routes
        router.post('/auth/login', [AuthController, 'login']).as('auth.login')
        router.post('/auth/register', [AuthController, 'register']).as('auth.register')
        router.post('/auth/refresh', [AuthController, 'refresh']).as('auth.refresh')
        router.get('/auth/verify-email', [AuthController, 'verifyEmail']).as('auth.verifyEmail')
        router.post('/auth/forgot-password', [AuthController, 'forgotPassword']).as('auth.forgotPassword')
        router.post('/auth/reset-password', [AuthController, 'resetPassword']).as('auth.resetPassword')

        router.group(() => {
            // User routes
            router.get('/user/me', [UsersController, 'me']).as('users.me')
            router.put('/user/profile', [UsersController, 'updateProfile']).as('users.updateProfile')
            router.get('/users/:id', [UsersController, 'show']).as('users.show')
            router.put('/users/:id', [UsersController, 'update']).as('users.update')
            router.put('/users/avatar', [UsersController, 'updateAvatar']).as('users.updateAvatar')
            router.put('/users/status', [UsersController, 'updateStatus']).as('users.updateStatus')
        }).use(middleware.auth({ guards: ['jwt'] })).use(middleware.emailVerified())
    })
    .prefix('/api/v1')