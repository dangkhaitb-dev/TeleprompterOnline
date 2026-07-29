// read-text-file.js — read supported script files as plain text.

const DOCX_EXTENSION = 'docx';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARACTERS = 2_000_000;
const MAX_ZIP_ENTRY_COUNT = 4_096;
const ZIP_END_SIGNATURE = 0x06054b50;
const PLAIN_TEXT_EXTENSIONS = new Set([
  'fountain',
  'json',
  'markdown',
  'md',
  'text',
  'txt',
]);
const MARKUP_COMPATIBILITY_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WORDPROCESSING_NAMESPACES = new Set([
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
]);

function fileExtension(file) {
  const name = typeof file?.name === 'string' ? file.name : '';
  const separator = name.lastIndexOf('.');
  return separator === -1 ? '' : name.slice(separator + 1).toLowerCase();
}

function readWithFileReader(file, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader[method](file);
  });
}

function childText(node) {
  return Array.from(node.childNodes, (child) => docxNodeText(child)).join('');
}

function compatibilityBranchText(node) {
  const branches = Array.from(node.children)
    .filter((child) => child.namespaceURI === MARKUP_COMPATIBILITY_NAMESPACE);
  const branch = branches.find((child) => child.localName === 'Fallback')
    || branches.find((child) => child.localName === 'Choice');
  return branch ? childText(branch) : '';
}

function tableRowCells(node) {
  const cells = [];
  Array.from(node.children).forEach((child) => {
    const isWordElement = WORDPROCESSING_NAMESPACES.has(child.namespaceURI);
    if (isWordElement && child.localName === 'tc') {
      cells.push(child);
    } else if (!isWordElement || !['tbl', 'tr'].includes(child.localName)) {
      cells.push(...tableRowCells(child));
    }
  });
  return cells;
}

function tableRowText(row) {
  return tableRowCells(row)
    .map((cell) => childText(cell).replace(/\n+$/u, ''))
    .join('\t');
}

function docxNodeText(node) {
  if (node.nodeType !== 1) return '';
  if (
    node.namespaceURI === MARKUP_COMPATIBILITY_NAMESPACE
    && node.localName === 'AlternateContent'
  ) {
    return compatibilityBranchText(node);
  }
  const isWordElement = WORDPROCESSING_NAMESPACES.has(node.namespaceURI);
  if (isWordElement && node.localName.endsWith('Pr')) return '';

  switch (isWordElement ? node.localName : '') {
    case 't':
      return node.textContent || '';
    case 'tab':
      return node.parentElement?.localName === 'r'
        && WORDPROCESSING_NAMESPACES.has(node.parentElement.namespaceURI)
        ? '\t'
        : '';
    case 'br':
    case 'cr':
      return '\n';
    case 'p':
      return `${childText(node)}\n`;
    case 'tr':
      return `${tableRowText(node)}\n`;
    default:
      return childText(node);
  }
}

function parseDocumentXml(bytes, strFromU8) {
  const xml = strFromU8(bytes);
  if (/<!(?:DOCTYPE|ENTITY)\b/iu.test(xml)) {
    throw new Error('Word document XML declarations are unsupported');
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (
    document.documentElement.localName === 'parsererror'
    || document.getElementsByTagName('parsererror').length > 0
    || document.documentElement.localName !== 'document'
    || !WORDPROCESSING_NAMESPACES.has(document.documentElement.namespaceURI)
  ) {
    throw new Error('Malformed Word document XML');
  }

  const text = docxNodeText(document.documentElement).replace(/\n+$/u, '');
  if (text.length > MAX_EXTRACTED_TEXT_CHARACTERS) {
    throw new Error('Word document text is too large');
  }
  return text;
}

function findZipEnd(bytes, view) {
  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error('ZIP end record is missing');
}

function validateZipDirectory(bytes) {
  if (bytes.length < 22) throw new Error('ZIP archive is too small');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEnd(bytes, view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntryCount = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);

  if (
    diskNumber !== 0
    || directoryDisk !== 0
    || diskEntryCount !== entryCount
    || entryCount === 0xffff
    || entryCount > MAX_ZIP_ENTRY_COUNT
    || directorySize === 0xffffffff
    || directoryOffset === 0xffffffff
    || directoryOffset + directorySize > endOffset
  ) {
    throw new Error('Unsupported ZIP directory');
  }
}

async function readDocxFile(file) {
  try {
    if (file.size > MAX_DOCX_FILE_BYTES) {
      throw new Error('Word document archive is too large');
    }
    const result = await readWithFileReader(file, 'readAsArrayBuffer');
    const bytes = new Uint8Array(result);
    validateZipDirectory(bytes);
    const { strFromU8, unzipSync } = await import('fflate');
    const archive = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        if (name !== 'word/document.xml') return false;
        if (originalSize > MAX_DOCUMENT_XML_BYTES) {
          throw new Error('Word document content is too large');
        }
        return true;
      },
    });
    const documentXml = archive['word/document.xml'];
    if (!documentXml) throw new Error('Word document content is missing');
    if (documentXml.byteLength > MAX_DOCUMENT_XML_BYTES) {
      throw new Error('Word document content is too large');
    }

    return parseDocumentXml(documentXml, strFromU8);
  } catch {
    throw new Error('Invalid or unsupported DOCX file');
  }
}

export async function readTextFile(file) {
  const extension = fileExtension(file);
  if (extension === DOCX_EXTENSION || file?.type === DOCX_MIME) {
    return readDocxFile(file);
  }
  if (extension && !PLAIN_TEXT_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported file format');
  }

  const result = await readWithFileReader(file, 'readAsText');
  return String(result || '');
}
