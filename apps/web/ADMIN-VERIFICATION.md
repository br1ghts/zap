# Admin verification checklist

1. **Configure allowlist.** Set `ADMIN_TWITCH_IDS="your-id"` or `ADMIN_USERNAMES="your-login"` before starting the web server so the guard can identify the admin broadcaster.
2. **Admin guard.** Start the app, log in with a non-allowlisted broadcaster, and visit `/admin`; verify the route returns `403 Forbidden` to prove unauthorized users cannot access it.
3. **Admin experience.** Log back in with an allowlisted broadcaster, visit `/admin`, and confirm:
   - The overview cards show total users, total clips, failure rate, and last 24h totals.
   - The top channels list and recent clip cards populate with data, including status pills and error `<details>`.
   - The users table shows connected/last-seen timestamps and token health pills without exposing token values.
4. **Clips filters/pagination.** In the Clips section:
   - Use the status dropdown, channel dropdown, or search box; the table should reload data via `/api/admin/clips`.
   - Use the Prev/Next buttons to change pages and confirm the data updates while respecting the API response.
5. **API endpoints.** While logged in as an admin, hit `/api/admin/summary`, `/api/admin/users`, and `/api/admin/clips` (with some filters) to ensure each returns JSON and honors the allowlist guard.

