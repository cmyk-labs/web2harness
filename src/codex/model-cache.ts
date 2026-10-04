/** Remove only model IDs owned by this adapter. Keep native models and cache metadata. */
export function withoutWebModels(text: string): string {
  let cache: unknown;
  try { cache = JSON.parse(text); } catch { return text; }
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return text;
  const document = cache as Record<string, unknown>;
  if (!Array.isArray(document.models)) return text;
  const models = document.models.filter(model => {
    const slug = typeof model === "string" ? model : model?.slug;
    return typeof slug !== "string" || !slug.startsWith("chatgpt-web/");
  });
  if (models.length === document.models.length) return text;
  return `${JSON.stringify({ ...document, models }, null, 2)}\n`;
}
