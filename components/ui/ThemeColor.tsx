'use client';
import { useEffect } from 'react';

export default function ThemeColor({ color }: { color: string }) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
  }, [color]);
  return null;
}
