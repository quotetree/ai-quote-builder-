export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  content: BlogContent[];
  author: {
    name: string;
    role: string;
    avatar?: string;
  };
  date: string;
  category: string;
  tags: string[];
  readTime: string;
  coverImage: string;
  featured?: boolean;
}

export interface BlogContent {
  type: 'heading' | 'paragraph' | 'list' | 'callout' | 'image';
  level?: 2 | 3; // For headings
  text?: string;
  items?: string[]; // For lists
  variant?: 'info' | 'warning' | 'success'; // For callouts
  src?: string; // For images
  alt?: string; // For images
}

export interface TableOfContentsItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface BlogCardProps {
  post: BlogPost;
  featured?: boolean;
}
