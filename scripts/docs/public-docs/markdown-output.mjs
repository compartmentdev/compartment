export function renderFrontmatter(title, description) {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n`;
}

export function renderGuideLinks(area) {
  if (area === null || area.guides.length === 0) {
    return [];
  }

  return ['Related guides:', '', ...area.guides.map(renderGuideLink), ''];
}

export function renderMarkdown(lines) {
  return lines.join('\n');
}

function renderGuideLink(guide) {
  return `- [${guide.title}](/${guide.slug}/)`;
}
