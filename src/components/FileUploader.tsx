import React, { ChangeEvent, ClipboardEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import './FileUploader.css';

export interface FileUploaderProps {
  id: string;
  title: string;
  description: string;
  onPackageChange: (pkg: Record<string, unknown>) => void;
  onError: (message: string) => void;
  defaultValue?: string;
  exampleValue?: string;
  actionLabel?: string;
}

const DEFAULT_EXAMPLE = `{
  "name": "demo-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}`;

type EditorError = {
  label: string;
  line?: number;
  column?: number;
  detail?: string;
};

type HistoryEntry = {
  id: string;
  name: string;
  content: string;
  timestamp: number;
};

type ParseOptions = {
  recordHistory?: boolean;
  sourceName?: string;
};

type SelectionRange = { start: number; end: number };

const HISTORY_LIMIT = 5;

const HISTORY_STORAGE_PREFIX = 'pkgLens.history.';

const PAIR_MAP: Record<string, string> = {
  '{': '}',
  '[': ']',
  '"': '"',
};

const buildStorageKey = (componentId: string): string => `${HISTORY_STORAGE_PREFIX}${componentId}`;

const createHistoryEntry = (name: string, content: string): HistoryEntry => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name,
  content,
  timestamp: Date.now(),
});

const parseErrorDetails = (error: unknown, text: string): EditorError => {
  const detail = error instanceof Error ? error.message : undefined;
  let line: number | undefined;
  let column: number | undefined;

  if (detail) {
    const lineColumnMatch = detail.match(/line (\d+) column (\d+)/i);
    if (lineColumnMatch) {
      line = Number(lineColumnMatch[1]);
      column = Number(lineColumnMatch[2]);
    }

    if (line === undefined || Number.isNaN(line)) {
      const positionMatch = detail.match(/position (\d+)/i);
      if (positionMatch) {
        const position = Number(positionMatch[1]);
        if (!Number.isNaN(position)) {
          const preceding = text.slice(0, position);
          const segments = preceding.split(/\r?\n/);
          line = segments.length;
          column = segments[segments.length - 1]?.length + 1 ?? 1;
        }
      }
    }
  }

  const friendly = line && column ? `JSON inválido en línea ${line}, columna ${column}.` : 'JSON inválido.';
  const label = detail ? `${friendly} Detalle: ${detail}` : friendly;

  return {
    label,
    line,
    column,
    detail,
  };
};

