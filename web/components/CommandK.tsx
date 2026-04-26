"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import MiniSearch, { type SearchResult } from "minisearch";
import { useRouter } from "next/navigation";
import { MINISEARCH_OPTIONS, type SearchDoc } from "@/lib/search-shared";

type Hit = SearchResult & Pick<
  SearchDoc,
  | "domainId"
  | "domainName"
  | "tableId"
  | "tableName"
  | "href"
  | "name"
  | "gotchas"
  | "gotchaCount"
>;

let cachedIndex: MiniSearch<SearchDoc> | null = null;
let pendingFetch: Promise<MiniSearch<SearchDoc>> | null = null;

async function getIndex(): Promise<MiniSearch<SearchDoc>> {
  if (cachedIndex) return cachedIndex;
  if (pendingFetch) return pendingFetch;
  pendingFetch = fetch("/search-index.json")
    .then((r) => r.text())
    .then((json) => {
      cachedIndex = MiniSearch.loadJSON<SearchDoc>(json, MINISEARCH_OPTIONS);
      return cachedIndex;
    });
  return pendingFetch;
}

export default function CommandK() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || ready) return;
    getIndex().then(() => setReady(true));
  }, [open, ready]);

  useEffect(() => {
    if (open) {
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !ready) return;
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    getIndex().then((ms) => {
      if (cancelled) return;
      const results = ms.search(query) as Hit[];
      setHits(results.slice(0, 25));
      setActiveIdx(0);
    });
    return () => {
      cancelled = true;
    };
  }, [query, open, ready]);

  const navigate = useCallback(
    (hit: Hit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  const onKeyNav = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[activeIdx]) navigate(hits[activeIdx]);
    }
  };

  const shortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "⌘K";
    return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
  }, []);

  return (
    <>
      <button
        type="button"
        className="cmdk-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open search"
      >
        <span>Search</span>
        <kbd>{shortcutLabel}</kbd>
      </button>

      {open && (
        <div
          className="cmdk-overlay"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="cmdk-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Search"
          >
            <input
              ref={inputRef}
              className="cmdk-input"
              placeholder="Search entities, fields, gotchas… (Esc to close)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyNav}
              autoComplete="off"
              spellCheck={false}
            />
            {!ready && <p className="cmdk-status">Loading index…</p>}
            {ready && query && hits.length === 0 && (
              <p className="cmdk-status">No matches.</p>
            )}
            {hits.length > 0 && (
              <ul className="cmdk-results">
                {hits.map((hit, i) => (
                  <li
                    key={hit.id}
                    className={`cmdk-result${i === activeIdx ? " active" : ""}`}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => navigate(hit)}
                  >
                    <div className="cmdk-result-meta">{hit.domainName}</div>
                    <div className="cmdk-result-title">
                      <code>{hit.tableId}</code> {hit.name}
                      {hit.gotchaCount > 0 && (
                        <span className="cmdk-gotcha">
                          ⚠ {hit.gotchaCount}
                        </span>
                      )}
                    </div>
                    {snippetFor(hit) && (
                      <div className="cmdk-result-snippet">
                        {snippetFor(hit)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// If the match landed inside gotcha text, show a 80-char window around it
// so users know which gotcha matched.
function snippetFor(hit: Hit): string | null {
  if (!hit.gotchas) return null;
  const terms = (hit.terms ?? []).filter(Boolean);
  if (terms.length === 0) return null;
  const pattern = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(.{0,40})(${pattern})(.{0,40})`, "i");
  const m = hit.gotchas.match(re);
  if (!m) return null;
  return `…${m[0].trim()}…`;
}
