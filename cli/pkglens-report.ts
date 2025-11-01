#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  PackageDefinition,
  ResolveOptions,
  resolvePackageGraph,
} from '../src/lib/VersionResolver';
import { normalizePackageDefinition, sanitizePackageName } from '../src/utils/packageDefinition';
import {
  ReportFormat,
  createAnalysisReport,
  formatAnalysisReportAsMarkdown,
} from '../src/utils/reporting';

interface CliOptions {
  packagePath: string;
  formats: ReportFormat[];
  outputDir?: string;
  includeDev: boolean;
  includePeer: boolean;
  maxDepth: number;
  source?: string;
}

function printUsage(): void {
  const message = `PkgLens - Generador de informes de dependencias\n\n` +
    `Uso: pkglens-report <ruta-al-package.json> [opciones]\n\n` +
    `Opciones:\n` +
    `  -f, --format <json|markdown|json,markdown>  Formatos a exportar (por defecto json).\n` +
    `  -o, --output <directorio>                   Directorio donde guardar los archivos generados.\n` +
    `      --include-dev                          Incluir devDependencies en el análisis.\n` +
    `      --no-peer                              Excluir peerDependencies del análisis.\n` +
    `      --max-depth <n>                        Profundidad máxima del grafo (por defecto 6).\n` +
    `      --source <texto>                       Etiqueta descriptiva para el informe generado.\n` +
    `  -h, --help                                 Mostrar esta ayuda.\n`;
  console.log(message);
}

function parseFormats(value: string): ReportFormat[] {
  const normalized = value.split(',').map((entry) => entry.trim().toLowerCase());
  if (normalized.includes('both')) {
    return ['json', 'markdown'];
  }
  const formats = normalized.map((entry) => {
    if (entry === 'json') {
      return 'json';
    }
    if (entry === 'markdown' || entry === 'md') {
      return 'markdown';
    }
    throw new Error(`Formato no soportado: ${entry}`);
  });
  const unique = Array.from(new Set(formats));
  if (unique.length === 0) {
    throw new Error('Debes indicar al menos un formato válido (json o markdown).');
  }
  return unique;
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let packagePath: string | null = null;
  let formats: ReportFormat[] = ['json'];
  let outputDir: string | undefined;
  let includeDev = false;
  let includePeer = true;
  let maxDepth = 6;
  let source: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '-f':
      case '--format': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('Debes indicar un valor para --format.');
        }
        formats = parseFormats(value);
        index += 1;
        break;
      }
      case '-o':
      case '--output': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('Debes indicar una ruta para --output.');
        }
        outputDir = value;
        index += 1;
        break;
      }
      case '--include-dev':
        includeDev = true;
        break;
      case '--no-peer':
        includePeer = false;
        break;
      case '--max-depth': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('Debes indicar un número para --max-depth.');
        }
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('El parámetro --max-depth debe ser un entero positivo.');
        }
        maxDepth = parsed;
        index += 1;
        break;
      }
      case '--source': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('Debes proporcionar un texto para --source.');
        }
        source = value;
        index += 1;
        break;
      }
      default: {
        if (arg.startsWith('-')) {
          throw new Error(`Argumento no reconocido: ${arg}`);
        }
        if (!packagePath) {
          packagePath = arg;
          break;
        }
        throw new Error(`Se proporcionaron argumentos adicionales no reconocidos: ${arg}`);
      }
    }
  }

  if (!packagePath) {
    throw new Error('Debes indicar la ruta del package.json a analizar.');
  }

  return { packagePath, formats, outputDir, includeDev, includePeer, maxDepth, source };
}

function buildResolveOptions(options: CliOptions): ResolveOptions {
  const resolveOptions: ResolveOptions = {
    includeDev: options.includeDev,
    includePeer: options.includePeer,
    maxDepth: options.maxDepth,
  };
  return resolveOptions;
}

async function readPackageDefinition(filePath: string): Promise<{
  definition: PackageDefinition;
  rawManifest: Record<string, unknown>;
}> {
  const content = await readFile(filePath, 'utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`No se pudo interpretar el package.json ${filePath}: ${(error as Error).message}`);
  }
  const definition = normalizePackageDefinition(parsed);
  return { definition, rawManifest: parsed };
}

function deriveReportFileBase(manifestName: string | null, filePath: string): string {
  const fallback = path.basename(path.dirname(filePath)) || 'pkglens-report';
  const base = manifestName ?? fallback;
  const sanitized = sanitizeFileName(base);
  return sanitized.length > 0 ? sanitized : 'pkglens-report';
}

async function writeReportOutput(
  formats: ReportFormat[],
  outputDir: string,
  baseName: string,
  reportJson: string,
  reportMarkdown: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all(
    formats.map(async (format) => {
      const extension = format === 'json' ? 'json' : 'md';
      const targetPath = path.join(outputDir, `${baseName}.${extension}`);
      const payload = format === 'json' ? reportJson : reportMarkdown;
      await writeFile(targetPath, payload, 'utf8');
      console.log(`Informe ${format.toUpperCase()} generado en ${targetPath}`);
    }),
  );
}

function emitToStdout(formats: ReportFormat[], reportJson: string, reportMarkdown: string): void {
  formats.forEach((format, index) => {
    if (formats.length > 1) {
      process.stdout.write(`--- ${format.toUpperCase()} ---\n`);
    }
    if (format === 'json') {
      process.stdout.write(`${reportJson}\n`);
    } else {
      process.stdout.write(`${reportMarkdown}\n`);
    }
    if (index !== formats.length - 1) {
      process.stdout.write('\n');
    }
  });
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv);
    const absolutePath = path.resolve(process.cwd(), options.packagePath);
    const { definition, rawManifest } = await readPackageDefinition(absolutePath);
    const resolveOptions = buildResolveOptions(options);
    const result = await resolvePackageGraph(definition, resolveOptions);
    const manifestName = sanitizePackageName(rawManifest.name);
    const report = createAnalysisReport(result, {
      includeDev: options.includeDev,
      includePeer: options.includePeer,
      maxDepth: options.maxDepth,
      source: options.source ?? 'CLI',
      packageName: manifestName ?? undefined,
    });

    const reportJson = JSON.stringify(report, null, 2);
    const reportMarkdown = formatAnalysisReportAsMarkdown(report);

    if (options.outputDir) {
      const baseName = deriveReportFileBase(manifestName, absolutePath);
      await writeReportOutput(options.formats, options.outputDir, baseName, reportJson, reportMarkdown);
    } else {
      emitToStdout(options.formats, reportJson, reportMarkdown);
    }
  } catch (error) {
    console.error('[pkglens] Error al generar el informe:', (error as Error).message);
    process.exit(1);
  }
}

main();
