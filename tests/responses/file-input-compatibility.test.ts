import { expect, test } from "bun:test";
import { Zip, ZipPassThrough, zipSync } from "fflate";
import { MAX_INPUT_FILE_BYTES, parseInputFile } from "../../src/responses/file-input";

const formats = [
  ["docx", "word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
] as const;
const encode = (value: string) => Buffer.from(value, "utf8");
function parts(format: (typeof formats)[number] = formats[0]): Record<string, Uint8Array> {
  return {
    "[Content_Types].xml": encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${format[1]}" ContentType="${format[2]}.main+xml"/></Types>`),
    "_rels/.rels": encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${format[1]}"/></Relationships>`),
    [format[1]]: encode("<?xml version=\"1.0\"?><document>原始内容 — binary stays intact</document>"),
    "docProps/custom.xml": encode("<Properties><property>unchanged</property></Properties>"),
    "media/image1.png": new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]),
  };
}
const archive = (files = parts(), level: 0 | 6 = 6) => Buffer.from(zipSync(files, { level }));
const parse = (bytes: Buffer, filename = "sample.docx") => parseInputFile({ filename, file_data: bytes.toString("base64") });
function entryOffsets(bytes: Buffer): Array<{ central: number; local: number }> {
  let offset = bytes.readUInt32LE(bytes.length - 6);
  const result: Array<{ central: number; local: number }> = [];
  while (bytes.readUInt32LE(offset) === 0x02014b50) {
    result.push({ central: offset, local: bytes.readUInt32LE(offset + 42) });
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return result;
}

for (const format of formats) for (const level of [0, 6] as const) {
  test(`${format[0]} method ${level ? "deflate" : "stored"} preserves every byte and canonical MIME`, () => {
    const bytes = archive(parts(format), level);
    const parsed = parse(bytes, `报告.${format[0].toUpperCase()}`);
    expect(parsed.mimeType).toBe(format[2]);
    expect(Buffer.from(parsed.data, "base64")).toEqual(bytes);
    for (const mime of [format[2], "application/octet-stream"]) {
      expect(parseInputFile({ filename: `report.${format[0]}`, file_data: `data:${mime};base64,${parsed.data}` }).data).toBe(parsed.data);
    }
    expect(() => parseInputFile({ filename: `report.${format[0]}`, file_data: `data:text/plain;base64,${parsed.data}` })).toThrow("media type");
  });
}

test("streaming ZIP data descriptors and strict Office relationship namespace are supported", () => {
  const files = parts();
  files["_rels/.rels"] = encode(Buffer.from(files["_rels/.rels"]!).toString().replace("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"));
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  for (const [name, data] of Object.entries(files)) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(data, true);
  }
  zip.end();
  const bytes = Buffer.concat(chunks);
  expect(parse(bytes).data).toBe(bytes.toString("base64"));
  const first = entryOffsets(bytes)[0]!;
  const descriptor = first.local + 30 + bytes.readUInt16LE(first.local + 26) + bytes.readUInt16LE(first.local + 28) + bytes.readUInt32LE(first.central + 20);
  bytes[descriptor + 4] ^= 1;
  expect(() => parse(bytes)).toThrow("descriptor mismatch");
});

test("plain ZIPs, renamed Office formats, missing main parts and misleading manifests fail closed", () => {
  expect(() => parse(archive({ "hello.txt": encode("not an Office file") }))).toThrow("missing required part");
  expect(() => parse(archive(parts(formats[1])))).toThrow("missing required part");
  const files = parts();
  delete files["word/document.xml"];
  expect(() => parse(archive(files))).toThrow("missing required part");
  for (const change of [
    (xml: string) => xml.replace("wordprocessingml.document.main", "spreadsheetml.sheet.main"),
    (xml: string) => xml.replace("<Override", "<!-- <Override").replace("/></Types>", "/> --></Types>"),
    (xml: string) => `<!DOCTYPE Types [<!ENTITY x SYSTEM "file:///private">]>${xml}`,
  ]) {
    const files = parts();
    files["[Content_Types].xml"] = encode(change(Buffer.from(files["[Content_Types].xml"]!).toString()));
    expect(() => parse(archive(files))).toThrow("Office");
  }
  const external = parts();
  external["_rels/.rels"] = encode(Buffer.from(external["_rels/.rels"]!).toString().replace('Target="word/document.xml"', 'TargetMode="External" Target="https://example.invalid/doc.xml"'));
  expect(() => parse(archive(external))).toThrow("main relationship");
});

