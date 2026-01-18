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

const AuthController = () => import('#controllers/auth_controller')

router.post('login', [AuthController, 'login'])
router.post('register', [AuthController, 'register'])
router.get('verify-email', [AuthController, 'verifyEmail'])
router.post('jwt/refresh', [AuthController, 'refresh'])

router
  .group(() => {
    router.get('/', [AuthController, 'me'])
    router.get('/me', [AuthController, 'meJwt'])
  })
  .use(middleware.auth({ guards: ['jwt'] }));