# Authentication setup (real accounts)

The app uses **Supabase Auth** so only people you approve can sign in. You control who has access by creating their accounts yourself in the Supabase dashboard.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account).
2. Click **New project**, pick an org, name the project (e.g. “Rerate Assistant”), set a database password, and create the project.
3. In the sidebar: **Project Settings** (gear) → **API**.
4. Copy:
   - **Project URL** → use as `VITE_SUPABASE_URL`
   - **anon public** key → use as `VITE_SUPABASE_ANON_KEY`

## 2. Add env vars locally

In the project root, copy `.env.example` to `.env` (if you don’t already have a `.env`) and set:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Restart the dev server (`npm run dev`) after changing `.env`.

## 3. Disable public sign-up (only you create users)

1. In Supabase: **Authentication** → **Providers**.
2. Click **Email**.
3. Turn **OFF** “Enable Sign Up” (or leave it on if you want a request-access flow and will approve by creating the user manually anyway).

Result: new users can only be created by you in the dashboard (or via the API with the service role). No one can self-register.

## 4. Add approved users (accounts you control)

1. In Supabase: **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter the person’s **email** and a **password** (you can send them the password securely or use “Send invite” if you enable email confirmation).
4. Click **Create user**.

Only users that exist in this list can sign in. To remove access, delete or disable the user in the same **Users** page.

## 5. Deploying (Vercel, Netlify, etc.)

Add the same env vars in your host’s dashboard:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Redeploy after setting them. The app will use the same Supabase project, so the same approved users can log in in production.

## Optional: custom domain and redirects

If you use a custom domain or multiple URLs, in Supabase go to **Authentication** → **URL Configuration** and add your site URL(s) under **Redirect URLs** so Supabase allows redirects back to your app.
