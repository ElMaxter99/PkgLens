import React, { useMemo, useState } from 'react';

import { PackageDefinition } from '../lib/VersionResolver';

import './ScenarioEditor.css';

type SectionKey = 'dependencies' | 'devDependencies';

interface DraftState {
  name: string;
  version: string;
}

export interface ScenarioEditorProps {
  basePackage: PackageDefinition | null;
  value: PackageDefinition | null;
  onChange: (pkg: PackageDefinition | null) => void;
  onReset: () => void;
  disabled?: boolean;
}

const createDraft = (): DraftState => ({ name: '', version: '' });

const ensureSection = (source: PackageDefinition | null, key: SectionKey): Record<string, string> => ({
  ...(source?.[key] ?? {}),
});

const buildPackage = (base: PackageDefinition | null): PackageDefinition | null => {
  if (!base) {
    return null;
  }
  return {
    dependencies: ensureSection(base, 'dependencies'),
    devDependencies: ensureSection(base, 'devDependencies'),
  };
};

const cleanPackage = (pkg: PackageDefinition | null): PackageDefinition | null => {
  if (!pkg) {
    return null;
  }
  const next: PackageDefinition = {};
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    next.dependencies = pkg.dependencies;
  }
  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
    next.devDependencies = pkg.devDependencies;
  }
  return next;
};

export const ScenarioEditor: React.FC<ScenarioEditorProps> = ({
  basePackage,
  value,
  onChange,
  onReset,
  disabled,
}) => {
  const [drafts, setDrafts] = useState<Record<SectionKey, DraftState>>(() => ({
    dependencies: createDraft(),
    devDependencies: createDraft(),
  }));

  const packageValue = useMemo(() => value ?? buildPackage(basePackage), [value, basePackage]);

  const handleVersionChange = (section: SectionKey, name: string, version: string) => {
    if (!packageValue) {
      return;
    }
    const sectionValue = { ...(packageValue[section] ?? {}) };
    sectionValue[name] = version;
    const nextPackage = cleanPackage({
      dependencies: section === 'dependencies' ? sectionValue : ensureSection(packageValue, 'dependencies'),
      devDependencies: section === 'devDependencies' ? sectionValue : ensureSection(packageValue, 'devDependencies'),
    });
    onChange(nextPackage);
  };

  const handleRemove = (section: SectionKey, name: string) => {
    if (!packageValue) {
      return;
    }
    const sectionValue = { ...(packageValue[section] ?? {}) };
    delete sectionValue[name];
    const nextPackage = cleanPackage({
      dependencies: section === 'dependencies' ? sectionValue : ensureSection(packageValue, 'dependencies'),
      devDependencies: section === 'devDependencies' ? sectionValue : ensureSection(packageValue, 'devDependencies'),
    });
    onChange(nextPackage);
  };

  const handleDraftChange = (section: SectionKey, field: keyof DraftState, valueDraft: string) => {
    setDrafts((previous) => ({
      ...previous,
      [section]: {
        ...previous[section],
        [field]: valueDraft,
      },
    }));
  };

  const handleAdd = (section: SectionKey) => {
    const draft = drafts[section];
    const name = draft.name.trim();
    const version = draft.version.trim();
    if (!name || !version) {
      return;
    }
    const sectionValue = {
      ...(packageValue?.[section] ?? {}),
      [name]: version,
    };
    const nextPackage = cleanPackage({
      dependencies: section === 'dependencies' ? sectionValue : ensureSection(packageValue, 'dependencies'),
      devDependencies: section === 'devDependencies' ? sectionValue : ensureSection(packageValue, 'devDependencies'),
    });
    onChange(nextPackage);
    setDrafts((previous) => ({
      ...previous,
      [section]: createDraft(),
    }));
  };

  const renderSection = (section: SectionKey, title: string, description: string) => {
    const entries = Object.entries(packageValue?.[section] ?? {});
    const draft = drafts[section];
    return (
      <div className="scenario__section">
        <header className="scenario__section-header">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button type="button" className="scenario__reset" onClick={() => onReset()} disabled={disabled}>
            Restaurar desde objetivo
          </button>
        </header>
        <div className="scenario__list" role="table" aria-label={title}>
          {entries.length === 0 && <p className="scenario__empty">No hay dependencias en esta sección.</p>}
          {entries.map(([name, version]) => (
            <div key={`${section}-${name}`} className="scenario__row" role="row">
              <div className="scenario__cell scenario__cell--name" role="cell">
                <span title={name}>{name}</span>
              </div>
              <div className="scenario__cell scenario__cell--input" role="cell">
                <label className="scenario__label" htmlFor={`${section}-${name}`}>
                  Versión
                </label>
                <input
                  id={`${section}-${name}`}
                  type="text"
                  value={version}
                  onChange={(event) => handleVersionChange(section, name, event.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="scenario__cell scenario__cell--actions" role="cell">
                <button
                  type="button"
                  className="scenario__remove"
                  onClick={() => handleRemove(section, name)}
                  aria-label={`Eliminar ${name}`}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
          <div className="scenario__row scenario__row--new" role="row">
            <div className="scenario__cell scenario__cell--name" role="cell">
              <input
                type="text"
                placeholder="Nombre del paquete"
                value={draft.name}
                onChange={(event) => handleDraftChange(section, 'name', event.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="scenario__cell scenario__cell--input" role="cell">
              <label className="scenario__label" htmlFor={`nuevo-${section}`}>
                Versión
              </label>
              <input
                id={`nuevo-${section}`}
                type="text"
                placeholder="^1.0.0"
                value={draft.version}
                onChange={(event) => handleDraftChange(section, 'version', event.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="scenario__cell scenario__cell--actions" role="cell">
              <button
                type="button"
                className="scenario__add"
                onClick={() => handleAdd(section)}
                disabled={!draft.name.trim() || !draft.version.trim()}
              >
                Añadir
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!packageValue) {
    return (
      <section className="scenario">
        <header className="scenario__header">
          <div>
            <h2>3. Escenario “what-if”</h2>
            <p className="scenario__description">
              Importa primero el paquete objetivo para habilitar el editor de escenarios y simular cambios de versión sin
              afectar tus archivos.
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="scenario">
      <header className="scenario__header">
        <div>
          <h2>3. Escenario “what-if”</h2>
          <p className="scenario__description">
            Ajusta versiones, añade dependencias opcionales o elimina las que ya no necesitas. Ejecuta nuevamente el análisis
            para estimar el impacto antes de aplicar cambios reales.
          </p>
        </div>
      </header>
      <div className="scenario__grid">
        {renderSection(
          'dependencies',
          'Dependencias productivas',
          'Incluye librerías que se distribuirán con el build final.',
        )}
        {renderSection('devDependencies', 'Dependencias de desarrollo', 'Solo necesarias para tareas locales o de CI/CD.')}
      </div>
    </section>
  );
};

