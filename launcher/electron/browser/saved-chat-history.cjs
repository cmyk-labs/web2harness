const fs = require("node:fs");
const { writePrivateFileAtomic } = require("../common/atomic-file.cjs");
const { savedChatTitle, validSavedChatTask } = require("../../shared/saved-chat.cjs");

/** A single launcher serializes allocations. This ledger is not authority to reopen remote chats. */
class SavedChatHistory {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { version: 1, tasks: {}, chats: {} };
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (value?.version !== 1 || !value.tasks || !value.chats
        || Array.isArray(value.tasks) || Array.isArray(value.chats)
        || Object.keys(value.tasks).length > 10_000 || Object.keys(value.chats).length > 50_000) {
        throw new Error("Invalid saved chat history");
      }
      for (const [key, task] of Object.entries(value.tasks)) {
        if (!validSavedChatTask({ taskKey: key, taskName: task.name, kind: "dialogue" })
          || ![task.dialogue, task.compaction].every(n => Number.isSafeInteger(n) && n >= 0)) {
          throw new Error("Invalid saved chat task counters");
        }
      }
      for (const [id, chat] of Object.entries(value.chats)) {
        const task = value.tasks[chat.taskKey];
        if (!/^[a-zA-Z0-9-]{1,128}$/.test(id) || !task || !["dialogue", "compaction"].includes(chat.kind)
          || !Number.isSafeInteger(chat.index) || chat.index < 1 || chat.index > task[chat.kind]
          || !Number.isFinite(chat.createdAt) || typeof chat.title !== "string" || chat.title.length > 220
          || typeof chat.named !== "boolean") throw new Error("Invalid saved chat entry");
      }
      this.state = value;
    } catch (error) {
      // Never reset counters or overwrite corrupt evidence silently.
      if (error.code !== "ENOENT") throw error;
    }
  }

  bind(id, metadata, createdAt, conversationKey) {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(id) || !validSavedChatTask(metadata)) throw new Error("Invalid saved chat binding");
    const existing = this.state.chats[id];
    if (existing) {
      if (existing.taskKey !== metadata.taskKey || existing.kind !== metadata.kind
        || existing.conversationKey !== conversationKey) throw new Error("Saved chat ownership mismatch");
      return { ...existing };
    }
    if (Object.keys(this.state.chats).length >= 50_000
      || (!this.state.tasks[metadata.taskKey] && Object.keys(this.state.tasks).length >= 10_000)) {
      throw new Error("Saved chat naming ledger is full");
    }
    const next = structuredClone(this.state);
    const task = next.tasks[metadata.taskKey] ??= { name: metadata.taskName, dialogue: 0, compaction: 0 };
    const index = ++task[metadata.kind];
    const chat = next.chats[id] = {
      taskKey: metadata.taskKey, kind: metadata.kind, index, createdAt,
      title: savedChatTitle(createdAt, task.name, metadata.kind, index), named: false,
      ...(conversationKey ? { conversationKey } : {}),
    };
    this.save(next);
    return { ...chat };
  }

  markNamed(id) {
    if (!this.state.chats[id]) throw new Error("Saved chat is not registered");
    if (this.state.chats[id].named) return;
    const next = structuredClone(this.state);
    next.chats[id].named = true;
    this.save(next);
  }

  save(next) {
    writePrivateFileAtomic(this.filePath, `${JSON.stringify(next)}\n`);
    this.state = next;
  }
}

module.exports = { SavedChatHistory };