export const FileUploader: React.FC<FileUploaderProps> = ({
  id,
  title,
  description,
  onPackageChange,
  onError,
  defaultValue,
  exampleValue,
  actionLabel,
}) => {
  const resolvedExample = exampleValue ?? DEFAULT_EXAMPLE;
  const [rawText, setRawText] = useState<string>(defaultValue ?? resolvedExample);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [editorError, setEditorError] = useState<EditorError | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');

  const historyStorageKey = useMemo(() => buildStorageKey(id), [id]);

  const lines = useMemo(() => rawText.split(/\r?\n/), [rawText]);

  useEffect(() => {
    try {
      const json = JSON.parse(rawText);
      onPackageChange(json);
      setEditorError(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? `El contenido inicial no es válido: ${error.message}`
          : 'El contenido inicial no es válido.';
      onError(message);
      setEditorError(parseErrorDetails(error, rawText));
    }
    // Solo ejecutar al montar el componente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem(historyStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryEntry[];
        if (Array.isArray(parsed)) {
          const sanitized = parsed.filter(
            (item): item is HistoryEntry =>
              typeof item === 'object' &&
              item !== null &&
              typeof (item as HistoryEntry).id === 'string' &&
              typeof (item as HistoryEntry).name === 'string' &&
              typeof (item as HistoryEntry).content === 'string' &&
              typeof (item as HistoryEntry).timestamp === 'number',
          );
          sanitized.sort((a, b) => b.timestamp - a.timestamp);
          setHistoryItems(sanitized.slice(0, HISTORY_LIMIT));
        }
      }
    } catch (storageError) {
      console.warn('No se pudo leer el historial almacenado.', storageError);
    }
  }, [historyStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(historyItems));
    } catch (storageError) {
      console.warn('No se pudo guardar el historial.', storageError);
    }
  }, [historyItems, historyStorageKey]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const wasApplied = applyChange(text, { recordHistory: true, sourceName: file.name });
      if (wasApplied) {
        setFileName(file.name);
      }
    } catch (error) {
      console.error('Error al leer el archivo seleccionado', error);
      onError('No se pudo leer el archivo seleccionado.');
    }
  };

  const parseAndNotify = (text: string, options?: ParseOptions): boolean => {
    try {
      const json = JSON.parse(text);
      onPackageChange(json);
      setEditorError(null);

      if (options?.recordHistory) {
        const formatted = JSON.stringify(json, null, 2);
        const historyName = options.sourceName ?? (fileName || 'Sin nombre');
        recordHistory(historyName, formatted);
        if (formatted !== text) {
          setRawText(formatted);
          requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
              return;
            }
            textarea.selectionStart = formatted.length;
            textarea.selectionEnd = formatted.length;
            textarea.scrollTop = 0;
            setScrollTop(0);
          });
        }
      }

      return true;
    } catch (error) {
      const details = parseErrorDetails(error, text);
      onError(details.label);
      setEditorError(details);
      return false;
    }
  };

  const handleTextAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setRawText(value);
    if (value.trim().length === 0) {
      const emptyLabel = 'El contenido está vacío.';
      onError(emptyLabel);
      setEditorError({ label: emptyLabel });
      return;
    }
    parseAndNotify(value);
  };

  useEffect(() => {
    if (typeof defaultValue === 'string' && defaultValue.trim().length > 0 && defaultValue !== rawText) {
      applyChange(defaultValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const handleReset = () => {
    applyChange(resolvedExample);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const recordHistory = (name: string, content: string) => {
    setHistoryItems((prev) => {
      const formattedContent = content;
      const withoutDuplicates = prev.filter((entry) => entry.content !== formattedContent);
      const nextEntry = createHistoryEntry(name, formattedContent);
      return [nextEntry, ...withoutDuplicates].slice(0, HISTORY_LIMIT);
    });
  };

  const applyChange = (value: string, options?: ParseOptions, selection?: SelectionRange): boolean => {
    setRawText(value);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      if (selection) {
        textarea.selectionStart = selection.start;
        textarea.selectionEnd = selection.end;
      } else {
        textarea.selectionStart = value.length;
        textarea.selectionEnd = value.length;
        textarea.scrollTop = 0;
      }

      setScrollTop(textarea.scrollTop);
    });

    if (value.trim().length === 0) {
      const emptyLabel = 'El contenido está vacío.';
      onError(emptyLabel);
      setEditorError({ label: emptyLabel });
      return false;
    }

    return parseAndNotify(value, options);
  };

  const handleHistorySelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const entryId = event.target.value;
    setSelectedHistoryId(entryId);
    if (!entryId) {
      return;
    }

    const entry = historyItems.find((item) => item.id === entryId);
    if (!entry) {
      setSelectedHistoryId('');
      return;
    }

    const applied = applyChange(entry.content, { recordHistory: true, sourceName: entry.name });
    if (applied) {
      setFileName(entry.name);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setSelectedHistoryId('');
    }
  };

  const handleRestoreLast = () => {
    if (historyItems.length === 0) {
      return;
    }
    const latest = historyItems[0];
    const applied = applyChange(latest.content, { recordHistory: true, sourceName: latest.name });
    if (applied) {
      setFileName(latest.name);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleTextareaScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  const replaceSelection = (insertion: string, selection: SelectionRange) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const { selectionStart, selectionEnd } = textarea;
    const before = rawText.slice(0, selectionStart);
    const after = rawText.slice(selectionEnd);
    const nextValue = `${before}${insertion}${after}`;
    applyChange(nextValue, undefined, selection);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const closing = PAIR_MAP[event.key];
    if (!closing) {
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    event.preventDefault();
    const { selectionStart, selectionEnd } = textarea;
    const selectedText = rawText.slice(selectionStart, selectionEnd);

    if (selectedText.length > 0) {
      const insertion = `${event.key}${selectedText}${closing}`;
      replaceSelection(insertion, { start: selectionStart + 1, end: selectionEnd + 1 });
      return;
    }

    const insertion = `${event.key}${closing}`;
    replaceSelection(insertion, { start: selectionStart + 1, end: selectionStart + 1 });
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData?.getData('text');
    if (!clipboard) {
      return;
    }

    event.preventDefault();

    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const formatted = (() => {
      try {
        const parsed = JSON.parse(clipboard.trim());
        return JSON.stringify(parsed, null, 2);
      } catch {
        return clipboard;
      }
    })();

    const { selectionStart, selectionEnd } = textarea;
    const before = rawText.slice(0, selectionStart);
    const after = rawText.slice(selectionEnd);
    const nextValue = `${before}${formatted}${after}`;
    const cursorPosition = selectionStart + formatted.length;
    applyChange(nextValue, undefined, { start: cursorPosition, end: cursorPosition });
  };

  return (
    <section className="uploader">
      <header className="uploader__header">
        <div>
          <h2>{title}</h2>
          <p className="uploader__hint">{description}</p>
        </div>
        <div className="uploader__actions">
          <button type="button" className="uploader__button" onClick={handleReset}>
            Restaurar ejemplo
          </button>
          <label className="uploader__button uploader__button--primary" htmlFor={`${id}-file`}>
            {fileName ? `Reemplazar (${fileName})` : actionLabel ?? 'Seleccionar archivo'}
          </label>
          <input
            id={`${id}-file`}
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="uploader__input"
            onChange={handleFileChange}
          />
        </div>
      </header>

      {historyItems.length > 0 && (
        <div className="uploader__history">
          <label className="uploader__history-label" htmlFor={`${id}-history`}>
            Historial reciente
          </label>
          <div className="uploader__history-controls">
            <select
              id={`${id}-history`}
              className="uploader__history-select"
              value={selectedHistoryId}
              onChange={handleHistorySelect}
            >
              <option value="">Selecciona una versión anterior</option>
              {historyItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {new Date(item.timestamp).toLocaleString()}
                </option>
              ))}
            </select>
            <button type="button" className="uploader__button" onClick={handleRestoreLast}>
              Recuperar último análisis
            </button>
          </div>
        </div>
      )}

      <div className={`uploader__editor${editorError ? ' uploader__editor--error' : ''}`}>
        <pre
          aria-hidden="true"
          className="uploader__overlay"
          style={{ transform: `translateY(-${scrollTop}px)` }}
        >
          {lines.map((line, index) => (
            <div
              key={`overlay-${index}`}
              className={`uploader__overlay-line${editorError?.line === index + 1 ? ' uploader__overlay-line--error' : ''}`}
            >
              {line || '\u00a0'}
            </div>
          ))}
        </pre>
        <textarea
          aria-label="Contenido de package.json"
          className="uploader__textarea"
          value={rawText}
          onChange={handleTextAreaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onScroll={handleTextareaScroll}
          ref={textareaRef}
          spellCheck={false}
        />
      </div>
      {editorError && (
        <p className="uploader__error" role="alert">
          {editorError.label}
        </p>
      )}
    </section>
  );
};
