import JSZip from 'jszip';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function escapeXml(value = '') {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function run(text, { bold = false, italic = false, color = '', size = 0 } = {}) {
  const props = [];
  props.push('<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="宋体"/>');
  if (bold) props.push('<w:b/>');
  if (italic) props.push('<w:i/>');
  if (color) props.push(`<w:color w:val="${color}"/>`);
  if (size) props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(text, { style = '', bold = false, italic = false, color = '', size = 0, align = '', before = 0, after = 120, indent = 0 } = {}) {
  const props = [];
  if (style) props.push(`<w:pStyle w:val="${style}"/>`);
  if (align) props.push(`<w:jc w:val="${align}"/>`);
  props.push(`<w:spacing w:before="${before}" w:after="${after}" w:line="320" w:lineRule="auto"/>`);
  if (indent) props.push(`<w:ind w:left="${indent}"/>`);
  return `<w:p><w:pPr>${props.join('')}</w:pPr>${run(text, { bold, italic, color, size })}</w:p>`;
}

function multiParagraph(text, options = {}) {
  return String(text || '')
    .split(/\n{1,}/)
    .filter((line) => line.trim())
    .map((line) => paragraph(line.trim(), options))
    .join('');
}

function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="宋体"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="340" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="300"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="223C33"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="3A5548"/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/><w:spacing w:before="80" w:after="100"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/><w:spacing w:after="180"/></w:pPr><w:rPr><w:color w:val="999999"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>
</w:styles>`;
}

function documentXml(bookTitle, notes, { overview = '', categories = [] } = {}) {
  const parts = [];
  parts.push(paragraph(bookTitle, { style: 'Title' }));
  parts.push(
    paragraph(
      `读书笔记 · 页间 PageNest · ${new Date().toLocaleDateString('zh-CN')}`,
      { style: 'Subtitle' },
    ),
  );
  if (overview) {
    parts.push(paragraph('整理概览', { style: 'Heading1' }));
    parts.push(multiParagraph(overview, { size: 22 }));
  }

  const groups = new Map();
  for (const note of notes) {
    const key = note.category || '未分类';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  }

  const orderedCategories = [
    ...categories.map((category) => category.name).filter(Boolean),
    ...[...groups.keys()].filter((name) => !categories.some((category) => category.name === name)),
  ];

  let first = true;
  for (const category of orderedCategories) {
    const list = groups.get(category);
    if (!list?.length) continue;
    if (!first) parts.push(pageBreak());
    first = false;
    parts.push(paragraph(category, { style: 'Heading1' }));
    const categoryMeta = categories.find((item) => item.name === category);
    if (categoryMeta?.summary) {
      parts.push(multiParagraph(categoryMeta.summary, { color: '666666', size: 20 }));
    }
    for (const note of list) {
      const heading = note.aiTitle || note.title || note.quote?.slice(0, 26) || '笔记';
      parts.push(paragraph(heading, { style: 'Heading2' }));
      if (note.content) parts.push(multiParagraph(note.content));
      if (note.quote) {
        parts.push(paragraph(`“${note.quote}”`, { style: 'Quote' }));
        const location = note.page
          ? `第 ${note.page} 页`
          : note.chapterTitle || '原文';
        parts.push(paragraph(`—— 《${note.bookTitle || bookTitle}》 · ${location}`, { style: 'Source' }));
      }
      if (note.aiSummary) {
        parts.push(
          paragraph(`AI 整理：${note.aiSummary}`, {
            color: '3A5548',
            size: 20,
            italic: true,
          }),
        );
      }
    }
  }

  if (!notes.length) {
    parts.push(paragraph('还没有笔记。在阅读器里选中文字或打开笔记侧栏开始记录。', { color: '777777' }));
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1600" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export async function buildNotesDocx({ bookTitle, notes, overview = '', categories = [] }) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  );
  zip.file('word/styles.xml', stylesXml());
  zip.file('word/document.xml', documentXml(bookTitle, notes, { overview, categories }));
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(bookTitle)} · 读书笔记</dc:title><dc:creator>页间 PageNest</dc:creator><cp:lastModifiedBy>页间 PageNest</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>页间 PageNest</Application></Properties>`,
  );
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
