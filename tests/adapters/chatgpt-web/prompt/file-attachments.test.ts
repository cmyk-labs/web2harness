import { expect, test } from "bun:test";
import { parseRequest } from "../../../../src/responses/parser";
import { parseInputFile } from "../../../../src/responses/file-input";
import { compileChatGptWebPrompt } from "../../../../src/adapters/chatgpt-web/prompt/compile";
import { chatGptPromptFilePayloads } from "../../../../src/adapters/chatgpt-web/browser/composer";
import { validateInputFiles, inputFileTokens } from "../../../../src/adapters/chatgpt-web/prompt/file-attachments";

const capabilities = { nativeToolsEnabled: true, localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: false };
const encode = (text: string) => Buffer.from(text).toString("base64");
const file = { type: "input_file", filename: "sample.txt", file_data: encode("中文 file\nline 2") };
const compile = (input: unknown[]) => compileChatGptWebPrompt(parseRequest({ model: "gpt-5.6-sol", input }), capabilities);

test("input files retain original bytes and identity across message/tool history without inlining base64", () => {
  const prompt = compile([
    { role: "user", content: [file] },
    { type: "custom_tool_call", call_id: "read", name: "exec", input: "read" },
    { type: "custom_tool_call_output", call_id: "read", output: [file, { type: "input_text", text: "result" }] },
  ]);
  expect(prompt.files).toHaveLength(1);
  expect(prompt.text).not.toContain(file.file_data);
  expect(prompt.text).toContain("file_attachment");
  const [uploaded] = chatGptPromptFilePayloads(prompt);
  expect(uploaded!.buffer.toString()).toBe("中文 file\nline 2");
  expect(uploaded!.name).toBe(prompt.files![0]!.name);
  expect(inputFileTokens(prompt.files, "gpt-5.6-sol")).toBeGreaterThan(0);
  expect(() => validateInputFiles([{ ...prompt.files![0], data: encode("changed") }])).toThrow("identity mismatch");
  expect(() => chatGptPromptFilePayloads({ ...prompt, images: Array.from({ length: 10 }, () => ({ ref: "image", imageUrl: "data:image/png;base64,aGVsbG8=" })) })).toThrow("10 attachments");
});

test("PDF uses a native binary attachment and text files require actual readable bytes", () => {
  const pdf = parseInputFile({ filename: "sample.pdf", file_data: `data:application/pdf;base64,${encode("%PDF-1.7\nfixture")}` });
  expect(pdf.mimeType).toBe("application/pdf");
  for (const invalid of [
    { filename: "a.txt", file_id: "file-123" },
    { filename: "../a.txt", file_data: encode("text") },
    { filename: "C:\\secret.txt", file_data: encode("text") },
    { filename: "a.txt", file_data: "!!!!" },
    { filename: "a.txt", file_data: "Zh==" },
    { filename: "a.exe", file_data: encode("MZ") },
    { filename: "a.pdf", file_data: encode("not pdf") },
    { filename: "a.txt", file_data: "/w==" },
  ]) expect(() => parseInputFile(invalid)).toThrow();
  expect(() => compile([{ role: "user", content: [{ type: "input_image", file_id: "file-123" }] }])).toThrow("file_id");
  expect(() => compile([{ type: "custom_tool_call_output", call_id: "view", output: [{ type: "input_image", file_id: "file-123" }] }])).toThrow("file_id");
});

test("custom tool output images preserve byte content and ordering", () => {
  const imageUrl = "data:image/png;base64,aGVsbG8=";
  const prompt = compile([{ type: "custom_tool_call_output", call_id: "view", output: [
    { type: "input_text", text: "before" }, { type: "input_image", image_url: imageUrl, detail: "original" }, { type: "input_text", text: "after" },
  ] }]);
  expect(prompt.images[0]!.imageUrl).toBe(imageUrl);
  expect(prompt.images[0]!.detail).toBe("original");
  expect(chatGptPromptFilePayloads(prompt)[0]!.buffer.toString()).toBe("hello");
  expect(prompt.text.indexOf("before")).toBeLessThan(prompt.text.indexOf('"image_attachment"'));
  expect(prompt.text.indexOf('"image_attachment"')).toBeLessThan(prompt.text.indexOf('"after"'));
});
