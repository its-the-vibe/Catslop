# Catslop

Catslop is a Cloudflare Workers app that automatically generates AI cat pictures on a schedule and serves them in a simple web gallery.

## Features

- Scheduled AI image generation using Workers AI
- Storage of generated images in Cloudflare R2
- Metadata tracking in Cloudflare D1
- Frontend gallery with click/tap image enlargement viewer

## Tech Stack

- Cloudflare Workers (frontend + cron worker)
- TypeScript
- Cloudflare Workers AI
- Cloudflare R2
- Cloudflare D1

## Requirements

- Node.js 20+ (recommended current LTS)
- npm 10+
- Cloudflare account
- Wrangler CLI (`npx wrangler` or global install)

## Project Structure

- `/frontend`: Worker that serves the image gallery and image files
- `/backend-cron`: Scheduled Worker that generates and stores new cat images

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/its-the-vibe/Catslop.git
   cd Catslop
   ```

2. Install Wrangler (choose one):

   ```bash
   npm install --global wrangler
   ```

   or run with `npx wrangler` in commands below.

3. Configure the frontend Worker:
   - Copy `/frontend/wrangler.example.json` to `/frontend/wrangler.json`.
   - Fill in your custom domain, R2 bucket, and D1 database values.

4. Configure the backend cron Worker:
   - Copy `/backend-cron/wrangler.example.json` to `/backend-cron/wrangler.json`.
   - Fill in your R2 bucket and D1 database values.

5. Create/apply D1 migrations for the backend project:

   ```bash
   cd backend-cron
   wrangler d1 migrations apply <database_name>
   cd ..
   ```

## Usage

### Run locally

Frontend:

```bash
cd frontend
wrangler dev
```

Backend cron worker (manual HTTP trigger while testing):

```bash
cd backend-cron
wrangler dev
```

Then call the backend worker URL once to generate an image manually.

### Deploy

Deploy frontend:

```bash
cd frontend
wrangler deploy
```

Deploy backend cron worker:

```bash
cd backend-cron
wrangler deploy
```

## Contributing

Issues and pull requests are welcome. Please include clear reproduction steps for bugs and concise descriptions for feature changes.
