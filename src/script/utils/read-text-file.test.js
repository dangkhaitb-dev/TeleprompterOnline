/* @vitest-environment jsdom */

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readTextFile } from './read-text-file.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function createDocxFile(documentXml, name = 'script.docx') {
  const archive = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Override PartName="/word/document.xml" '
      + `ContentType="${DOCX_MIME}.main+xml"/>`
      + '</Types>',
    ),
    'word/document.xml': strToU8(documentXml),
  });

  return new File([archive], name, { type: DOCX_MIME });
}

describe('readTextFile', () => {
  it.each([
    ['script.txt', 'Plain  text'],
    ['script.md', '# Heading\n\nMarkdown  text'],
    ['script.markdown', 'Long Markdown extension'],
    ['script.fountain', 'INT. STUDIO - DAY'],
    ['script.text', 'Legacy plain-text extension'],
    ['workspace.json', '{"format":"solprompter-workspace"}'],
  ])('keeps existing plain-text behavior for %s', async (name, content) => {
    const file = new File([content], name, { type: 'text/plain' });

    await expect(readTextFile(file)).resolves.toBe(content);
  });

  it('extracts DOCX content as plain text while preserving spaces and document breaks', async () => {
    const file = createDocxFile(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>'
      + '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>'
      + '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>'
      + '<w:r><w:t xml:space="preserve">   spaced  words </w:t></w:r>'
      + '<w:r><w:tab/><w:t>after tab</w:t></w:r>'
      + '<w:br/><w:r><w:t>after break</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>'
      + '<w:tbl>'
      + '<w:tr><w:tc><w:p><w:r><w:t>Left cell</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p><w:r><w:t>Right cell</w:t></w:r></w:p></w:tc></w:tr>'
      + '<w:tr><w:tc><w:p><w:r><w:t>Bottom left</w:t></w:r></w:p></w:tc>'
      + '<w:sdt><w:sdtContent><w:tc><w:p><w:r><w:t>Bottom right</w:t></w:r></w:p>'
      + '</w:tc></w:sdtContent></w:sdt></w:tr>'
      + '</w:tbl>'
      + '</w:body></w:document>',
    );

    await expect(readTextFile(file)).resolves.toBe(
      'Hello   spaced  words \tafter tab\nafter break\n'
      + 'Second paragraph\n'
      + 'Left cell\tRight cell\n'
      + 'Bottom left\tBottom right',
    );
  });

  it('extracts one compatibility branch instead of duplicating alternate content', async () => {
    const file = createDocxFile(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      + 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
      + '<w:body><mc:AlternateContent>'
      + '<mc:Choice Requires="wps"><w:p><w:r><w:t>Choice copy</w:t></w:r></w:p></mc:Choice>'
      + '<mc:Fallback><w:p><w:r><w:t>Fallback copy</w:t></w:r></w:p></mc:Fallback>'
      + '</mc:AlternateContent></w:body></w:document>',
    );

    await expect(readTextFile(file)).resolves.toBe('Fallback copy');
  });

  it('supports the Strict WordprocessingML namespace', async () => {
    const file = createDocxFile(
      '<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main">'
      + '<w:body><w:p><w:r><w:t>Strict document</w:t></w:r></w:p></w:body>'
      + '</w:document>',
    );

    await expect(readTextFile(file)).resolves.toBe('Strict document');
  });

  it('rejects corrupted DOCX archives and DOCX packages without document content', async () => {
    const corrupted = new File([strToU8('not a zip')], 'broken.docx', { type: DOCX_MIME });
    const missingDocument = new File([
      zipSync({ '[Content_Types].xml': strToU8('<Types/>') }),
    ], 'missing.docx', { type: DOCX_MIME });

    await expect(readTextFile(corrupted)).rejects.toThrow(/invalid or unsupported DOCX/i);
    await expect(readTextFile(missingDocument)).rejects.toThrow(/invalid or unsupported DOCX/i);
  });

  it('rejects document XML outside the WordprocessingML namespace', async () => {
    const file = createDocxFile('<document><p><t>Not Word content</t></p></document>');

    await expect(readTextFile(file)).rejects.toThrow(/invalid or unsupported DOCX/i);
  });

  it('rejects DOCX XML entity declarations before parsing', async () => {
    const file = createDocxFile(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<!DOCTYPE w:document [<!ENTITY repeated "expanded text">]>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p><w:r><w:t>&repeated;</w:t></w:r></w:p></w:body>'
      + '</w:document>',
    );

    await expect(readTextFile(file)).rejects.toThrow(/invalid or unsupported DOCX/i);
  });

  it('rejects oversized DOCX archives before reading them', async () => {
    const file = createDocxFile(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 });

    await expect(readTextFile(file)).rejects.toThrow(/invalid or unsupported DOCX/i);
  });

  it('rejects DOCX archives with an excessive number of ZIP entries', async () => {
    const entries = {
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:body><w:p><w:r><w:t>Hidden in a huge directory</w:t></w:r></w:p></w:body>'
        + '</w:document>',
      ),
    };
    for (let index = 0; index < 4_097; index += 1) {
      entries[`unused/${index}.txt`] = new Uint8Array();
    }
    const file = new File([zipSync(entries)], 'too-many-entries.docx', { type: DOCX_MIME });

    await expect(readTextFile(file)).rejects.toThrow(/invalid or unsupported DOCX/i);
  });

  it('checks the actual document XML size after ZIP extraction', async () => {
    const documentXml = strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<!--${'x'.repeat(10 * 1024 * 1024)}-->`
      + '<w:body><w:p><w:r><w:t>Small visible text</w:t></w:r></w:p></w:body>'
      + '</w:document>',
    );
    const archive = zipSync({
      'word/document.xml': [documentXml, { level: 0 }],
    });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    let directoryOffset = -1;
    for (let offset = archive.length - 46; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        directoryOffset = offset;
        break;
      }
    }
    expect(directoryOffset).toBeGreaterThanOrEqual(0);
    view.setUint32(directoryOffset + 24, 1, true);
    const file = new File([archive], 'misreported-size.docx', { type: DOCX_MIME });

    await expect(readTextFile(file)).rejects.toThrow(/invalid or unsupported DOCX/i);
  });

  it('rejects unsupported legacy Word documents', async () => {
    const file = new File(['legacy bytes'], 'script.doc', { type: 'application/msword' });

    await expect(readTextFile(file)).rejects.toThrow(/unsupported file format/i);
  });
});
