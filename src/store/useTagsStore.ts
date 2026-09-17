import { create } from "zustand";
import type { Tag } from "../types";
import * as tagsDb from "../db/tags";

interface TagsState {
  tags: Tag[];
  loaded: boolean;
  load: () => Promise<void>;
  findOrCreate: (name: string) => Promise<Tag>;
  remove: (id: string) => Promise<void>;
}

export const useTagsStore = create<TagsState>((set, get) => ({
  tags: [],
  loaded: false,
  load: async () => {
    const tags = await tagsDb.listTags();
    set({ tags, loaded: true });
  },
  findOrCreate: async (name: string) => {
    const tag = await tagsDb.findOrCreateTag(name);
    if (!get().tags.some((t) => t.id === tag.id)) {
      set({ tags: [...get().tags, tag].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return tag;
  },
  remove: async (id: string) => {
    await tagsDb.deleteTag(id);
    set({ tags: get().tags.filter((t) => t.id !== id) });
  },
}));
