<div align="center">
  <img src="apps/web/public/opengraph/banner.jpg" alt="Reactive Resume" />

  <h1>Reactive Resume</h1>

  <p>Reactive Resume is a free and open-source resume builder that makes it easy to create, update, and share your resume.</p>

  <p>
    <a href="./DEPLOYMENT.md"><strong>部署文档（中文）</strong></a>
    ·
    <a href="./docs/contributing/development.mdx"><strong>Development setup</strong></a>
  </p>

  <p>
    <img src="https://img.shields.io/github/package-json/v/mnzn12138/reactive-resume?style=flat-square" alt="Version">
    <img src="https://img.shields.io/github/license/mnzn12138/reactive-resume?style=flat-square" alt="License" />
  </p>
</div>

---

Pick a template, fill in your details, and export to PDF. You own your data: the codebase is open source under the MIT license, with no tracking, no ads, and no hidden costs.

This repository is a self-hosted fork. Creating and editing resumes requires an account — sign up on the login page, then promote the first account to administrator from the CLI. Full step-by-step instructions are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Features

**Resume Building**

- Live preview as you type
- Multiple export formats (PDF, JSON, DOCX, Markdown)
- Drag-and-drop section ordering
- Custom sections for any content type
- Rich text editor
- Undo and version history

**Templates**

- 15 templates to choose from
- A4 and Letter page sizes
- Customizable colors, fonts, and spacing
- Structured Style Rules for section and text styling

**Job Applications**

- Track applications through a pipeline with stages, tags, and notes
- Timeline per application
- Bulk update and CSV import

**Privacy & Control**

- Runs on your own infrastructure
- No tracking or analytics by default
- Full data export at any time
- Delete your data permanently with one click

**Extras**

- AI integration: Anthropic Claude, Cohere, DeepSeek, Fireworks, Google Gemini, Groq, Mistral AI, Ollama Cloud, OpenAI, OpenRouter, Perplexity, xAI Grok
- Multi-language interface (Simplified Chinese by default)
- Share resumes via unique links
- Import from JSON Resume format
- Dark mode
- Passkey and two-factor authentication
- MCP server for managing resumes and applications from an AI client

## Templates

<table>
  <tr>
    <td align="center">
      <img src="apps/web/public/templates/jpg/azurill.jpg" alt="Azurill" width="150" />
      <br /><sub><b>Azurill</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/bronzor.jpg" alt="Bronzor" width="150" />
      <br /><sub><b>Bronzor</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/chikorita.jpg" alt="Chikorita" width="150" />
      <br /><sub><b>Chikorita</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/ditto.jpg" alt="Ditto" width="150" />
      <br /><sub><b>Ditto</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="apps/web/public/templates/jpg/gengar.jpg" alt="Gengar" width="150" />
      <br /><sub><b>Gengar</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/glalie.jpg" alt="Glalie" width="150" />
      <br /><sub><b>Glalie</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/kakuna.jpg" alt="Kakuna" width="150" />
      <br /><sub><b>Kakuna</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/lapras.jpg" alt="Lapras" width="150" />
      <br /><sub><b>Lapras</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="apps/web/public/templates/jpg/leafish.jpg" alt="Leafish" width="150" />
      <br /><sub><b>Leafish</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/onyx.jpg" alt="Onyx" width="150" />
      <br /><sub><b>Onyx</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/pikachu.jpg" alt="Pikachu" width="150" />
      <br /><sub><b>Pikachu</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/rhyhorn.jpg" alt="Rhyhorn" width="150" />
      <br /><sub><b>Rhyhorn</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="apps/web/public/templates/jpg/ditgar.jpg" alt="Ditgar" width="150" />
      <br /><sub><b>Ditgar</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/meowth.jpg" alt="Meowth" width="150" />
      <br /><sub><b>Meowth</b></sub>
    </td>
    <td align="center">
      <img src="apps/web/public/templates/jpg/scizor.jpg" alt="Scizor" width="150" />
      <br /><sub><b>Scizor</b></sub>
    </td>
  </tr>
</table>

## Quick Start

Requires Node.js >= 24 and pnpm (pinned in `packageManager`). Docker is only used for the infrastructure services.

```bash
# Clone the repository
git clone https://github.com/mnzn12138/reactive-resume
cd reactive-resume

# Install dependencies
pnpm install

# Start the infrastructure (PostgreSQL, Redis, SeaweedFS)
docker compose -f compose.dev.yml up -d postgres redis seaweedfs seaweedfs_create_bucket

# Create your env file
cp .env.example .env
```

Edit `.env` before starting: the hostnames in `.env.example` are Docker service names, so change them to `localhost`, and replace `AUTH_SECRET` with a fresh random value.

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
S3_ENDPOINT="http://localhost:8333"
REDIS_URL="redis://localhost:6379"
AUTH_SECRET="<openssl rand -hex 32>"
```

Then start the dev server:

```bash
pnpm dev
```

Open <http://localhost:3000>. In dev mode Vite serves port 3000 and proxies API calls to the Hono server on port 3001, so you only ever need port 3000.

For the full walkthrough — including creating the first administrator, ops commands, and known pitfalls — see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Tech Stack

| Category         | Technology                      |
| ---------------- | ------------------------------- |
| Framework        | TanStack Start (React 19, Vite) |
| Runtime          | Node.js                         |
| Language         | TypeScript                      |
| Database         | PostgreSQL with Drizzle ORM     |
| API              | ORPC (Type-safe RPC)            |
| Auth             | Better Auth                     |
| Styling          | Tailwind CSS                    |
| UI Components    | Base UI + shadcn-style package  |
| State Management | Zustand + TanStack Query        |

## Documentation

The documentation source lives in [`docs/`](./docs) (Mintlify). It covers usage, self-hosting, and contributing:

| Guide                                                            | Description                             |
| ---------------------------------------------------------------- | --------------------------------------- |
| [Getting Started](./docs/getting-started.mdx)                    | First-time setup and basic usage        |
| [Development setup](./docs/contributing/development.mdx)         | Local development environment           |
| [Project architecture](./docs/contributing/architecture.mdx)     | Codebase structure and patterns         |
| [Exporting Your Resume](./docs/guides/exporting-your-resume.mdx) | PDF and JSON export options             |
| [Deployment guide (Chinese)](./DEPLOYMENT.md)                    | 本机部署、环境变量、管理员、运维命令     |

## Deployment

The application runs on the host via `pnpm dev` (or `pnpm build` followed by `pnpm start`). Docker is only used to run the three infrastructure services:

- **PostgreSQL** — Database for storing user data and resumes
- **Redis** — Stream and state for the AI agent workspace
- **SeaweedFS** — S3-compatible storage for file uploads

> **PDF generation** runs entirely client-side via `@react-pdf/renderer`. No Browserless, Chromium, or external print service is required, and the `PRINTER_*` / `BROWSERLESS_*` environment variables are no longer read.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment configuration, creating the first administrator, ops commands, and the acceptance checklist.

## Contributing

Every contribution helps, whether it is a typo fix or a new feature.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See the [development setup guide](./docs/contributing/development.mdx) for how to run the project locally.

## License

[MIT](./LICENSE) — do whatever you want with it.
