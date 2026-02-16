# Cloudflare Pages setup

So the wedding site (not "Hello World") is deployed:

1. **Create a Pages project** (not a Worker):
   - **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
   - Choose **GitHub** and the repo **galiddo/YehonantanAndHadar**
   - Click **Begin setup**

2. **Build settings:**
   - **Project name:** e.g. `yehonantan-and-hadar`
   - **Production branch:** `main`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Deploy command:** `true`
   - **Root directory:** leave empty or `/`

3. **Save and Deploy.** Your site will be at `https://<project-name>.pages.dev`

If you already have a **Worker** project (the one showing "Hello World"), that is separate. Use a new **Pages** project for this repo so the built site is served from `*.pages.dev`.
