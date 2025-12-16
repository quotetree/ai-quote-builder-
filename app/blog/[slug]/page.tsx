import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Home, ChevronRight, Info, AlertTriangle, CheckCircle } from "lucide-react";
import { getBlogPost, getRelatedPosts, getAllBlogPosts } from "@/lib/blogPosts";
import { TableOfContentsItem } from "@/types/blog";
import BlogHeader from "@/components/blog/BlogHeader";
import ShareButtons from "@/components/blog/ShareButtons";
import TableOfContents from "@/components/blog/TableOfContents";
import RelatedPosts from "@/components/blog/RelatedPosts";
import NewsletterSignup from "@/components/blog/NewsletterSignup";
import ReadingProgressBar from "@/components/blog/ReadingProgressBar";
import { Toaster } from "react-hot-toast";
import React from "react";

interface BlogPostPageProps {
  params: Promise<{
    slug: string;
  }>;
}

// Generate static params for all blog posts
export async function generateStaticParams() {
  const posts = getAllBlogPosts();
  return posts.map((post) => ({
    slug: post.slug,
  }));
}

// Generate metadata for SEO
export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    return {
      title: "Post Not Found | QuoteTree Blog",
    };
  }

  return {
    title: `${post.title} | QuoteTree Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      authors: [post.author.name],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = getRelatedPosts(slug);

  // Generate table of contents from headings
  const tableOfContents: TableOfContentsItem[] = post.content
    .map((item, index) => ({ ...item, originalIndex: index }))
    .filter((item) => item.type === "heading")
    .map((item) => ({
      id: `heading-${item.originalIndex}`,
      text: item.text || "",
      level: item.level || 2,
    }));

  return (
    <>
      <Toaster position="top-center" />
      <ReadingProgressBar />
      <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
        {/* Header Navigation */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
          <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-1">
              <Image
                src="/quotetree-icon.svg"
                alt="QuoteTree Logo"
                width={56}
                height={56}
                className="w-14 h-14"
              />
              <span className="text-2xl font-medium text-green-700">QuoteTree</span>
            </Link>

            <div className="flex gap-4">
              <Link
                href="/blog"
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors font-medium"
              >
                Blog
              </Link>
              <Link
                href="/auth/signin"
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors font-medium"
              >
                Login
              </Link>
              <Link
                href="/auth/signup"
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all hover:shadow-lg font-medium"
              >
                Get Started
              </Link>
            </div>
          </nav>
        </header>

        {/* Breadcrumb */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
            <Link href="/" className="hover:text-green-600 transition-colors flex items-center gap-1">
              <Home className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/blog" className="hover:text-green-600 transition-colors">
              Blog
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-gray-900 font-medium line-clamp-1">{post.title}</span>
          </div>
        </div>

        {/* Main Content */}
        <article className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-20">
          <div className="grid lg:grid-cols-12 gap-8">
            {/* Share Buttons - Sticky on Desktop */}
            <div className="hidden lg:block lg:col-span-1">
              <div className="sticky top-24">
                <p className="text-sm font-semibold text-gray-700 mb-3 text-center">Share</p>
                <ShareButtons title={post.title} url={`/blog/${post.slug}`} />
              </div>
            </div>

            {/* Article Content */}
            <div className="lg:col-span-8">
              {/* Blog Header */}
              <BlogHeader post={post} />

              {/* Article Body */}
              <div className="prose prose-lg max-w-none">
                {post.content.map((item, index) => {
                  switch (item.type) {
                    case "heading":
                      const HeadingTag = `h${item.level}` as keyof React.JSX.IntrinsicElements;
                      return (
                        <HeadingTag
                          key={index}
                          id={`heading-${index}`}
                          className={`font-bold text-gray-900 ${
                            item.level === 2
                              ? "text-3xl mt-12 mb-6"
                              : "text-2xl mt-8 mb-4"
                          }`}
                        >
                          {item.text}
                        </HeadingTag>
                      );

                    case "paragraph":
                      return (
                        <p key={index} className="text-gray-700 leading-relaxed mb-6">
                          {item.text}
                        </p>
                      );

                    case "list":
                      return (
                        <ul key={index} className="list-disc pl-6 mb-6 space-y-2">
                          {item.items?.map((listItem, i) => (
                            <li key={i} className="text-gray-700 leading-relaxed">
                              {listItem}
                            </li>
                          ))}
                        </ul>
                      );

                    case "callout":
                      const calloutStyles = {
                        info: {
                          bg: "bg-blue-50",
                          border: "border-blue-200",
                          text: "text-blue-900",
                          icon: Info,
                          iconColor: "text-blue-600",
                        },
                        warning: {
                          bg: "bg-yellow-50",
                          border: "border-yellow-200",
                          text: "text-yellow-900",
                          icon: AlertTriangle,
                          iconColor: "text-yellow-600",
                        },
                        success: {
                          bg: "bg-green-50",
                          border: "border-green-200",
                          text: "text-green-900",
                          icon: CheckCircle,
                          iconColor: "text-green-600",
                        },
                      };

                      const style = calloutStyles[item.variant || "info"];
                      const Icon = style.icon;

                      return (
                        <div
                          key={index}
                          className={`${style.bg} ${style.border} border-l-4 p-6 rounded-r-lg mb-6`}
                        >
                          <div className="flex gap-3">
                            <Icon className={`w-6 h-6 flex-shrink-0 ${style.iconColor}`} />
                            <p className={`${style.text} leading-relaxed font-medium`}>
                              {item.text}
                            </p>
                          </div>
                        </div>
                      );

                    case "image":
                      return (
                        <div key={index} className="my-8">
                          <Image
                            src={item.src || ""}
                            alt={item.alt || ""}
                            width={800}
                            height={450}
                            className="rounded-lg shadow-lg"
                          />
                          {item.alt && (
                            <p className="text-sm text-gray-500 text-center mt-2">
                              {item.alt}
                            </p>
                          )}
                        </div>
                      );

                    default:
                      return null;
                  }
                })}
              </div>

              {/* Inline Newsletter Signup */}
              <NewsletterSignup inline />

              {/* Mobile Share Buttons */}
              <div className="lg:hidden mt-8 pt-8 border-t border-gray-200">
                <ShareButtons title={post.title} url={`/blog/${post.slug}`} />
              </div>

              {/* Related Posts */}
              <RelatedPosts posts={relatedPosts} />
            </div>

            {/* Sidebar - Table of Contents */}
            <aside className="lg:col-span-3">
              <TableOfContents items={tableOfContents} />
            </aside>
          </div>
        </article>

        {/* Footer */}
        <footer className="border-t border-gray-200 py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-4 gap-8 mb-8">
              <div>
                <Link href="/" className="flex items-center gap-1 mb-4">
                  <Image
                    src="/quotetree-icon.svg"
                    alt="QuoteTree Logo"
                    width={56}
                    height={56}
                    className="w-14 h-14"
                  />
                  <h3 className="text-2xl font-medium text-green-700">QuoteTree</h3>
                </Link>
                <p className="text-gray-600 text-sm">
                  AI-powered quote generation for modern contractors.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-4">Product</h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <Link href="/#features" className="text-gray-600 hover:text-gray-900">
                      Features
                    </Link>
                  </li>
                  <li>
                    <Link href="/#pricing" className="text-gray-600 hover:text-gray-900">
                      Pricing
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-4">Resources</h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <Link href="/blog" className="text-gray-600 hover:text-gray-900">
                      Blog
                    </Link>
                  </li>
                  <li>
                    <Link href="/#faq" className="text-gray-600 hover:text-gray-900">
                      FAQ
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-4">Legal</h4>
                <ul className="space-y-2 text-sm">
                  <li>
                    <Link href="#" className="text-gray-600 hover:text-gray-900">
                      Privacy Policy
                    </Link>
                  </li>
                  <li>
                    <Link href="#" className="text-gray-600 hover:text-gray-900">
                      Terms of Service
                    </Link>
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-8 text-center text-gray-600 text-sm">
              <p>&copy; 2025 QuoteTree. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

