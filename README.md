# 🌍🦊 Planet B-612

> A tiny planet that grows with your travels, tended by a fox who waits for the stories you bring back.

Built for **SuperAI NEXT Hackathon · Singapore · June 2026**.

Powered by **[Vercel AI Gateway](https://vercel.com/d/ai-gateway)** · Deployed on **AWS App Runner**.

---

## What it is

Planet B-612 turns photos you take on the go into **3D models on a living planet**.
Snap a kaya toast or a Merlion → an AI fox identifies it, tells you the deep
local context, and adds a low-poly model to your planet's surface. Over time
the planet evolves, the fox writes Tabikaeru-style diary entries, and you can
share a 1080×1350 card of "today's finds" with one tap.

## The agent stack

Six specialized agents, orchestrated through a single planet context.
All LLM calls are routed through the **Vercel AI Gateway**, which gives us
provider-agnostic routing, real-time observability, and one-line model swaps.

| Agent | Role | Model (via Gateway) |
|---|---|---|
| 🧠 Orchestrator | Routes user input (message / photo / task / landmark) | — (in-app logic) |
| ✈️ Planner | SG local-guide brain — builds 30–90 min quests with depthAngle, time window, duration | `alibaba/qwen3-max` |
| 👁️ Vision | Identifies a photo into 1 of 20 categories + structured details (ingredients, sugar, address, MRT…) | `alibaba/qwen3-vl-instruct` |
| 📖 Story | Generates Insight (deep historical / cultural / data context) in the fox's voice | `alibaba/qwen3-max` |
| 🎁 Sponsor | Opportunistically injects real sponsored quests when keywords match | `alibaba/qwen3-max` |
| 🦊 Fox Life | Tabikaeru-style autonomous loop — the fox picks an activity, writes a diary | `alibaba/qwen3-max` |

> One **Orchestrator** routes intent into two pipelines (photo → Vision → Story, text → Planner → Sponsor) while **Fox Life** runs in its own timer-driven loop. See slide 5 of the pitch deck.

## Key features

- True 3D globe — quaternion trackball, 360° free rotation, momentum + idle drift
- Spherical non-overlap placement (great-circle spiral search)
- 20 hand-coded low-poly Three.js models (noodle bowl, fish, butterfly, temple dome, MBS triple-tower, kopi mug…)
- Context-aware Vision prompts with codex de-dupe + 3-stage resilient JSON parser
- Pure-Canvas 1080×1350 share card with planet ID, level, today's stats
- 100% localStorage — no backend storage, no accounts

## Tech stack

| Layer | Choice |
|---|---|
| LLM routing | **Vercel AI Gateway** — OpenAI-compatible, multi-provider |
| Vision model | `alibaba/qwen3-vl-instruct` |
| Text model | `alibaba/qwen3-max` |
| 3D rendering | **Three.js r128** |
| Frontend | Vanilla JS — no framework |
| Server | **Express** — a tiny proxy that adds auth + abort handling |
| Storage | `localStorage` — zero infrastructure |
| Hosting | **AWS App Runner** (auto-deploys from this GitHub repo) |

## Run locally

```bash
git clone https://github.com/zhsg2024-hub/AI-Planet-B612.git
cd AI-Planet-B612
npm install
cp .env.example .env
# Edit .env and add EITHER:
#   AI_GATEWAY_API_KEY=vck_xxx   (preferred — routes through Vercel AI Gateway)
#   QWEN_API_KEY=sk-xxx          (fallback — calls DashScope directly)
npm start                        # → http://localhost:3000
```

The server **auto-detects which key you set**:

```
🛰  LLM upstream: Vercel AI Gateway
    text   → alibaba/qwen3-max
    vision → alibaba/qwen3-vl-instruct
```

Get a Gateway key at <https://vercel.com/dashboard> → **AI Gateway** → **API Keys**.

## Deploy to AWS App Runner (production)

The repo includes `apprunner.yaml`, so deployment is mostly clicks.

1. **Get a Vercel AI Gateway API key** at <https://vercel.com/dashboard> →
   AI Gateway → API Keys → Create. Copy the `vck_...` token (and make sure
   you have credits or a payment method on file).
2. Open <https://console.aws.amazon.com/apprunner> → **Singapore (ap-southeast-1)**
   → **Create service**.
3. Source:
   - **Source code repository** → **GitHub** → Add new → Authorize →
     `zhsg2024-hub/AI-Planet-B612` → branch `main`
   - Deployment trigger: **Automatic**
   - Configure build: **Use a configuration file** ✅ (reads `apprunner.yaml`)
4. Service settings:
   - Service name: `planet-b612`
   - CPU / Memory: **0.25 vCPU / 0.5 GB** (plenty for this app)
   - Port: **3000**
   - **Environment variables**: `AI_GATEWAY_API_KEY = vck_xxx`
5. **Create & deploy** — first build takes ~5–8 minutes.

When the service goes green, your live URL is shown at the top of the page
(`https://xxxxxx.ap-southeast-1.awsapprunner.com`). Test by opening it and
uploading a photo — App Runner logs should show:

```
🛰  LLM upstream: Vercel AI Gateway
[Vision abc123] ✓ done in 2480ms, output 950 chars
```

Every `git push` to `main` triggers a fresh deploy automatically.

## Submission

| Item | Link / Path |
|---|---|
| **Source code** | <https://github.com/zhsg2024-hub/AI-Planet-B612> |
| **Live demo** | <https://ai-planet-b612-superai.vercel.app> |
| **Pitch deck** | [`PlanetB612_pitch.pptx`](./PlanetB612_pitch.pptx) — 7 slides, 16:9 |
| **Pitch deck (web)** | [`slides.html`](./slides.html) |
| **Hackathon** | [SuperAI NEXT Hackathon · DoraHacks](https://dorahacks.io/hackathon/next-hackathon/detail) |

### Sponsor integration · Top-5 eligibility

- ✅ **Vercel Hosting** — production app deployed at <https://ai-planet-b612-superai.vercel.app> (Singapore region).
- ✅ **Vercel AI Gateway** — `server.js` auto-routes LLM calls through `ai-gateway.vercel.sh` whenever `AI_GATEWAY_API_KEY` is set (see [`server.js`](./server.js#L9-L43)).
- ☐ **AWS** — `apprunner.yaml` is committed and ready; AWS App Runner deployment is the next step for full Top-5 ("running on AWS and Vercel") eligibility.
