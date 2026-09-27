# Pattern Transfer

Keyword candidate builder for local service pages where the obvious keyword returns nothing.

It does not check volume. It builds the list you take to a volume tool.

Plain-language explanation with worked examples and a diagram: `about.html`.

---

# Which API key to use

**Short answer: Groq. Not Gemini.**

One run of this tool makes roughly **35 API calls** — one per stage, one per concept family, plus the
validation batches. That number is what decides which free tier works.

| Provider | Free limits (checked Sept 2026) | Runs per day | Card needed |
|---|---|---|---|
| **Groq** | ~30 requests/min, ~1,000/day | **~28** | No |
| Gemini **Flash-Lite** | 500/day | ~14 | No |
| Gemini **Flash** | **~20/day** | **less than one** | No |
| Cerebras | 1M tokens/day, 8K context cap | varies | No |
| OpenRouter free | 20/min, 50/day under 10 credits | ~1 | No |
| Mistral | 1B tokens/month but 2 requests/min | slow, ~18 min per run | No |

Google cut the Gemini free tier hard during 2026. As of September 2026 the Flash models allow about
**20 requests per day**, which is less than a single run. Flash-Lite still allows 500. So if you go
with Gemini, you must use a **Flash-Lite** model name, not Flash.

Groq is the better default: no card, roughly 30 requests a minute, about 1,000 a day, and it speaks
the standard OpenAI format so you are not locked in.

**Get a Groq key:** console.groq.com → sign in → API Keys → Create API Key.
**Get a Gemini key:** aistudio.google.com/apikey → Create API key.

Two warnings from the research, both worth taking seriously:

1. **Free-tier limits change without notice.** Google cut quotas 50 to 80 percent in December 2025
   and again in 2026. Check your live quota in the provider's console, not in any article.
2. **Providers delete free models silently.** Cerebras went from about a dozen free models to two in
   May 2026 and broke pipelines that had hardcoded a name. That is why the model name in this tool
   is an editable text field rather than a fixed dropdown. If a run suddenly fails with a model
   error, paste the current model name in and carry on.

**Privacy note:** Google states that content sent through the unpaid Gemini API can be used to improve
its products and may be seen by human reviewers. Keyword research is not sensitive, but do not push
client data through a free tier.

---

# What to host

Four files. That is the whole application. No build step, no framework, no database.

```
index.html          the tool
about.html          the explainer page
package.json        must NOT contain "type": "module"
api/generate.js     the serverless function that holds your key
```

---

# Part 1 — Put it on GitHub

### Through the website, no command line

1. Go to **github.com**, sign in.
2. Top right, **+** then **New repository**.
3. Name it `pattern-transfer`. Set it **Private**. Do not tick "Add a README".
4. **Create repository**.
5. Click **uploading an existing file**.
6. Drag in `index.html`, `about.html` and `package.json`. Not the api folder yet.
7. **Commit changes**.
8. Back on the repo page: **Add file** → **Create new file**.
9. In the filename box type exactly `api/generate.js`.
   Typing the slash is what creates the folder. If `generate.js` lands in the root instead, the tool
   fails with `Unexpected token '<'`.
10. Paste the contents of `api/generate.js`.
11. **Commit changes**.
12. Confirm the repo root now shows a folder called **api**.

### Or by command line

```bash
cd keyword-transfer-tool
git init
git add .
git commit -m "Pattern Transfer"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/pattern-transfer.git
git push -u origin main
```

---

# Part 2 — Deploy on Vercel

1. **vercel.com**, sign in with GitHub.
2. **Add New** → **Project**.
3. Find `pattern-transfer`, click **Import**.
4. Configure:
   - **Framework Preset:** Other
   - **Build Command:** leave empty
   - **Output Directory:** leave empty
   - **Install Command:** leave empty
5. Expand **Environment Variables** and add one of these:

   | Name | Value |
   |---|---|
   | `GROQ_API_KEY` | your Groq key — recommended |
   | `GEMINI_API_KEY` | your Gemini key — use a Flash-Lite model |
   | `OPENAI_API_KEY` + `OPENAI_BASE_URL` | any OpenAI-compatible provider |

   You can set more than one and switch between them in the tool.
   Leave all three environment boxes ticked.
