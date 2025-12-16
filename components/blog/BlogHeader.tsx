"use client";

import { Calendar, Clock, User } from "lucide-react";
import { BlogPost } from "@/types/blog";

interface BlogHeaderProps {
  post: BlogPost;
}

export default function BlogHeader({ post }: BlogHeaderProps) {
  return (
    <div className="mb-8">
      {/* Category Badge */}
      <div className="mb-4">
        <span className="inline-block px-4 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
          {post.category}
        </span>
      </div>

      {/* Title */}
      <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight">
        {post.title}
      </h1>

      {/* Description */}
      <p className="text-xl text-gray-600 mb-6 leading-relaxed">
        {post.description}
      </p>

      {/* Meta Information */}
      <div className="flex flex-wrap items-center gap-6 text-gray-600 pb-6 border-b border-gray-200">
        {/* Author */}
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white font-semibold">
            {post.author.name.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-gray-900">{post.author.name}</p>
            <p className="text-sm text-gray-500">{post.author.role}</p>
          </div>
        </div>

        {/* Date */}
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-gray-400" />
          <span>{post.date}</span>
        </div>

        {/* Read Time */}
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-400" />
          <span>{post.readTime}</span>
        </div>
      </div>
    </div>
  );
}

