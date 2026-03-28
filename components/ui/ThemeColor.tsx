'use client';
import { useEffect } from 'react';

export default function ThemeColor({ color }: { color: string }) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
    return () => {
      // Restore dark default on unmount
      if (meta) meta.setAttribute('content', '#060a12');
    };
  }, [color]);
  return null;
}
