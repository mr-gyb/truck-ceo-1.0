/**
 * Data-intake entry point: detect a Flowers IDP document from its text
 * layer, parse it into the shared schema, and produce its ingestion
 * registry entry. Pure/deterministic — the deploy-time wrapper (Storage
 * trigger -> extract text -> this -> Firestore writes) lives in
 * ./ingest.ts; text extraction from PDF buffers lives in ./pdfText.ts.
 */

import {
  FLOWERS_PARSER_VERSION,
  FlowersDocType,
  detectFlowersDocType,
  parseFlowersMarginDetail,
  parseFlowersShrinkReport,
  parseFlowersStatement,
  FlowersMarginDetailRecord,
} from './flowersIdp';
import {
  FlowersShrinkRecord,
  IngestionRegistryEntry,
  Provenance,
  SettlementRecord,
  SourceRef,
} from './types';

export * from './types';
export {
  FLOWERS_PARSER_VERSION,
  detectFlowersDocType,
  parseFlowersStatement,
  parseFlowersMarginDetail,
  parseFlowersShrinkReport,
};
export type { FlowersDocType, FlowersMarginDetailRecord };

export type FlowersParseOutput =
  | { docType: 'flowers_master_statement' | 'flowers_distributor_statement'; record: SettlementRecord; registry: IngestionRegistryEntry }
  | { docType: 'flowers_margin_detail'; record: FlowersMarginDetailRecord; registry: IngestionRegistryEntry }
  | { docType: 'flowers_sbt_shrink'; record: FlowersShrinkRecord; registry: IngestionRegistryEntry };

export function registryIdFor(sourceType: string, routeKey: string, weekEnding: string): string {
  return `${sourceType}_${routeKey}_${weekEnding}`;
}

export function parseFlowersDocument(
  text: string,
  opts: {
    businessId: string;
    provenance: Provenance;
    storagePath?: string;
    ingestedAt?: string;
  },
): FlowersParseOutput {
  const docType = detectFlowersDocType(text);
  if (!docType) throw new Error('unrecognized Flowers IDP document');
  const ingestedAt = opts.ingestedAt || new Date().toISOString();
  const source: SourceRef = {
    fileName: opts.provenance.fileName || '',
    storagePath: opts.storagePath,
    parserVersion: FLOWERS_PARSER_VERSION,
    ingestedAt,
  };

  const base = {
    businessId: opts.businessId,
    sourceType: docType,
    provenance: opts.provenance,
    parserVersion: FLOWERS_PARSER_VERSION,
    ingestedAt,
  } as const;

  if (docType === 'flowers_master_statement' || docType === 'flowers_distributor_statement') {
    const registryId = registryIdFor(docType, 'pending', 'pending');
    const record = parseFlowersStatement(text, source, registryId);
    const id = registryIdFor(docType, record.kind === 'master' ? 'master' : record.routeNumber, record.weekEnding);
    record.registryId = id;
    record.sources[0].documentId = record.distributorNumber;
    return {
      docType,
      record,
      registry: {
        ...base,
        id,
        routeNumber: record.kind === 'master' ? undefined : record.routeNumber,
        grain: 'business-week',
        weekEnding: record.weekEnding,
        status: record.validation.status,
        recordPath: `businesses/${opts.businessId}/routes/${record.routeNumber}/settlements/${record.weekEnding}`,
        discrepancy: record.validation.discrepancies.join('; ') || undefined,
      },
    };
  }

  if (docType === 'flowers_margin_detail') {
    const registryId = registryIdFor(docType, 'pending', 'pending');
    const record = parseFlowersMarginDetail(text, source, registryId);
    const id = registryIdFor(docType, record.routeNumber, record.weekEnding);
    record.registryId = id;
    record.sources[0].documentId = record.distributorNumber;
    return {
      docType,
      record,
      registry: {
        ...base,
        id,
        routeNumber: record.routeNumber,
        grain: 'route-week',
        weekEnding: record.weekEnding,
        status: record.validation.status,
        discrepancy: record.validation.discrepancies.join('; ') || undefined,
      },
    };
  }

  // flowers_sbt_shrink — keyed by the COVERED week read from the document.
  const registryId = registryIdFor(docType, 'pending', 'pending');
  const record = parseFlowersShrinkReport(text, source, registryId);
  const id = registryIdFor(docType, record.routeNumber, record.weekEnding);
  record.registryId = id;
  record.sources[0].documentId = record.distributorNumber;
  return {
    docType,
    record,
    registry: {
      ...base,
      id,
      routeNumber: record.routeNumber,
      grain: 'route-week',
      weekEnding: record.weekEnding,
      status: record.validation.status,
      recordPath: `businesses/${opts.businessId}/routes/${record.routeNumber}/shrinkReports/${record.weekEnding}`,
      discrepancy: record.validation.discrepancies.join('; ') || undefined,
    },
  };
}
