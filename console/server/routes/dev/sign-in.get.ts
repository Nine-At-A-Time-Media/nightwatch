// GET /dev/sign-in?email=&return= -- the local stage's sign-in helper (handlers/dev.ts); 404 on any other stage.
import { bindingsOf, devSignInDeps } from '../../deps.js';
import { handleDevSignIn } from '../../handlers/dev.js';

export default defineEventHandler((event) => handleDevSignIn(toWebRequest(event), devSignInDeps(bindingsOf(event.context))));
