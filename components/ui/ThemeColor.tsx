'use client';
import { useEffect } from 'react';

export default function ThemeColor({ color }: { color: string }) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute('content', color);
    // No cleanup — let the destination page set its own color
    // Home page handles its own color via its own useEffect
  }, [color]);
  return null;
}
