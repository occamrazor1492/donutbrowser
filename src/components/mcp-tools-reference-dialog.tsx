"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuSearch } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Read-only reference panel listing every tool the in-process MCP server
 * advertises. Two audiences:
 *  - human user: "what can I tell my agent to do via this URL?"
 *  - LLM-as-operator: same question, surfaced from settings without
 *    needing to start the server and call tools/list itself.
 *
 * Backed by the `list_mcp_tools` Tauri command which returns the
 * runtime tool registry, so this stays accurate as the registry evolves.
 */
interface McpToolMetadata {
  name: string;
  description: string;
  // `inputSchema` is JSON Schema for the tool's parameters; we render it
  // as pretty-printed JSON rather than trying to construct a form UI
  // — the audience for this panel is power users / LLMs, both of whom
  // can read raw JSON Schema faster than they can navigate a form.
  inputSchema: unknown;
}

interface McpToolsReferenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function McpToolsReferenceDialog({
  isOpen,
  onClose,
}: McpToolsReferenceDialogProps) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<McpToolMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await invoke<McpToolMetadata[]>("list_mcp_tools");
      setTools(items);
    } catch (err) {
      console.error("Failed to list MCP tools:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  // Group by leading verb (run_*, get_*, list_*, screenshot, click, etc.)
  // so a 50-item list stays scannable. Group inference is cheap text
  // matching — if a tool name has no underscore it lands in "other".
  const grouped = useMemo(() => {
    const filtered = tools.filter((t) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
    const buckets = new Map<string, McpToolMetadata[]>();
    for (const tool of filtered) {
      const underscore = tool.name.indexOf("_");
      const verb =
        underscore > 0 ? tool.name.slice(0, underscore) : "interaction";
      const list = buckets.get(verb) ?? [];
      list.push(tool);
      buckets.set(verb, list);
    }
    return Array.from(buckets.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [tools, query]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("mcpTools.title")}</DialogTitle>
          <DialogDescription>
            {t("mcpTools.description", { count: tools.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <LuSearch className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mcpTools.searchPlaceholder")}
            className="pl-9"
          />
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {isLoading && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("common.labels.loading")}
            </p>
          )}
          {!isLoading && tools.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("mcpTools.empty")}
            </p>
          )}
          {!isLoading && tools.length > 0 && grouped.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("mcpTools.noMatch")}
            </p>
          )}
          {!isLoading &&
            grouped.map(([verb, items]) => (
              <div key={verb} className="space-y-1">
                <div className="flex items-center gap-2 sticky top-0 bg-background py-1 z-10">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {verb}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                {items.map((tool) => {
                  const isOpen = expandedTool === tool.name;
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => setExpandedTool(isOpen ? null : tool.name)}
                      className="w-full text-left rounded-md border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <code className="text-sm font-mono font-medium">
                          {tool.name}
                        </code>
                        <span className="text-[10px] text-muted-foreground">
                          {isOpen
                            ? t("mcpTools.collapseSchema")
                            : t("mcpTools.expandSchema")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                        {tool.description}
                      </p>
                      {isOpen && (
                        <pre className="mt-2 text-[11px] bg-muted/60 rounded p-2 overflow-x-auto font-mono">
                          {JSON.stringify(tool.inputSchema, null, 2)}
                        </pre>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
