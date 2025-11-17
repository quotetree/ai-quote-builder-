# QuoteTree.ai

🚀 **AI-Powered Quote Builder** - Transform your estimating workflow from hours to minutes with conversational AI.

Generate professional quotes through natural chat conversations, manage your price book, and deliver branded PDFs—all in one streamlined platform.

---

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## ✨ Features

### Core Features (MVP)

- ✅ **User Authentication** - Secure sign up/sign in with Supabase Auth
- ✅ **Sidebar Navigation** - Toggle sidebar with search, price book access, and project list
- ✅ **Project Management** - Create and organize projects by product families
- ✅ **3-Panel Workspace** - Chat, Drive, and Log panels in one interface
- ✅ **AI Chat Interface** - Conversational quote generation with OpenAI GPT-4
- ✅ **Price Book** - CRUD operations for products with CSV bulk upload
- ✅ **Quote Log** - Version control for all generated quotes
- ✅ **PDF Export** - Professional, branded PDF quote downloads
- ✅ **Document Management** - Upload and store project files
- ✅ **Internal Analytics** - Event tracking with Supabase (no Google Analytics)
- ✅ **Profit Margin Display** - Real-time profit calculations based on cost pricing

### User Workflow

1. **Create Project** → Name your project and select product families
2. **Chat with AI** → Describe scope of work, AI asks clarifying questions
3. **Generate Quote** → AI creates quote with line items and pricing
4. **Review & Refine** → Make adjustments conversationally
5. **Commit to Log** → Save quote version to project log
6. **Download PDF** → Export professional quote for client

---

