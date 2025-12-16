"use client";

import Link from "next/link";
import Image from "next/image";
import { Clock, Calendar } from "lucide-react";
import { BlogCardProps } from "@/types/blog";

export default function BlogCard({ post, featured = false }: BlogCardProps) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-200"
    >
      {/* Cover Image */}
      <div className="relative h-48 overflow-hidden bg-gray-200">
        <div className="absolute inset-0 bg-gradient-to-br from-green-600 to-emerald-600 flex items-center justify-center">
          <span className="text-white text-6xl opacity-20">📝</span>
        </div>
        {/* Placeholder for actual images - you can replace with real images */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Category Badge */}
        <div className="mb-3">
          <span className="inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
            {post.category}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-green-600 transition-colors">
          {post.title}
        </h3>

        {/* Description */}
        <p className="text-gray-600 mb-4 line-clamp-2">{post.description}</p>

        {/* Meta Information */}
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            <span>{post.date}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>{post.readTime}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

