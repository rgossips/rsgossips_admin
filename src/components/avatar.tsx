"use client";

import { useState } from "react";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  shape?: "circle" | "rounded";
  className?: string;
}

const sizeMap: Record<string, string> = {
  xs: "w-5 h-5 text-[8px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-11 h-11 text-sm",
  xl: "w-16 h-16 text-xl",
};

const shapeMap: Record<string, string> = {
  circle: "rounded-full",
  rounded: "rounded-xl",
};

export function Avatar({ src, name, size = "md", shape = "rounded", className = "" }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = name?.[0]?.toUpperCase() || "?";
  const sizeClass = sizeMap[size];
  const shapeClass = shapeMap[shape];

  if (!src || failed) {
    return (
      <div className={`${sizeClass} ${shapeClass} bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0 ${className}`}>
        <span className="font-bold text-white">{initial}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name || ""}
      onError={() => setFailed(true)}
      className={`${sizeClass} ${shapeClass} object-cover border border-gray-200 dark:border-gray-700 shrink-0 ${className}`}
    />
  );
}
