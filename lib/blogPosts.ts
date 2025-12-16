import { BlogPost } from '@/types/blog';

export const blogPosts: BlogPost[] = [
  {
    slug: 'is-quotetree-built-for-security-installers',
    title: 'Is QuoteTree Built for Security Installers?',
    description: 'Discover how QuoteTree streamlines quote generation for security system installers with industry-specific features, product libraries, and AI-powered recommendations.',
    author: {
      name: 'Sam Bettencourt',
      role: 'Founder & CEO',
      avatar: '/quotetree-icon.svg',
    },
    date: 'December 15, 2025',
    category: 'Trade Specific',
    tags: ['Security Systems', 'Installation', 'Features'],
    readTime: '8 min read',
    coverImage: '/images/blog/security-installers-cover.png',
    featured: true,
    content: [
      {
        type: 'paragraph',
        text: 'If you\'re a security system installer, you know that creating accurate quotes is both critical and time-consuming. Between understanding client needs, selecting the right cameras, access control systems, and alarm components, then calculating costs with proper markup—it can easily eat up hours of your day. That\'s where QuoteTree comes in.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Built with Security Professionals in Mind',
      },
      {
        type: 'paragraph',
        text: 'While QuoteTree serves contractors across multiple industries, we\'ve invested heavily in making it the perfect solution for security installers. Our platform understands the unique challenges you face and provides tools specifically designed to address them.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Comprehensive Security Product Library',
      },
      {
        type: 'paragraph',
        text: 'QuoteTree comes preloaded with an extensive catalog of security-specific products from leading manufacturers:',
      },
      {
        type: 'list',
        items: [
          'IP and Analog Security Cameras (dome, bullet, PTZ, fisheye)',
          'Network Video Recorders (NVR) and Digital Video Recorders (DVR)',
          'Access Control Systems (card readers, keypads, biometric scanners)',
          'Alarm Panels and Sensors (motion detectors, glass break, door/window contacts)',
          'Video Intercoms and Entry Systems',
          'Cabling and Infrastructure (Cat6, coax, power supplies, POE switches)',
          'Mounting Hardware and Enclosures',
        ],
      },
      {
        type: 'callout',
        variant: 'info',
        text: 'Industry Insight: The average security installation quote includes 15-20 line items across cameras, recording equipment, and access control. QuoteTree\'s AI can generate these recommendations in under 2 minutes based on your project scope.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'AI That Speaks Your Language',
      },
      {
        type: 'paragraph',
        text: 'Our AI assistant is trained on thousands of security installations. When you describe a project—whether it\'s a retail store needing perimeter coverage and POS monitoring, or a warehouse requiring 360-degree visibility—QuoteTree understands the context.',
      },
      {
        type: 'paragraph',
        text: 'For example, tell QuoteTree: "I need to quote a 5,000 sq ft retail store with 4 entry points, cash registers at the front, and a stock room in the back." The AI will automatically recommend:',
      },
      {
        type: 'list',
        items: [
          'Appropriate camera types and counts for each area',
          'Recording equipment with adequate storage for your retention requirements',
          'Access control for employee-only areas',
          'Proper network infrastructure to support the system',
          'All necessary cabling, mounts, and power supplies',
        ],
      },
      {
        type: 'heading',
        level: 2,
        text: 'Common Security Installation Scenarios',
      },
      {
        type: 'paragraph',
        text: 'QuoteTree excels at these typical security projects:',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Retail Store Security',
      },
      {
        type: 'paragraph',
        text: 'Perfect for stores needing both loss prevention and employee monitoring. QuoteTree recommends high-resolution cameras for POS areas, wide-angle coverage for sales floors, and discrete cameras for stock rooms.',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Office Access Control',
      },
      {
        type: 'paragraph',
        text: 'From simple door strikes to comprehensive multi-door systems with badge readers and integration with HR systems. QuoteTree helps you quickly quote the right components and calculate installation labor.',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Warehouse & Industrial',
      },
      {
        type: 'paragraph',
        text: 'Large spaces requiring strategic camera placement for loading docks, inventory areas, and perimeter security. QuoteTree factors in longer cable runs and environmental considerations.',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Multi-Tenant Properties',
      },
      {
        type: 'paragraph',
        text: 'Apartment buildings and office complexes with common areas, entry systems, and parking lot coverage. QuoteTree helps you create detailed quotes that break down costs by area or tenant responsibility.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Real-Time Markup Management',
      },
      {
        type: 'paragraph',
        text: 'Security installers typically work with different margin structures for equipment vs. labor, and often need to adjust pricing based on project size or client relationships. QuoteTree makes this effortless:',
      },
      {
        type: 'list',
        items: [
          'Set different markup percentages for cameras, recording equipment, and accessories',
          'Create preset markup profiles (e.g., "Standard Commercial", "Property Management", "Emergency Service")',
          'Apply discounts to entire quotes or individual line items',
          'See your margin and profit in real-time as you adjust pricing',
        ],
      },
      {
        type: 'callout',
        variant: 'success',
        text: 'Pro Tip: Many successful security installers maintain 30-40% margins on equipment and 50-60% on labor. QuoteTree\'s preset markup profiles help you maintain consistent, profitable pricing across all your quotes.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Custom Price Books for Your Distributors',
      },
      {
        type: 'paragraph',
        text: 'Every security installer has preferred distributors with negotiated pricing. QuoteTree lets you import your actual distributor price lists via CSV, ensuring your quotes reflect your real costs and maintain your target margins.',
      },
      {
        type: 'paragraph',
        text: 'You can maintain multiple price books for different distributors and switch between them depending on product availability or project requirements.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Professional Quote Generation',
      },
      {
        type: 'paragraph',
        text: 'First impressions matter. QuoteTree generates professional PDF quotes that include:',
      },
      {
        type: 'list',
        items: [
          'Your company branding and logo',
          'Detailed line items with product specifications',
          'Clear pricing breakdown',
          'System diagrams and coverage maps (coming soon)',
          'Terms and conditions',
          'Professional formatting that wins client confidence',
        ],
      },
      {
        type: 'heading',
        level: 2,
        text: 'Team Collaboration Features',
      },
      {
        type: 'paragraph',
        text: 'For security companies with multiple estimators or project managers, QuoteTree\'s organization plan enables:',
      },
      {
        type: 'list',
        items: [
          'Shared price books across your team',
          'Centralized quote history and project tracking',
          'Consistent pricing and markup standards',
          'Role-based permissions for estimators vs. managers',
        ],
      },
      {
        type: 'heading',
        level: 2,
        text: 'The Bottom Line',
      },
      {
        type: 'paragraph',
        text: 'Yes, QuoteTree is absolutely built for security installers. Whether you\'re a one-person operation quoting small residential jobs or a growing security company handling commercial and enterprise projects, QuoteTree provides the tools you need to quote faster, more accurately, and more professionally.',
      },
      {
        type: 'callout',
        variant: 'info',
        text: 'The average security installer saves 5-7 hours per week using QuoteTree. That\'s more time for installations, client meetings, or simply enjoying better work-life balance.',
      },
      {
        type: 'paragraph',
        text: 'Ready to see how QuoteTree can transform your security installation business? Start your free trial today—no credit card required. Create your first quote in under 5 minutes and experience the difference.',
      },
    ],
  },
  {
    slug: 'how-to-create-your-own-price-book',
    title: 'How to Create Your Own Price Book in QuoteTree',
    description: 'A comprehensive step-by-step guide to building and managing custom price books in QuoteTree, complete with best practices for maintaining profitable margins.',
    author: {
      name: 'Sam Bettencourt',
      role: 'Founder & CEO',
      avatar: '/quotetree-icon.svg',
    },
    date: 'December 10, 2025',
    category: 'Use Cases',
    tags: ['Price Books', 'Tutorial', 'Best Practices'],
    readTime: '10 min read',
    coverImage: '/images/blog/price-book-cover.png',
    featured: false,
    content: [
      {
        type: 'paragraph',
        text: 'A well-organized price book is the foundation of profitable, efficient quoting. It ensures consistency across your estimates, maintains your target margins, and dramatically speeds up the quote creation process. This guide will walk you through creating your first price book in QuoteTree and share best practices we\'ve learned from thousands of successful contractors.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'What Is a Price Book and Why You Need One',
      },
      {
        type: 'paragraph',
        text: 'A price book is your personalized product catalog with your actual costs from distributors or suppliers. Instead of looking up prices each time you create a quote, everything is pre-loaded and ready to use. More importantly, it allows you to:',
      },
      {
        type: 'list',
        items: [
          'Maintain consistent pricing across all quotes',
          'Apply your markup strategies automatically',
          'Update prices from distributors in bulk',
          'Track which products you use most frequently',
          'Ensure you\'re using current, accurate costs',
          'Speed up quote creation by 10x or more',
        ],
      },
      {
        type: 'callout',
        variant: 'warning',
        text: 'Common Mistake: Many contractors quote using outdated prices or forget to include certain costs. A properly maintained price book eliminates these costly errors and ensures profitability on every job.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Before You Start: Gather Your Information',
      },
      {
        type: 'paragraph',
        text: 'Before creating your price book in QuoteTree, collect the following:',
      },
      {
        type: 'list',
        items: [
          'Current price lists from your primary distributors (PDF or CSV format)',
          'Your typical markup percentages for different product categories',
          'Product SKUs or model numbers for items you use regularly',
          'Any special negotiated pricing or volume discounts',
          'Labor rates for different types of work',
        ],
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 1: Access the Price Book Manager',
      },
      {
        type: 'paragraph',
        text: 'From your QuoteTree dashboard, navigate to the Price Book section:',
      },
      {
        type: 'list',
        items: [
          'Click on your profile icon in the sidebar',
          'Select "Price Book" from the menu',
          'Click "Create New Price Book" or "Import Products"',
        ],
      },
      {
        type: 'paragraph',
        text: 'You can maintain multiple price books for different distributors or product lines. This is especially useful if you have a primary distributor for most items and specialty suppliers for specific products.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 2: Choose Your Import Method',
      },
      {
        type: 'paragraph',
        text: 'QuoteTree offers two methods for building your price book:',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Method A: CSV Import (Recommended)',
      },
      {
        type: 'paragraph',
        text: 'If your distributor provides price lists in Excel or CSV format, this is the fastest method:',
      },
      {
        type: 'list',
        items: [
          'Download your distributor\'s price list',
          'Ensure it contains columns for: Product Name, SKU, Description, Cost, and Category',
          'Click "Import from CSV" in QuoteTree',
          'Map the columns from your file to QuoteTree\'s fields',
          'Review and import (typically 500+ products in under 2 minutes)',
        ],
      },
      {
        type: 'callout',
        variant: 'info',
        text: 'Pro Tip: Most distributors can provide price lists in CSV format upon request. If they only offer PDF catalogs, tools like Tabula can help extract data into CSV format.',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Method B: Manual Entry',
      },
      {
        type: 'paragraph',
        text: 'For smaller product catalogs or specialty items, you can add products manually:',
      },
      {
        type: 'list',
        items: [
          'Click "Add Product" in your price book',
          'Enter product name, SKU, description',
          'Input your cost',
          'Assign a category',
          'Add any notes or specifications',
          'Save and repeat for additional products',
        ],
      },
      {
        type: 'paragraph',
        text: 'Manual entry works well for labor rates, service charges, or unique custom products you frequently quote.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 3: Organize with Categories',
      },
      {
        type: 'paragraph',
        text: 'Proper categorization makes products easy to find and enables category-specific markup strategies. We recommend organizing by product type:',
      },
      {
        type: 'list',
        items: [
          'Cameras (IP Cameras, Analog Cameras, PTZ Cameras)',
          'Recording Equipment (NVRs, DVRs, Video Servers)',
          'Access Control (Card Readers, Controllers, Strikes/Locks)',
          'Alarm Systems (Panels, Sensors, Keypads)',
          'Network Equipment (Switches, Routers, POE Injectors)',
          'Cabling & Infrastructure (Cat6, Coax, Connectors)',
          'Mounting Hardware',
          'Power Supplies & Accessories',
          'Labor (Installation, Programming, Training)',
        ],
      },
      {
        type: 'paragraph',
        text: 'Good categorization also helps QuoteTree\'s AI make better product recommendations when you describe projects.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 4: Set Your Markup Strategy',
      },
      {
        type: 'paragraph',
        text: 'This is where profitability is won or lost. QuoteTree allows you to set default markup percentages at multiple levels:',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Category-Level Markups',
      },
      {
        type: 'paragraph',
        text: 'Set different margins for different product types based on market rates and your business model:',
      },
      {
        type: 'list',
        items: [
          'Equipment: 25-40% (lower margin, higher volume)',
          'Specialty items: 40-60% (higher margin, more value)',
          'Labor: 50-100% (accounts for overhead, insurance, expertise)',
          'Consumables: 30-50% (wire, connectors, misc items)',
        ],
      },
      {
        type: 'heading',
        level: 3,
        text: 'Product-Level Overrides',
      },
      {
        type: 'paragraph',
        text: 'Some products warrant custom pricing. For example, you might:',
      },
      {
        type: 'list',
        items: [
          'Apply lower margins to high-ticket items to remain competitive',
          'Increase margins on commoditized products where clients won\'t compare',
          'Price strategically on products where you have unique expertise',
        ],
      },
      {
        type: 'callout',
        variant: 'success',
        text: 'Best Practice: Start with conservative margins and adjust based on your win rate. If you\'re closing 70%+ of quotes, you likely have room to increase margins. If you\'re below 30%, you may need to sharpen your pricing or emphasize value over cost.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 5: Create Markup Presets',
      },
      {
        type: 'paragraph',
        text: 'QuoteTree\'s markup presets let you save different pricing strategies for different client types or project sizes:',
      },
      {
        type: 'list',
        items: [
          '"Standard Commercial": Your baseline pricing for most projects',
          '"Property Management": Reduced margins for repeat, large-volume clients',
          '"Emergency Service": Premium pricing for rush jobs',
          '"Government/Municipal": Pricing aligned with prevailing wage requirements',
          '"Residential Premium": Higher service margins for homeowner projects',
        ],
      },
      {
        type: 'paragraph',
        text: 'When creating a quote, simply select the appropriate preset, and all markups are applied automatically. You can still adjust individual line items if needed.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 6: Keep Your Price Book Current',
      },
      {
        type: 'paragraph',
        text: 'Distributor prices change regularly. Build a habit of updating your price book:',
      },
      {
        type: 'list',
        items: [
          'Quarterly: Full price list refresh from distributors',
          'Monthly: Check commonly used products for price changes',
          'Ad-hoc: Update immediately when you discover outdated pricing',
          'Annual: Review and remove discontinued products',
        ],
      },
      {
        type: 'paragraph',
        text: 'QuoteTree makes updates easy—simply re-import your CSV, and it will update existing products while preserving your markup settings.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Step 7: Managing Multiple Price Books',
      },
      {
        type: 'paragraph',
        text: 'As your business grows, you might maintain multiple price books:',
      },
      {
        type: 'list',
        items: [
          'Primary Distributor: Your main source for 80% of products',
          'Secondary Distributor: Backup pricing or regional alternatives',
          'Specialty Supplier: High-end or niche products',
          'Labor & Services: Your internal rates and services',
        ],
      },
      {
        type: 'paragraph',
        text: 'When creating quotes, you can pull products from multiple price books. QuoteTree will show you which book each product comes from, helping you make informed sourcing decisions.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Best Practices for Price Book Success',
      },
      {
        type: 'paragraph',
        text: 'After working with thousands of contractors, here are the habits that separate profitable, efficient businesses from those constantly struggling with quotes:',
      },
      {
        type: 'heading',
        level: 3,
        text: '1. Start Small, Expand Over Time',
      },
      {
        type: 'paragraph',
        text: 'Don\'t try to import your distributor\'s entire 10,000-item catalog. Start with the 100-200 products you use most frequently. You can always add more as needed.',
      },
      {
        type: 'heading',
        level: 3,
        text: '2. Use Descriptive Product Names',
      },
      {
        type: 'paragraph',
        text: 'Instead of cryptic model numbers, use searchable descriptions: "4MP Dome Camera with IR" is better than "DS-2CD2143G0-I" for quick searching.',
      },
      {
        type: 'heading',
        level: 3,
        text: '3. Include Your Labor Rates',
      },
      {
        type: 'paragraph',
        text: 'Add labor items to your price book (e.g., "Security Camera Installation - Per Unit", "Access Control Programming - Hourly"). This ensures you never forget to include labor in your quotes.',
      },
      {
        type: 'heading',
        level: 3,
        text: '4. Document Your Markups',
      },
      {
        type: 'paragraph',
        text: 'In the notes field for each product or category, document why you chose that markup percentage. This helps maintain consistency as your team grows.',
      },
      {
        type: 'heading',
        level: 3,
        text: '5. Review Your Most-Quoted Products',
      },
      {
        type: 'paragraph',
        text: 'QuoteTree tracks which products appear most frequently in your quotes. Periodically review this data to ensure your most common items have the most competitive pricing and up-to-date information.',
      },
      {
        type: 'callout',
        variant: 'info',
        text: 'Time Savings: Contractors with well-maintained price books create quotes in 10-15 minutes that previously took 2-3 hours. That\'s a 12x improvement in efficiency.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Troubleshooting Common Issues',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Issue: CSV Import Fails',
      },
      {
        type: 'paragraph',
        text: 'Ensure your CSV file uses standard encoding (UTF-8) and has clear column headers. Remove any special characters or formatting from Excel before saving as CSV.',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Issue: Products Not Appearing in Quotes',
      },
      {
        type: 'paragraph',
        text: 'Check that products are marked as "Active" in your price book. Inactive products won\'t appear in searches or AI recommendations.',
      },
      {
        type: 'heading',
        level: 3,
        text: 'Issue: Margins Too Low/High',
      },
      {
        type: 'paragraph',
        text: 'Review your industry benchmarks and local market conditions. QuoteTree\'s preset templates are starting points—adjust them based on your actual win rates and profitability.',
      },
      {
        type: 'heading',
        level: 2,
        text: 'Ready to Build Your Price Book?',
      },
      {
        type: 'paragraph',
        text: 'Creating your first price book takes 30-60 minutes for most contractors, but it\'s an investment that pays dividends every single day. You\'ll quote faster, more accurately, and more profitably.',
      },
      {
        type: 'paragraph',
        text: 'If you haven\'t already, start your free trial of QuoteTree today. Our onboarding team can help you get your price book set up during your first week—book a free setup call when you sign up.',
      },
      {
        type: 'callout',
        variant: 'success',
        text: 'Next Steps: Once your price book is set up, learn how to use QuoteTree\'s AI chat to create your first quote in under 5 minutes. Check out our "Getting Started" video tutorial in your dashboard.',
      },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export function getAllBlogPosts(): BlogPost[] {
  return blogPosts;
}

export function getFeaturedPosts(): BlogPost[] {
  return blogPosts.filter((post) => post.featured);
}

export function getRelatedPosts(currentSlug: string, limit: number = 2): BlogPost[] {
  const currentPost = getBlogPost(currentSlug);
  if (!currentPost) return [];

  // Find posts with matching tags or category
  const related = blogPosts
    .filter((post) => post.slug !== currentSlug)
    .map((post) => {
      let score = 0;
      // Same category gets higher score
      if (post.category === currentPost.category) score += 3;
      // Matching tags
      const matchingTags = post.tags.filter((tag) =>
        currentPost.tags.includes(tag)
      );
      score += matchingTags.length;
      return { post, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.post);

  return related;
}