test("macro-enabled, encrypted, ZIP64, split archives and symlinks are explicitly unsupported", () => {
  const macro = parts();
  macro["word/vbaProject.bin"] = new Uint8Array([0, 1]);
  expect(() => parse(archive(macro))).toThrow("macro-enabled");
  expect(() => parse(archive(), "sample.docm")).toThrow("unsupported");
  for (const mutate of [
    (bytes: Buffer, central: number, local: number) => { bytes.writeUInt16LE(1, central + 8); bytes.writeUInt16LE(1, local + 6); },
    (bytes: Buffer, central: number) => { bytes.writeUInt16LE(45, central + 6); },
    (bytes: Buffer) => { bytes.writeUInt16LE(1, bytes.length - 18); },
    (bytes: Buffer, central: number) => { bytes.writeUInt32LE(0xa0000000, central + 38); },
  ]) {
    const bytes = archive();
    const { central, local } = entryOffsets(bytes)[0]!;
    mutate(bytes, central, local);
    expect(() => parse(bytes)).toThrow("Office package");
  }
});

test("unsafe paths and case-ambiguous duplicate parts are rejected without extraction", () => {
  for (const name of ["../private", "/absolute", "word/../escape", "word\\escape", "word//escape", "WORD/document.xml"]) {
    expect(() => parse(archive({ ...parts(), [name]: encode("unsafe") }))).toThrow("ZIP entry name");
  }
});

test("truncation, altered bytes, header mismatches, overlapping entries and directory count mismatches fail", () => {
  expect(() => parse(archive().subarray(0, -1))).toThrow("missing ZIP directory");
  for (const mutate of [
    (bytes: Buffer, central: number, local: number) => { bytes[local + 30] ^= 1; },
    (bytes: Buffer, central: number, local: number) => { bytes[local + 30 + bytes.readUInt16LE(local + 26)] ^= 1; },
    (bytes: Buffer, central: number) => { bytes.writeUInt32LE(0xffffffff, central + 20); },
    (bytes: Buffer, central: number) => { bytes.writeUInt32LE(0, entryOffsets(bytes)[1]!.central + 42); },
    (bytes: Buffer) => { bytes.writeUInt16LE(1, bytes.length - 12); bytes.writeUInt16LE(1, bytes.length - 14); },
  ]) {
    const bytes = archive(parts(), 0);
    const { central, local } = entryOffsets(bytes)[0]!;
    mutate(bytes, central, local);
    expect(() => parse(bytes)).toThrow("Office package");
  }
});

test("entry, manifest and total expanded budgets are checked before decompression", () => {
  for (const [index, size] of [[0, 1_000_001], [2, 50_000_001]] as const) {
    const bytes = archive();
    const { central, local } = entryOffsets(bytes)[index]!;
    bytes.writeUInt32LE(size, central + 24);
    bytes.writeUInt32LE(size, local + 22);
    expect(() => parse(bytes)).toThrow("validation budget");
  }
  const bytes = archive();
  for (const { central, local } of entryOffsets(bytes).slice(2)) {
    bytes.writeUInt32LE(40_000_000, central + 24);
    bytes.writeUInt32LE(40_000_000, local + 22);
  }
  expect(() => parse(bytes)).toThrow("validation budget");
  const tooMany = archive();
  tooMany.writeUInt16LE(4097, tooMany.length - 14);
  tooMany.writeUInt16LE(4097, tooMany.length - 12);
  expect(() => parse(tooMany)).toThrow("entry count");
});

test("a deflate entry cannot expand beyond its declared length", () => {
  const files = { ...parts(), "word/large.xml": encode("x".repeat(100_000)) };
  const bytes = archive(files);
  const { central, local } = entryOffsets(bytes).at(-1)!;
  bytes.writeUInt32LE(1, central + 24);
  bytes.writeUInt32LE(1, local + 22);
  expect(() => parse(bytes)).toThrow("oversized compressed entry");
});

test("inline size/base64 and provider-reference authority boundaries remain enforced", () => {
  expect(() => parseInputFile({ file_id: "file-provider-owned" })).toThrow("task-authorized resolver");
  expect(() => parseInputFile({ filename: "same.txt", file_id: "file-provider-owned", file_data: "eA==" })).toThrow("without file_id");
  expect(() => parseInputFile({ filename: "sample.docx", file_data: "Zh==" })).toThrow("canonical base64");
  expect(() => parseInputFile({ filename: "sample.docx", file_data: "A".repeat(Math.ceil(MAX_INPUT_FILE_BYTES / 3) * 4 + 4) })).toThrow("20 MB");
  expect(() => parseInputFile({ filename: "sample.docx", file_data: "https://example.invalid/file.docx" })).toThrow("invalid base64");
  expect(parseInputFile({ filename: "text.txt", file_data: encode("UTF-8 中文").toString("base64") }).mimeType).toBe("text/plain");
  expect(parseInputFile({ filename: "file.pdf", file_data: encode("%PDF-1.7\nfixture").toString("base64") }).mimeType).toBe("application/pdf");
});
