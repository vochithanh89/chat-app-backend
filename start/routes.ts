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
        router.post('/auth/login', [AuthController, 'login'])
        router.post('/auth/register', [AuthController, 'register'])
        router.get('/auth/verify-email', [AuthController, 'verifyEmail'])
        router.post('/auth/refresh', [AuthController, 'refresh'])

        router
            .group(() => {
                router.get('/auth', [AuthController, 'me'])
                router.get('/auth/me', [AuthController, 'meJwt'])
            })
            .use(middleware.auth({ guards: ['jwt'] }))
            .use(middleware.emailVerified());
    })
    .prefix('/api/v1')