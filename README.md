# QuoteTree.ai

AI-Powered Quote Builder - Generate professional quotes with intelligent assistance.

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI API (for quote generation)

## Getting Started

### Prerequisites

- Node.js 18.17 or later
- npm or yarn
- Supabase account

### Installation

1. Clone the repository:
```bash
git clone https://github.com/quotetree/ai-quote-builder-.git
cd quote-tree-ai
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.local.example` to `.env.local`
   - Fill in your Supabase credentials
   - Add your OpenAI API key

4. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

```
quote-tree-ai/
├── app/                      # Next.js App Router pages
│   ├── auth/                # Authentication pages
│   │   ├── signin/         # Sign in page
│   │   ├── signup/         # Sign up page
│   │   ├── callback/       # OAuth callback handler
│   │   └── signout/        # Sign out route
│   ├── dashboard/          # Dashboard page
│   ├── quotes/             # Quote management pages
│   │   ├── new/           # Create new quote
│   │   └── page.tsx       # List all quotes
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   └── globals.css         # Global styles
├── lib/                     # Utility libraries
│   └── supabase/           # Supabase client utilities
│       ├── client.ts       # Browser client
│       ├── server.ts       # Server client
│       └── middleware.ts   # Auth middleware
├── components/              # Reusable React components (to be added)
├── types/                   # TypeScript type definitions (to be added)
├── middleware.ts            # Next.js middleware
├── tailwind.config.ts       # Tailwind configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Project dependencies
```

## Features

- ✅ User authentication (Sign up, Sign in, Sign out)
- ✅ Protected routes with middleware
- ✅ Modern, responsive UI with Tailwind CSS
- 🚧 AI-powered quote generation
- 🚧 Quote management (CRUD operations)
- 🚧 Quote templates
- 🚧 PDF export
- 🚧 Client management

## Environment Variables

Required environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
OPENAI_API_KEY=your-openai-api-key
```

## Supabase Setup

1. Create a new Supabase project
2. Enable Email authentication in Authentication settings
3. Set up the following tables (SQL will be provided in `/supabase` directory):
   - `profiles` - User profiles
   - `quotes` - Quote data
   - `quote_items` - Individual items in quotes
   - `clients` - Client information

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## License

MIT

## Support

For support, email support@quotetree.ai or open an issue in the repository.

