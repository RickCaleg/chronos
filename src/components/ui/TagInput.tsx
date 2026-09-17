import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { Tag } from "../../types";
import { cn } from "../../lib/cn";

interface TagInputProps {
  value: Tag[];
  onChange: (tags: Tag[]) => void;
  suggestions: Tag[];
  onCreate: (name: string) => Promise<Tag>;
  placeholder?: string;
}

export function TagInput({ value, onChange, suggestions, onCreate, placeholder }: TagInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const attachedIds = useMemo(() => new Set(value.map((t) => t.id)), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = suggestions.filter((t) => !attachedIds.has(t.id));
    const list = q ? available.filter((t) => t.name.toLowerCase().includes(q)) : available;
    return list.slice(0, 8);
  }, [suggestions, attachedIds, query]);

  const canCreate = query.trim().length > 0 && !suggestions.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length, canCreate]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function addTag(tag: Tag) {
    onChange([...value, tag]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeTag(id: string) {
    onChange(value.filter((t) => t.id !== id));
  }

  async function handleCreate() {
    const tag = await onCreate(query.trim());
    addTag(tag);
  }

  const totalOptions = filtered.length + (canCreate ? 1 : 0);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open && totalOptions > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % totalOptions);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + totalOptions) % totalOptions);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (highlight < filtered.length) addTag(filtered[highlight]);
        else handleCreate();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
    }
    if (e.key === "Backspace" && query === "" && value.length > 0) {
      removeTag(value[value.length - 1].id);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[2px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 focus-within:border-[var(--color-accent)]">
        {value.map((tag) => (
          <span
            key={tag.id}
            className="flex items-center gap-1 rounded-[2px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-xs text-[var(--color-text)]"
          >
            {tag.name}
            <button
              type="button"
              onClick={() => removeTag(tag.id)}
              aria-label={tag.name}
              className="text-[var(--color-text-muted)] outline-none hover:text-[var(--color-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="min-w-[6rem] flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      {open && totalOptions > 0 && (
        <div className="absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-[2px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-md">
          {filtered.map((tag, i) => (
            <button
              key={tag.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(tag)}
              className={cn(
                "block w-full truncate px-3 py-1.5 text-left text-sm",
                i === highlight ? "bg-[var(--color-surface-hover)]" : "hover:bg-[var(--color-surface-hover)]",
              )}
            >
              {tag.name}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate}
              className={cn(
                "block w-full truncate px-3 py-1.5 text-left text-sm text-[var(--color-accent)]",
                highlight === filtered.length ? "bg-[var(--color-surface-hover)]" : "hover:bg-[var(--color-surface-hover)]",
              )}
            >
              {query.trim()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
