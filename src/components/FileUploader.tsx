import React, { ChangeEvent, useEffect, useRef, useState } from 'react';

import './FileUploader.css';

export interface FileUploaderProps {
  onPackageChange: (pkg: Record<string, unknown>) => void;
  onError: (message: string) => void;
  defaultValue?: string;
}

const EXAMPLE_PACKAGE = `{
  "name": "demo-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}`;

export const FileUploader: React.FC<FileUploaderProps> = ({ onPackageChange, onError, defaultValue }) => {
  const [rawText, setRawText] = useState<string>(defaultValue ?? EXAMPLE_PACKAGE);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const json = JSON.parse(rawText);
      onPackageChange(json);
    } catch (error) {
      const message =
        error instanceof Error
          ? `El contenido inicial no es válido: ${error.message}`
          : 'El contenido inicial no es válido.';
      onError(message);
    }
    // Solo ejecutar al montar el componente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setRawText(text);
      parseAndNotify(text);
      setFileName(file.name);
    } catch (error) {
      console.error('Error al leer el archivo seleccionado', error);
      onError('No se pudo leer el archivo seleccionado.');
    }
  };

  const parseAndNotify = (text: string) => {
    try {
      const json = JSON.parse(text);
      onPackageChange(json);
    } catch (error) {
      const message =
        error instanceof Error
          ? `El archivo no contiene JSON válido: ${error.message}`
          : 'El archivo no contiene JSON válido.';
      onError(message);
    }
  };

  const handleTextAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setRawText(value);
    if (value.trim().length === 0) {
      onError('El contenido está vacío.');
      return;
    }
    parseAndNotify(value);
  };

  const handleReset = () => {
    setRawText(EXAMPLE_PACKAGE);
    setFileName('');
    parseAndNotify(EXAMPLE_PACKAGE);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <section className="uploader">
      <header className="uploader__header">
        <div>
          <h2>1. Sube o pega tu package.json</h2>
          <p className="uploader__hint">
            Arrastra un archivo package.json o pega el contenido manualmente. El analizador se actualizará en tiempo real.
          </p>
        </div>
        <div className="uploader__actions">
          <button type="button" className="uploader__button" onClick={handleReset}>
            Restaurar ejemplo
          </button>
          <label className="uploader__button uploader__button--primary" htmlFor="package-file">
            {fileName ? `Reemplazar (${fileName})` : 'Seleccionar archivo'}
          </label>
          <input
            id="package-file"
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="uploader__input"
            onChange={handleFileChange}
          />
        </div>
      </header>

      <textarea
        aria-label="Contenido de package.json"
        className="uploader__textarea"
        value={rawText}
        onChange={handleTextAreaChange}
        spellCheck={false}
      />
    </section>
  );
};
