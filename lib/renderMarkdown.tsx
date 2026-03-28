// Lightweight markdown renderer — no external dependencies
// Handles: **bold**, *italic*, ## headings, - bullet lists,
// numbered lists, and line breaks
// Returns React elements safe for rendering

import React from 'react';

export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let keyIndex = 0;

  const renderInline = (line: string): React.ReactNode => {
    // Handle **bold** and *italic* inline
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines — add spacing
    if (line.trim() === '') {
      elements.push(<div key={keyIndex++} style={{ height: '8px' }} />);
      i++;
      continue;
    }

    // ## Heading
    if (line.startsWith('## ')) {
      elements.push(
        <div key={keyIndex++} style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '18px',
          fontWeight: 600,
          marginTop: '16px',
          marginBottom: '6px',
        }}>
          {renderInline(line.slice(3))}
        </div>
      );
      i++;
      continue;
    }

    // # Heading
    if (line.startsWith('# ')) {
      elements.push(
        <div key={keyIndex++} style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '20px',
          fontWeight: 600,
          marginTop: '16px',
          marginBottom: '8px',
        }}>
          {renderInline(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // - Bullet list item or * bullet
    if (line.match(/^[-*] /)) {
      const bulletItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        bulletItems.push(
          <div key={i} style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '4px',
          }}>
            <span style={{ opacity: 0.5, flexShrink: 0 }}>•</span>
            <span>{renderInline(lines[i].slice(2))}</span>
          </div>
        );
        i++;
      }
      elements.push(
        <div key={keyIndex++} style={{ marginBottom: '8px' }}>
          {bulletItems}
        </div>
      );
      continue;
    }

    // Numbered list: 1. 2. 3.
    if (line.match(/^\d+\. /)) {
      const listItems: React.ReactNode[] = [];
      let num = 1;
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        const content = lines[i].replace(/^\d+\. /, '');
        listItems.push(
          <div key={i} style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '4px',
          }}>
            <span style={{ opacity: 0.5, flexShrink: 0, minWidth: '16px' }}>
              {num}.
            </span>
            <span>{renderInline(content)}</span>
          </div>
        );
        num++;
        i++;
      }
      elements.push(
        <div key={keyIndex++} style={{ marginBottom: '8px' }}>
          {listItems}
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={keyIndex++} style={{ marginBottom: '6px', lineHeight: 1.6 }}>
        {renderInline(line)}
      </div>
    );
    i++;
  }

  return <>{elements}</>;
}
