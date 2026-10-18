import { expect, test } from "bun:test";
import { zipSync } from "fflate";
import { parseRequest } from "../../../../src/responses/parser";
import { parseInputFile } from "../../../../src/responses/file-input";
import { compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { createInputFile, inputFileTokens, validateInputFiles } from "../../../../src/adapters/chatgpt-web/prompt/file-attachments";
import { chatGptImageFilePayloads, chatGptPromptFilePayloads } from "../../../../src/adapters/chatgpt-web/browser/composer";

const capabilities = { nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false };
const formats = [
  ["docx", "word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
] as const;
function officeFile(format: (typeof formats)[number]) {
  const bytes = Buffer.from(zipSync({
    "[Content_Types].xml": Buffer.from(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${format[1]}" ContentType="${format[2]}.main+xml"/></Types>`),
    "_rels/.rels": Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${format[1]}"/></Relationships>`),
    [format[1]]: Buffer.from("<document>Fixture: 中文, formulas, formatting are not extracted here</document>"),
    "media/preserved.bin": new Uint8Array([0, 255, 254, 253, 128, 1]),
  }));
  return { bytes, block: { type: "input_file", filename: `报告.${format[0]}`, file_data: bytes.toString("base64") } };
}

for (const format of formats) test(`${format[0]} reaches upload payload unchanged through message and native tool history`, () => {
  const { bytes, block } = officeFile(format);
  const source = { model: "gpt-5.6-sol", input: [
    { role: "user", content: [block] },
    { type: "custom_tool_call", call_id: "read-file", name: "exec", input: "fixture" },
    { type: "custom_tool_call_output", call_id: "read-file", output: [block, { type: "input_text", text: "original document" }] },
  ] };
  const before = JSON.stringify(source);
  const prompt = compileChatGptWebPrompt(parseRequest(source), capabilities);
  const [payload] = chatGptPromptFilePayloads(prompt);
  expect(JSON.stringify(source)).toBe(before);
  expect(prompt.files).toHaveLength(1);
  expect(payload!.buffer).toEqual(bytes);
  expect(payload!.mimeType).toBe(format[2]);
  expect(payload!.name.endsWith(`报告.${format[0]}`)).toBe(true);
  expect(prompt.text).not.toContain(block.file_data);
  expect(prompt.text).not.toContain("formulas, formatting");
  expect(inputFileTokens(prompt.files, "gpt-5.6-sol")).toBe(bytes.length);
});

test("Office attachment identity and MIME are rechecked at the browser boundary", () => {
  const { block } = officeFile(formats[0]);
  const file = createInputFile(parseInputFile(block));
  validateInputFiles([file]);
  for (const tampered of [
    { ...file, name: "replaced.docx" },
    { ...file, mimeType: "text/plain" },
    { ...file, data: Buffer.from("not a ZIP").toString("base64") },
    { ...file, filename: "report.xlsx" },
  ]) {
    expect(() => chatGptPromptFilePayloads({ text: "context", images: [], files: [tampered] })).toThrow();
  }
  expect(() => validateInputFiles([file, file])).toThrow("identity mismatch");
});

test("Office documents participate in the existing mixed attachment count and aggregate byte limits", () => {
  const { block } = officeFile(formats[1]);
  const office = createInputFile(parseInputFile(block));
  const images = Array.from({ length: 10 }, (_, i) => ({ ref: `image-${i}`, imageUrl: "data:image/png;base64,aGVsbG8=" }));
  expect(() => chatGptPromptFilePayloads({ text: "context", images, files: [office] })).toThrow("10 attachments");
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(17_000_000, 32)]).toString("base64");
  const files = [office, ...Array.from({ length: 3 }, (_, i) => createInputFile(parseInputFile({ filename: `file-${i}.pdf`, file_data: pdf })))];
  expect(() => chatGptPromptFilePayloads({ text: "context", images: [], files })).toThrow("50 MB per-turn limit");
});

test("remote URLs and provider identifiers never grant implicit read authority", () => {
  for (const imageUrl of ["https://example.invalid/image.png", "http://127.0.0.1/private", "file:///private.png", "file-provider-owned"]) {
    expect(() => chatGptImageFilePayloads([{ ref: "image", imageUrl }])).toThrow("task-authorized resolver");
  }
  expect(() => parseRequest({ model: "gpt-5.6-sol", input: [{ role: "user", content: [{ type: "input_image", file_id: "file-provider-owned" }] }] })).toThrow("file_id");
  const [inline] = chatGptImageFilePayloads([{ ref: "image", imageUrl: "data:image/png;base64,aGVsbG8=" }]);
  expect(inline!.buffer.toString()).toBe("hello");
});