6. **Deploy**, then **Visit**.

### Confirm it worked

On the live page, set **Who answers** to *My Vercel server key*, then press **Test connection**.
You want:

> **Connected.** Server keys available: **groq**

If you added the key after deploying, Vercel will not apply it to the existing build. Go to
**Deployments**, open the latest, three dots, **Redeploy**.

---

# Part 3 — Model names

| Provider | Paste this into the model field |
|---|---|
| Groq | `llama-3.3-70b-versatile` |
| Gemini | `gemini-3.5-flash-lite` |
| Cerebras | `gpt-oss-120b` |
| OpenRouter | any free model id from their catalogue |

The field is free text on purpose. When a provider retires a model, paste the new name in rather than
waiting for a code change.

---

# Part 4 — Using it

1. Fill in the service, the city and the state.
2. Add the second natural wording, for example `clothes dryer repair`. Optional, but it roughly
   doubles the location keyword set.
3. **Press "Analyse the service" in step 02 and confirm the scope.** Two short calls. The model
   works out what the machine is, which jobs belong here, and which neighbouring services must stay
   off the page. You then edit two boxes:
   - **Required terms** — every keyword must contain one. Kills fragments like `no heat`.
   - **Banned terms** — no keyword may contain one. Stops another appliance leaking in.

   There is a **Tell the model what to change** box. Plain English instructions override the model's
   own judgement, so you can write *keep stackable washer dryer terms* or *drop vent cleaning, it
   gets its own page*.

   The run stays locked until you confirm.
4. Paste one block per page you have already researched. Volume is optional.
5. Press **Scan pasted keywords**. Use **Drop all brands** or **Drop all proximity** if needed.
6. Untick concept families you do not need. Fewer families, fewer calls, faster run.
7. Leave **Final validation pass** ticked. It reads every keyword back against the scope and removes
   anything failing one of four tests: wrong service, not a search phrase, wrong intent, or
   cannibalises another page.
8. Press **Run** once.

---

# Troubleshooting

**`Unexpected token '<', "<!DOCTYPE "`**
`/api/generate` returned a web page, so the function is not running. Either `generate.js` is not
inside a folder called `api`, or you are opening the file locally. Workaround: switch *Who answers*
to a pasted key.

**Function running but no key**
Environment variable missing, or you have not redeployed since adding it.

**429 errors**
Rate limit. Raise the pause under Model settings. Groq is comfortable at 2200 ms, Gemini at 4500 ms.

**Ran out of quota mid-run**
Almost certainly Gemini Flash at 20/day. Switch to a Flash-Lite model or a Groq key.

**Model error**
The provider retired that model. Paste the current name into the model field.

**A reply gets cut short**
The tool detects it, retries that step asking for fewer items, and reports it. If it still fails it
skips that step rather than losing the run.

**Copy button does nothing**
It falls back to selecting the text and tells you to press Ctrl+C. Clicking any keyword block also
selects all of it.

---

# What comes out

**Section A — Mapped.** Direct ancestors only, each naming its source keyword and page.

**Section B — Expanded.** Never in your source list. Each family shows the concept your data proved,
what the research established, then the keywords.

**Section C — The gap.** Derived from the service itself, blind to A and B.

**Validation pass** and **Removed before the final list**, showing everything taken out and why.

**Master list** grouped by family, numbered, every keyword labelled mapped, expanded or orphan.

**Plain list** at the bottom, deduplicated, one per line, nothing else.

Export as Markdown, CSV or raw JSON.

---

# Limits

**It does not find volume.** Nothing can, below the tool floor. That is what the plain list is for.

**It does not verify anything.** Brands, error codes, statistics and regulations come back marked for
verification. Check before writing.

**It does not replace Search Console.** After 60 days live, the query report beats everything here.

**It is not a page generator.** It outputs candidates, not content.
