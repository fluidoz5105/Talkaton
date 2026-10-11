# Talkaton publishing and service setup

The GitHub repository is https://github.com/fluidoz5105/Talkaton. Its application root is `Talkaton Code/`.
Production Vercel project: `talkaton-tokn` (`prj_lYtFuMMZ4TUz9yOgXI01adXO72g1`), team `fluidoz5105s-projects`.

## Publish from GitHub

1. Work in a checkout of the existing repository; preserve its history and the `Talkaton Code/` directory.
2. From the app directory run `npm test` and `npm run build`. The build updates service-worker cache versions.
3. Review the diff and commit the intended source changes. Never commit `.env.local`, `.vercel`, keys, or build caches.
4. Push the commit to GitHub. Use a branch preview until the required production services are configured.
5. In the existing Vercel project's Settings → Git, connect `fluidoz5105/Talkaton`; production branch `main`. In Build settings set Root Directory to `Talkaton Code`, build command `npm run build`, output directory `.`.
6. Verify the Vercel deployment is READY and its Git commit SHA matches the pushed commit. Test Guest and signed-in Free chat, paid chat, login emails, and existing downloads before production promotion.

Never publish a local-only Vercel upload. Every deployment must refer to a pushed Git commit. Do not replace the existing domain/project with a new project.

## Ollama

Free and Guest chat, search synthesis, and image captions use Ollama, enforced using the server-verified plan. Client-supplied plans/models cannot bypass this rule. Paid-plan fallback is preserved. Image generation and speech transcription still use their existing specialized providers. Free/Guest real-time OpenAI sessions are rejected; recorded voice conversations use the chat route and Ollama.

For the hosted setup, create an API key at https://ollama.com/settings/keys and save these in Vercel Environment Variables for Production and separately for Preview:

- `OLLAMA_API_KEY` — secret, never exposed in client code.
- `OLLAMA_BASE_URL=https://ollama.com/api`
- `OLLAMA_FALLBACK_MODEL=gemma4:31b` — or another model listed by the selected endpoint's `/api/tags`. The legacy variable name is retained for compatibility and configures Free/Guest as well as paid fallback.
- `GUEST_USAGE_SECRET` — independent random secret for stable quota identity hashes.

A self-hosted production endpoint requires a reachable HTTPS server with a token-protected proxy. Vercel cannot access Ollama running on your laptop's localhost. Cloud access is subject to the Ollama account's limits.

## Resend authentication emails

The existing Supabase signup, magic-link login, confirmation resend and password-reset calls are preserved. `POST /api/auth-email` implements Supabase's signed Send Email hook; it is not a public send-any-email endpoint.

1. Create/connect a Resend account. Verify a sending domain you own (for example a subdomain of `talkaton.org`) using Resend's exact DNS records. Do not replace existing mail records.
2. Create a sending API key, scoped to that domain when available. Set `RESEND_API_KEY` as a Vercel secret and `RESEND_FROM_EMAIL` to a sender on that verified domain (for example `Talkaton <auth@mail.talkaton.org>` only after verification).
3. In the existing Supabase project's Auth → Hooks, create a Send Email HTTPS hook pointing to `https://talkaton.org/api/auth-email`. Store its generated signing secret in Vercel as `SEND_EMAIL_HOOK_SECRET`. Set `SUPABASE_URL` to the existing project URL.
4. Redeploy the pushed commit with those variables. Only enable the Supabase hook after the endpoint is deployed and all credentials are configured; otherwise signup/login email delivery will fail. Existing Supabase email delivery remains in use while the hook is disabled.
5. Test with an account/email you control: signup, confirmation resend, login link, recovery and secure email change. Verify delivery in Resend. Do not use preview links for production auth emails.

The hook verifies raw-body HMAC signatures with a five-minute tolerance, restricts redirects to Talkaton origins, sends both secure-email-change confirmations, and uses per-event idempotency keys. It never returns or logs email tokens, keys, or Resend error bodies. No live email is sent by the automated tests.

References: https://docs.ollama.com/cloud, https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook, https://resend.com/docs/api-reference/emails/send-email.
