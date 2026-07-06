function createDoc(content) {
  return {
    type: 'doc',
    version: 1,
    content: Array.isArray(content) ? content : []
  };
}

function hardBreak() {
  return {
    type: 'hardBreak'
  };
}

function paragraph(text, marks = []) {
  const normalized = asTrimmedString(text);
  return {
    type: 'paragraph',
    content: normalized ? [textNode(normalized, marks)] : []
  };
}

function paragraphWithHardBreaks(lines) {
  const normalizedLines = Array.isArray(lines) ? lines : [];
  const content = [];

  for (const line of normalizedLines) {
    const lineContent = normalizeLineParts(line);
    if (lineContent.length === 0) continue;
    if (content.length > 0) content.push(hardBreak());
    content.push(...lineContent);
  }

  return {
    type: 'paragraph',
    content
  };
}

function richParagraph(parts) {
  const content = normalizeInlineParts(parts);
  return {
    type: 'paragraph',
    content
  };
}

function compactSectionTitle(text) {
  return {
    text: asTrimmedString(text),
    strong: true
  };
}

function bulletList(items) {
  return {
    type: 'bulletList',
    content: (Array.isArray(items) ? items : [])
      .map((item) => bulletItem(item))
      .filter(Boolean)
  };
}

function bulletItem(text) {
  const content = Array.isArray(text) || (text && typeof text === 'object' && !Array.isArray(text))
    ? richParagraph(text).content
    : paragraph(text).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  return {
    type: 'listItem',
    content: [{
      type: 'paragraph',
      content
    }]
  };
}

function textNode(text, marks = []) {
  const node = {
    type: 'text',
    text: asTrimmedString(text)
  };
  if (Array.isArray(marks) && marks.length > 0) {
    node.marks = marks;
  }
  return node;
}

function linkParagraph(label, href) {
  const text = asTrimmedString(label) || asTrimmedString(href);
  const url = asTrimmedString(href);
  if (!text || !url) return paragraph(text || url);
  return paragraph(text, [{ type: 'link', attrs: { href: url } }]);
}

function normalizeLineParts(input) {
  if (Array.isArray(input)) return normalizeInlineParts(input);
  if (input && typeof input === 'object') return normalizeInlineParts([input]);
  return normalizeInlineParts([String(input || '')]);
}

function normalizeInlineParts(input) {
  const parts = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
    ? [input]
    : [String(input || '')];
  const out = [];

  for (const rawPart of parts) {
    const part = typeof rawPart === 'string' ? { text: rawPart } : rawPart && typeof rawPart === 'object' ? rawPart : { text: '' };
    const text = asTrimmedString(part.text);
    const href = asTrimmedString(part.href);
    if (!text) continue;
    const marks = buildMarks({ href, strong: part.strong, marks: part.marks });
    out.push(textNode(text, marks));
  }

  return out;
}

function buildMarks(input = {}) {
  const marks = [];
  const href = asTrimmedString(input?.href);
  if (href) {
    marks.push({ type: 'link', attrs: { href } });
  }
  if (input?.strong === true) {
    marks.push({ type: 'strong' });
  }
  if (Array.isArray(input?.marks)) {
    for (const mark of input.marks) {
      if (!mark || typeof mark !== 'object' || !mark.type) continue;
      marks.push(mark);
    }
  }
  return marks;
}

function buildAdfFromSections(sections) {
  const content = [];

  for (const section of Array.isArray(sections) ? sections : []) {
    const headingText = asTrimmedString(section?.heading);
    const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
    const bullets = Array.isArray(section?.bullets) ? section.bullets.filter(Boolean) : [];
    const compactLines = [];

    if (headingText) {
      compactLines.push(compactSectionTitle(headingText));
    }

    for (const row of paragraphs) {
      compactLines.push(row);
    }

    if (compactLines.length > 0) {
      const compactParagraph = paragraphWithHardBreaks(compactLines);
      if (compactParagraph.content.length > 0) {
        content.push(compactParagraph);
      }
    }

    if (bullets.length > 0) {
      content.push(bulletList(bullets));
    }
  }

  return createDoc(content);
}

function asTrimmedString(value) {
  return String(value || '').trim();
}

module.exports = {
  buildAdfFromSections,
  compactSectionTitle,
  createDoc,
  paragraphWithHardBreaks
};
