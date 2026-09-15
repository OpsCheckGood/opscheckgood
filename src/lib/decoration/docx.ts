import { zipStore, type ZipEntry } from '../mfr/zip';
import type { CertificateText } from './citation';

/**
 * The certificate as an editable Word document.
 *
 * The page preview is the artifact you check; this is the one you hand to
 * someone who has to change a sentence. It carries the same lines in the
 * same faces -- Times New Roman for the header, Courier New 11 for the
 * citation, justified -- as one paragraph each, so the citation reflows as
 * it is edited. Word uses the faces where they are installed and substitutes
 * where they are not; naming a font is not redistributing it.
 */

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function xe(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface ParaOptions {
  font: string;
  /** Points. */
  size: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'both';
  /** Space after, in points. */
  after?: number;
}

function para(text: string, o: ParaOptions): string {
  const rPr =
    `<w:rPr><w:rFonts w:ascii="${xe(o.font)}" w:hAnsi="${xe(o.font)}" w:cs="${xe(o.font)}"/>` +
    (o.bold ? '<w:b/>' : '') +
    `<w:sz w:val="${Math.round(o.size * 2)}"/><w:szCs w:val="${Math.round(o.size * 2)}"/></w:rPr>`;
  const pPr =
    `<w:pPr><w:spacing w:before="0" w:after="${Math.round((o.after ?? 0) * 20)}" w:line="240" w:lineRule="auto"/>` +
    `<w:jc w:val="${o.align ?? 'left'}"/>${rPr}</w:pPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xe(text)}</w:t></w:r></w:p>`;
}

export function buildCitationDocx(page: CertificateText, citation: string): Blob {
  const body: string[] = [];
  for (const line of page.header) {
    body.push(
      para(line.text, {
        font: line.face === 'mono' ? 'Courier New' : 'Times New Roman',
        size: line.sizePt,
        bold: line.face === 'serif-bold',
        align: 'center',
        after: 6,
      }),
    );
  }
  body.push(para(citation, { font: 'Courier New', size: 11, align: 'both', after: 12 }));
  for (const line of page.closing) {
    body.push(
      para(line.text, {
        font: line.face === 'mono' ? 'Courier New' : 'Times New Roman',
        size: line.sizePt,
        align: 'center',
        after: 4,
      }),
    );
  }
  if (page.signature.length) {
    body.push(para('', { font: 'Times New Roman', size: 10, after: 18 }));
    for (const line of page.signature) body.push(para(line, { font: 'Times New Roman', size: 10 }));
  }

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:document xmlns:w="${WNS}"><w:body>${body.join('')}` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';

  const files: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    { name: 'word/document.xml', data: document },
  ];

  return new Blob([zipStore(files)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
