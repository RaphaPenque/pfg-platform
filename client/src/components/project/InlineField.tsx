import { useState, useRef, useEffect, useCallback } from "react";
import { Pencil, Loader2, Check } from "lucide-react";

interface InlineFieldProps {
  value: string | number | null;
  onSave: (newValue: string) => Promise<void>;
  type?: "text" | "email" | "number" | "date" | "select" | "textarea";
  options?: { value: string; label: string }[];
  placeholder?: string;
  emptyLabel?: string;
  canEdit?: boolean;
}

export default function InlineField({
  value,
  onSave,
  type = "text",
  options,
  placeholder,
  emptyLabel = "— Not set —",
  canEdit = true,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  const displayValue = value != null && value !== "" ? String(value) : "";

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (type !== "select" && "select" in inputRef.current) {
        (inputRef.current as HTMLInputElement).select();
      }
    }
  }, [editing, type]);

  const startEdit = useCallback(() => {
    if (!canEdit || saving) return;
    setDraft(displayValue);
    setError(null);
    setEditing(true);
  }, [canEdit, saving, displayValue]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === displayValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1000);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [draft, displayValue, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        cancel();
      } else if (e.key === "Enter" && type !== "textarea") {
        e.preventDefault();
        save();
      }
    },
    [cancel, save, type],
  );

  // --- View mode ---
  if (!editing) {
    const optionLabel =
      type === "select" && options && displayValue
        ? options.find((o) => o.value === displayValue)?.label || displayValue
        : displayValue;

    return (
      <div
        className="group relative inline-flex items-center gap-1.5 min-h-[24px] rounded px-1 -mx-1 transition-colors"
        style={{ cursor: canEdit ? "pointer" : "default" }}
        onClick={canEdit ? startEdit : undefined}
      >
        {showSuccess ? (
          <span className="flex items-center gap-1 text-[13px] font-medium" style={{ color: "var(--green)" }}>
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        ) : optionLabel ? (
          <span className="font-medium text-pfg-navy">{optionLabel}</span>
        ) : (
          <span style={{ color: "#9ca3af" }}>{emptyLabel}</span>
        )}
        {canEdit && !showSuccess && (
          <Pencil
            className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity shrink-0"
            style={{ color: "var(--pfg-steel)" }}
          />
        )}
      </div>
    );
  }

  // --- Edit mode ---
  const inputStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "3px 6px",
    borderRadius: 6,
    border: "1.5px solid hsl(var(--border))",
    outline: "none",
    width: "100%",
    background: "hsl(var(--card))",
    color: "var(--pfg-navy)",
    fontFamily: "inherit",
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {type === "textarea" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder={placeholder}
            style={{ ...inputStyle, resize: "vertical" }}
            disabled={saving}
          />
        ) : type === "select" ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // Auto-save on selection
              const val = e.target.value;
              setSaving(true);
              setError(null);
              onSave(val.trim())
                .then(() => {
                  setEditing(false);
                  setShowSuccess(true);
                  setTimeout(() => setShowSuccess(false), 1000);
                })
                .catch((err: any) => setError(err?.message || "Save failed"))
                .finally(() => setSaving(false));
            }}
            onBlur={cancel}
            onKeyDown={handleKeyDown}
            style={inputStyle}
            disabled={saving}
          >
            <option value="">— Select —</option>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type === "email" ? "text" : type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={inputStyle}
            disabled={saving}
          />
        )}
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "var(--pfg-steel)" }} />}
      </div>
      {error && (
        <span className="text-[11px] font-medium" style={{ color: "var(--red)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
