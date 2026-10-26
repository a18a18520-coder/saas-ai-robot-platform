import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('evaluation_cases')
export class EvaluationCase {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'robot_id' }) robotId: string;
  @Column({ type: 'text' }) question: string;
  @Column({ name: 'expected_answer', type: 'text' }) expectedAnswer: string;
  @Column({ name: 'expected_documents', type: 'jsonb', default: () => "'[]'" }) expectedDocuments: string[];
  @Column({ name: 'channel_user_id' }) channelUserId: string;
  @Column({ default: 'web' }) channel: string;
}
@Entity('evaluation_runs')
export class EvaluationRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'case_id' }) caseId: string;
  @Column({ name: 'robot_id' }) robotId: string;
  @Column({ default: 'running' }) status: string;
  @Column({ type: 'jsonb', default: () => "'{}'" }) snapshot: Record<string, unknown>;
  @Column({ type: 'jsonb', default: () => "'{}'" }) result: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}
