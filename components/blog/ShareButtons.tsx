"use client";

import { useState, useEffect } from "react";
import { Facebook, Linkedin, Twitter, Link as LinkIcon, Check } from "lucide-react";
import toast from "react-hot-toast";

interface ShareButtonsProps {
  title: string;
  url: string;
}

export default function ShareButtons({ title, url }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(url);

  useEffect(() => {
    // Only update URL on client side after hydration
    if (typeof window !== "undefined") {
      setShareUrl(window.location.href);
    }
  }, []);

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy link");
    }
  };

  const shareLinks = [
    {
      name: "Twitter",
      icon: Twitter,
      url: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
      color: "hover:bg-green-600 hover:text-white hover:border-green-600",
    },
    {
      name: "LinkedIn",
      icon: Linkedin,
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      color: "hover:bg-green-600 hover:text-white hover:border-green-600",
    },
    {
      name: "Facebook",
      icon: Facebook,
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      color: "hover:bg-green-600 hover:text-white hover:border-green-600",
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-gray-700 mb-3">Share this</p>
      
      {/* Social Share Buttons */}
      {shareLinks.map((social) => (
        <a
          key={social.name}
          href={social.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center justify-center w-full p-3 rounded-lg border-2 border-gray-200 text-gray-700 transition-all ${social.color}`}
          aria-label={`Share on ${social.name}`}
        >
          <social.icon className="w-5 h-5" />
        </a>
      ))}

      {/* Copy Link Button */}
      <button
        onClick={handleCopyLink}
        className={`flex items-center justify-center w-full p-3 rounded-lg border-2 transition-all ${
          copied
            ? "bg-green-600 text-white border-green-600"
            : "border-gray-200 text-gray-700 hover:bg-green-600 hover:text-white hover:border-green-600"
        }`}
        aria-label="Copy link"
      >
        {copied ? <Check className="w-5 h-5" /> : <LinkIcon className="w-5 h-5" />}
      </button>
    </div>
  );
}

