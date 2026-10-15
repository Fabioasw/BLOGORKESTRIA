// ONLY for `npm run test:runtime`: local Workerd + D1, no remote deployment.
// Access JWT signatures are checked against an ephemeral LOCAL public key.
import { createLocalJWKSet } from 'jose';
import jwks from '../work/runtime-fixture-jwks.json' with { type: 'json' };
import { createWorker } from '../src/worker/index.ts';
import { authorize } from '../src/worker/security.ts';
const keys=createLocalJWKSet(jwks);
export default createWorker({authorize:(request,env)=>authorize(request,env,keys),verifyTurnstile:async()=>{}});
