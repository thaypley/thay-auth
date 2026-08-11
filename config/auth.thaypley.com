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

    # ── SPA fallback — every other path gets index.html ───────────────
    location / {
        try_files $uri $uri/ /index.html;
    }

    ssl_certificate /etc/letsencrypt/live/auth.thaypley.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.thaypley.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# auth.thaypley.com — redirect to HTTPS
server {
    listen 80;
    server_name auth.thaypley.com;
    return 301 https://$host$request_uri;
}
