import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('model_configs')
export class ModelConfig {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ name: 'base_url' }) baseUrl: string;
  @Column() model: string;
  @Column({ default: 'chat' }) purpose: 'chat' | 'embedding' | 'rerank';
  @Column({ name: 'api_key', type: 'text', default: '' }) apiKey: string;
  @Column({ name: 'context_window', default: 8192 }) contextWindow: number;
  @Column({ name: 'max_output_tokens', default: 1024 }) maxOutputTokens: number;
  @Column({ name: 'timeout_ms', default: 30000 }) timeoutMs: number;
  @Column({ name: 'tenant_ids', type: 'jsonb', default: () => "'[]'" }) tenantIds: string[];
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ name: 'supports_tools', default: false }) supportsTools: boolean;
}
