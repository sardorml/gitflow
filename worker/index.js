// Cloudflare Worker entry: static assets are served by Workers Assets;
// everything else (the /api/* backend) is proxied to a per-session
// Container running the Node + real-git playground server.
//
// Isolation model: a `gfp_sid` cookie names a Durable Object–backed
// container instance, so every visitor gets their own sandboxed repo.

import { Container } from '@cloudflare/containers';

export class PlaygroundContainer extends Container {
  defaultPort = 3333;
  sleepAfter = '15m';
}

const COOKIE = 'gfp_sid';

export default {
  async fetch(request, env) {
    const cookies = request.headers.get('Cookie') || '';
    let sid = (cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9-]{8,64})`)) || [])[1];
    const isNew = !sid;
    if (isNew) sid = crypto.randomUUID();

    const container = env.PLAYGROUND.getByName(sid);
    const response = await container.fetch(request);
    if (!isNew) return response;

    const headers = new Headers(response.headers);
    headers.append(
      'Set-Cookie',
      `${COOKIE}=${sid}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`
    );
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
