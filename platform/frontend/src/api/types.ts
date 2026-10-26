export interface CollectionFieldRules {
  mode?: 'strict' | 'review'; sourceLabel?: string;
  format?: 'text' | 'date'; enumValues?: string[]; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; integer?: boolean; sourceUnit?: string; multiplier?: number;
  trueValues?: string[]; falseValues?: string[];
}
export interface CollectionConfig {
  trigger: 'all' | 'mention';
  prompt: string;
  constraints: string;
  keywords: string[];
  fields: Array<{ key: string; label: string; type: 'string' | 'number' | 'boolean'; required: boolean; description: string; rules?: CollectionFieldRules }>;
}

export interface Robot {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  description?: string;
  difyAppId?: string;
  workflowId?: string;
  configHistory?: Array<{ version: number; publishedAt: string; config: unknown }>;
  ragConfig?: { mode?: 'qa' | 'collector'; collection?: CollectionConfig; personality?: string; tone?: string; responseFormat?: string; answerDetail?: 'concise' | 'detailed'; rerankModelId?: string; wikiRootIds?: string[]; primaryModelId?: string; fallbackModelId?: string; systemPrompt?: string; topK?: number; searchMethod?: 'keyword_search' | 'semantic_search' | 'hybrid_search'; scoreThreshold?: number; historyTurns?: number; compressionThreshold?: number; toolsEnabled?: boolean };
  kbPool: string[];
  toolIdentifiers: string[];
  humanHandoff: { enabled: boolean; fallback: string };
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'DELETED';
  createdAt: string;
}

export interface Group {
  id: string;
  tenantId: string;
  chatId: string;
  name?: string;
  groupType: 'internal' | 'customer';
  robotId?: string;
  status: 'PENDING' | 'BOUND' | 'DISABLED';
  handoffRole?: string;
  channel?: string;
}
