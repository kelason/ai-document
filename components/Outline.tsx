"use client";

import React, { useEffect, useState } from "react";
import { ListRestart, AlignLeft } from "lucide-react";

interface OutlineItem {
  text: string;
  level: "h1" | "h2" | "h3";
  id: string;
}

interface OutlineProps {
  content: string;
}

export default function Outline({ content }: OutlineProps) {
  const [headings, setHeadings] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Parse the HTML content to extract headings
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");
    const headingElements = doc.querySelectorAll("h1, h2, h3");
    
    const extracted: OutlineItem[] = [];
    headingElements.forEach((el, index) => {
      extracted.push({
        text: el.textContent || "Untitled Heading",
        level: el.tagName.toLowerCase() as "h1" | "h2" | "h3",
        id: `heading-${index}`,
      });
    });

    setHeadings(extracted);
  }, [content]);

  const handleHeadingClick = (text: string, level: string) => {
    if (typeof document === "undefined") return;
    const elements = Array.from(document.querySelectorAll(`.prose-editor ${level}`));
    const match = elements.find((h) => (h.textContent || "").trim() === text.trim());
    if (match) {
      match.scrollIntoView({ behavior: "smooth", block: "center" });
      
      // Flash the clicked heading temporarily for visual confirmation
      match.classList.add("bg-indigo-100/50", "dark:bg-indigo-950/50", "rounded");
      setTimeout(() => {
        match.classList.remove("bg-indigo-100/50", "dark:bg-indigo-950/50", "rounded");
      }, 1000);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 select-none">
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-zinc-100 dark:border-zinc-800/80">
        <AlignLeft size={16} className="text-zinc-500" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Document Outline
        </h3>
      </div>
      
      {headings.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
          <ListRestart size={24} className="text-zinc-300 dark:text-zinc-700 mb-2" />
          <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[160px]">
            Add Headings (H1, H2, H3) to automatically generate outline
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1 pr-1 font-sans">
          {headings.map((h, i) => (
            <button
              key={`${h.id}-${i}`}
              onClick={() => handleHeadingClick(h.text, h.level)}
              className={`w-full text-left text-xs rounded-lg py-1.5 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all font-medium truncate ${
                h.level === "h1"
                  ? "pl-2 font-semibold text-zinc-700 dark:text-zinc-300"
                  : h.level === "h2"
                  ? "pl-5"
                  : "pl-8 text-[11px]"
              }`}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
