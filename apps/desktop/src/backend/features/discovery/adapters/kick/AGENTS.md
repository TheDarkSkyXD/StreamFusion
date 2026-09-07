# Kick discovery adapter

Use the shared Kick request transport for authenticated official API calls. Prefer documented `api.kick.com` routes and isolate any `kick.com/api/v1` or `v2` fallback with a reason. Do not add app-token or Worker-proxied data calls; the Worker is limited to OAuth exchange and refresh.
