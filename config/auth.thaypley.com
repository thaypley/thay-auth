# auth.thaypley.com — thay homebase SPA (static) + API backend proxy.
# Static SPA served from /var/www/auth.thaypley.com; API paths proxy to Express.
server {
    listen 443 ssl;
    server_name auth.thaypley.com;

    root /var/www/auth.thaypley.com;
    index index.html;

    # ── API backend (Express thay-auth) ───────────────────────────────
    location ~ ^/(auth|devices|sessions|metrics)(/|$) {
        proxy_pass http://127.0.0.1:3749;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        client_max_body_size 6m;
    }

    # ── Static assets — long cache ────────────────────────────────────
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location /favicon.svg {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # ── Service worker / scrubber — MUST NEVER be cached ────────────
    # Cloudflare caches origin responses (max-age shown to it), and SW
    # updates go through the CDN. A stale sw.js (old bytecode, missing
    # header fixes) is served even on no-cache requests. Force origin
    # revalidation so browsers always fetch the newest SW on update.
    location ~ ^/(sw|scrub-beacon)(?:-v[0-9]+)?\.js$ {
        default_type application/javascript;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        try_files $uri =404;
    }

    # ── SPA fallback — every other path gets index.html. HTML is the
    # bootstrap pointing at hashed bundles + the service worker: it must
    # never be served stale, or clients keep the old bundle/SW forever.
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }

    ssl_certificate /etc/letsencrypt/live/auth.thaypley.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.thaypley.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# api.thaypley.com — thay-auth API backend (legacy alias, API JSON only)
server {
    server_name api.thaypley.com;

    location / {
        proxy_pass http://127.0.0.1:3749;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        client_max_body_size 1m;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/api.thaypley.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/api.thaypley.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

# auth.thaypley.com — redirect to HTTPS
server {
    listen 80;
    server_name auth.thaypley.com;
    return 301 https://$host$request_uri;
}

# api.thaypley.com — redirect to HTTPS
server {
    listen 80;
    server_name api.thaypley.com;
    return 301 https://$host$request_uri;
}