## 🛠 Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS |
| **Backend** | Supabase (Database, Auth, Storage, Events) |
| **AI** | OpenAI GPT-4 via API |
| **Orchestration** | LangChain / Vercel AI SDK |
| **Database** | PostgreSQL + pgvector (embeddings) |
| **Payments** | Stripe *(to be integrated)* |
| **Hosting** | Vercel |
| **Version Control** | GitHub |
| **Analytics** | Supabase event tracking (internal) |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.17 or later
- **npm** or **yarn**
- **Supabase account** ([supabase.com](https://supabase.com))
- **OpenAI API key** ([platform.openai.com](https://platform.openai.com))

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/quotetree/ai-quote-builder-.git
cd "quote-tree-ai "
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Copy the example file and fill in your credentials:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your keys:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

4. **Set up Supabase database**

Run the schema in your Supabase SQL editor:

```bash
# Copy the contents of supabase/schema.sql and run in Supabase SQL Editor
```

Or use the Supabase CLI:

```bash
supabase db push
```

5. **Create Supabase storage bucket & policies**

In your Supabase project dashboard:
- Go to **Storage**
- Create a new bucket named `project-files`
- Set it to **Private** (authenticated users only)
- Run the SQL in `supabase/migrations/20241113_add_project_files_storage_policies.sql`
  inside the SQL Editor to grant authenticated users upload/view/delete access
  to their own objects in that bucket
- Run `supabase/migrations/20241113_create_drive_folders_notes.sql` and
  `supabase/migrations/20241113_add_project_document_update_policy.sql` to add
  nested folders, notes, and document rename permissions

6. **Run the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Project Structure

```
quote-tree-ai/
├── app/                            # Next.js App Router
│   ├── (dashboard)/               # Dashboard routes (protected)
│   │   ├── projects/
│   │   │   ├── new/              # New project creation
│   │   │   └── [id]/             # Project workspace
│   │   ├── pricebook/            # Price book management
│   │   └── layout.tsx            # Dashboard layout with sidebar
│   ├── api/                       # API routes
│   │   ├── chat/                 # AI chat endpoint
│   │   └── quotes/
│   │       └── pdf/              # PDF generation
│   ├── auth/                      # Authentication pages
│   │   ├── signin/
│   │   ├── signup/
│   │   ├── callback/
│   │   └── signout/
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Landing page
│   └── globals.css                # Global styles
├── components/                     # React components
│   ├── Sidebar.tsx                # Navigation sidebar
│   ├── ProjectWorkspace.tsx       # 3-panel workspace container
│   ├── ChatPanel.tsx              # AI chat interface
│   ├── DrivePanel.tsx             # Document management
│   └── LogPanel.tsx               # Quote version log
├── lib/                           # Utilities
│   ├── supabase/                  # Supabase clients
│   │   ├── client.ts              # Browser client
│   │   ├── server.ts              # Server client
│   │   └── middleware.ts          # Auth middleware
│   └── analytics.ts               # Internal event tracking
├── hooks/                         # Custom React hooks
│   ├── useProjects.ts
│   ├── useProducts.ts
│   └── useQuotes.ts
├── types/                         # TypeScript types
│   ├── database.ts                # Database schema types
│   └── index.ts                   # Shared types
├── supabase/                      # Supabase config
│   └── schema.sql                 # Database schema
├── middleware.ts                  # Next.js middleware (auth)
├── tailwind.config.ts             # Tailwind config
├── tsconfig.json                  # TypeScript config
└── package.json                   # Dependencies
```

---

## 🗄 Database Schema

### Core Tables

| Table | Description |
|-------|-------------|
| `profiles` | User profiles extending auth.users |
| `product_families` | Product categories for projects |
| `products` | Price book items with pricing |
| `projects` | User projects |
| `chat_messages` | AI chat history per project |
| `project_documents` | Uploaded files (Drive) |
| `quotes` | Generated quotes (versions) |
| `quote_items` | Line items in quotes |
| `analytics_events` | Internal event tracking |

### Key Relationships

- Users have many Projects
- Projects have many Chat Messages, Documents, and Quotes
- Quotes have many Quote Items
- Products can be linked to Quote Items

See `supabase/schema.sql` for full schema with indexes and RLS policies.

---

## 🔐 Environment Variables

Create a `.env.local` file with the following:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI
OPENAI_API_KEY=sk-your-openai-key

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Optional: canonical domain used in generated share links
NEXT_PUBLIC_SHARE_BASE_URL=https://quotetree.ai
```

---

## 💻 Development

### Commands

```bash
# Development
npm run dev          # Start dev server on localhost:3000
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

# Type checking
npx tsc --noEmit     # Check TypeScript errors
```

### Code Style

- **Components**: Use functional components with TypeScript
- **State Management**: React hooks + Zustand for global state
- **Styling**: Tailwind utility classes
- **File Naming**: PascalCase for components, camelCase for utilities

### Git Workflow

```bash
# Feature branches
git checkout -b feature/your-feature-name

# Commit with conventional commits
git commit -m "feat: add price book CSV upload"
git commit -m "fix: resolve chat panel scroll issue"
git commit -m "docs: update README setup instructions"

# Push and create PR
git push origin feature/your-feature-name
```

---

## 🚢 Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Add environment variables in Vercel dashboard
5. Deploy!

Vercel will auto-deploy on every push to `main`.

### Environment Variables on Vercel

Add these in **Settings → Environment Variables**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SITE_URL` (your Vercel domain)
- `NEXT_PUBLIC_SHARE_BASE_URL` (optional share link domain)

---

## 📊 Analytics & Monitoring

QuoteTree.ai uses **internal analytics** via Supabase (no Google Analytics):

### Tracked Events

- User signup/login
- Project created/opened
- Quote generated/committed/downloaded
- Product created/updated
- CSV uploaded
- AI chat messages

View analytics in Supabase dashboard or build custom queries:

```sql
SELECT event_type, COUNT(*) as count
FROM analytics_events
WHERE user_id = 'your-user-id'
GROUP BY event_type;
```

---

## 🧪 Testing

*(Testing suite to be added)*

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e
```

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Submit a pull request

### Development Priorities

- [ ] Stripe payment integration
- [ ] Quote templates
- [ ] Multi-user collaboration (team licenses)
- [ ] Email notifications
- [ ] QuickBooks/Salesforce integrations

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 💬 Support

- **Email**: support@quotetree.ai
- **Issues**: [GitHub Issues](https://github.com/quotetree/ai-quote-builder-/issues)
- **Documentation**: Coming soon

---

## 🎯 Roadmap

### Phase 1 - MVP (Current)
- ✅ Core authentication
- ✅ Project management
- ✅ AI chat quote generation
- ✅ Price book CRUD
- ✅ PDF export

### Phase 2 - Enhancement
- [ ] Stripe billing
- [ ] Quote templates
- [ ] Email delivery
- [ ] Analytics dashboard

### Phase 3 - Scale
- [ ] Team collaboration
- [ ] API integrations (QuickBooks, Salesforce)
- [ ] Mobile app
- [ ] Advanced reporting

---

**Built with ❤️ for contractors, estimators, and trades professionals.**

Transform your quoting process today → [QuoteTree.ai](https://quotetree.ai)

