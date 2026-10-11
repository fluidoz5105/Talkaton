# Talkaton project continuity

- Inspect the existing source and GitHub state before changes. Preserve existing functionality and do not replace this project with a scaffold.
- GitHub repository: https://github.com/fluidoz5105/Talkaton. Application root within that repository: `Talkaton Code/`.
- Free and Guest users must use Ollama for conversational text, including web-search synthesis and image captions. Derive access from the verified server-side account, never client-supplied plan fields. Preserve paid plans and their Ollama fallback.
- Use only server environment variables for credentials. Never commit `.env.local`, API keys, Vercel auth files or signing secrets.
- Run `npm test` and `npm run build` for a release. Preserve desktop download assets when publishing the existing project.
- Every published change must first be committed and pushed to this repository. Vercel must deploy the exact pushed Git commit. Do not publish local-only source uploads.
- Production project: `talkaton-tokn`; root directory `Talkaton Code`; production branch `main`. Use a branch preview until credentials and auth-email delivery are verified.
- See `DEPLOYMENT.md` for Ollama and signed Resend/Supabase hook setup.
