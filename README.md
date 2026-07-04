# Gitflow Playground 🌿 — Git School

Learn git by *doing* — a local app with three connected views and a lesson catalog:

- **Git School** — 9 guided lessons from beginner to advanced (first repo → inspection → undo → branching → merging → conflicts → team sync → history rewriting → the gitflow capstone). Each lesson rebuilds the playground into its own scenario server-side, then a driver.js tour guides you command by command — steps auto-advance when the repo state proves you did the action. A simulated teammate commits to the local remote so fetch/pull can be practiced for real.
- **Editor + preview** — edit one markdown file (`playground/README.md`) and watch it render live
- **Terminal** — a real git terminal, sandboxed inside `playground/`
- **Commit graph** — a gitflow-style visualization that animates in real time as you run commands, plus a *working directory → staging → HEAD* strip that makes the index visible

Everything is local. Nothing leaves your machine.

## Run

```sh
npm install
npm start          # → http://localhost:3333
```

`npm run dev` restarts the server on changes.

## How it works

- `server.js` runs real `git` (spawned, never a shell) inside `playground/`, and after every command returns a full repo-state snapshot: commit DAG, branches, tags, remotes, HEAD, status, in-progress merge/rebase.
- The frontend (`public/`, plain ES modules, no build step) re-renders from each snapshot; the graph tweens between states — new commits grow out of their parent, orphaned commits fade away after a `rebase`/`reset --hard`.
- A bare repo at `remote.git` lets you practice remotes locally:
  `git remote add origin ../remote.git && git push -u origin main`
- Guardrails: no `-C`/`--git-dir`/`--work-tree`, no `config --global`, no interactive editors (friendly hints instead), 15s command timeout.

Type `help` in the terminal for a guided tour, and use **Reset playground** (header) to start over. `playground/` and `remote.git/` are disposable and gitignored.

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sardorml/gitflow)

The repo ships a `render.yaml` blueprint that runs the Dockerfile (Node 22 + git) as a web service:

1. Click the button above (or Render dashboard → **New + → Blueprint** → this repo).
2. When prompted, paste your `GROQ_API_KEY` (from [console.groq.com](https://console.groq.com)) — leave it empty to run without the chat assistant.
3. Deploy. Render injects `PORT` automatically; the health check hits `/healthz`.

The blueprint sets `MULTI_SESSION=1`, so **every visitor gets their own isolated sandbox** (a `gfp_sid` cookie maps to a private `playground/` + `remote.git` pair). Idle sandboxes are wiped after an hour, and everything is ephemeral by design — a redeploy or restart starts everyone fresh, which is exactly what you want for a learning playground. On the free plan the service also spins down after ~15 minutes of inactivity, so the first visit after a quiet spell takes a few seconds to wake.
